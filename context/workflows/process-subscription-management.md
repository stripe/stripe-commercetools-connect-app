# Workflow: Subscription Management (Update & Cancel)

**Trigger:** Merchant calls subscription management endpoints (cancel, update, advanced update).
**Actors:** Merchant backend / admin, Processor, Stripe API, CT API.
**Outcome:** Stripe subscription modified. Cancel cancels the subscription in Stripe; the cart is unfrozen afterwards by the `customer.subscription.deleted` webhook (below). Update creates a **new, separate** CT cart holding the new variant only to resolve the Stripe price (`createCartWithProduct()`, `processor/src/services/commerce-tools/cart-client.ts:73-116`, called at `processor/src/services/stripe-subscription.service.ts:1328-1335`), then updates Stripe (`processor/src/services/stripe-subscription.service.ts:1342-1356`). Advanced update calls Stripe only (`processor/src/services/stripe-subscription.service.ts:1431-1433`).

---

## Cancel Flow

```
Merchant                  Processor                        Stripe          CT
  |                           |                                |              |
  | DELETE /subscription-api  |                                |              |
  | /:customerId/:subscriptionId                               |              |
  |-------------------------->|                                |              |
  |                           | subscriptions.cancel(id)       |              |
  |                           |-------------------------------->|              |
  |   { id, status: "canceled",|                               |              |
  |     outcome: "canceled" }  |                               |              |
  |<--------------------------|                                |              |
```

---

## Webhook-Driven Cancellation & Cart Cleanup (`customer.subscription.deleted`)

The `DELETE` endpoint above cancels the subscription in Stripe. Stripe then emits
`customer.subscription.deleted` — also fired when a subscription is canceled from the Stripe
Dashboard or is exhausted by Dunning. The connector subscribes to this event
(`connectors/actions.ts` → `enabled_events`) and routes it (`routes/stripe-payment.route.ts`) to
`processSubscriptionEventDeleted()` (`stripe-subscription.service.ts`), which:

1. Resolves the CT Payment from the subscription's `ct_payment_id` metadata, then the cart from that payment.
2. If the cart is still `Frozen`, calls `unfreezeCart()` so the cart is reusable after the subscription ends.
3. Best-effort: any failure is logged and swallowed — a failed cleanup must never make Stripe redeliver indefinitely.

---

## ACH Late Return (post-settlement reversal)

An ACH debit can be reversed by the customer's bank **after** it has already settled (up to ~60 days later).
Stripe fires `payment_intent.payment_failed` / `charge.failed` for this, but does **not** re-fire
`invoice.payment_failed`.

To surface this, a subscription-invoice `payment_intent.payment_failed` is routed
(`routes/stripe-payment.route.ts`) to `processSubscriptionEventLateReturn()`
(`stripe-subscription.service.ts`), which:

1. Resolves the CT Payment from the PaymentIntent's `ct_payment_id` metadata.
2. Only acts if the payment already has a `Charge/Success` (`wasSettled`) — i.e. the money had settled and is
   now being clawed back. A still-`Pending` charge is an ordinary first-payment failure (handled by
   `invoice.payment_failed`) and is ignored here.
3. Flags the payment via the native `paymentStatus` interface (`setStatusInterfaceCode: 'ach_late_return'` plus a
   human-readable `interfaceText`) — **without** changing any transaction or the order state. The reversal itself
   is then handled in the Stripe Dashboard.
4. Best-effort: never throws.

---

## Update Subscription (Variant/Price Change) Flow

```
Merchant                  Processor                        Stripe          CT
  |                           |                                |              |
  | POST /subscription-api    |                                |              |
  | /:customerId              |                                |              |
  | { subscriptionId,         |                                |              |
  |   newSubscriptionVariantId,                                |              |
  |   newSubscriptionPriceId, |                                |              |
  |   newSubscriptionVariantPosition? }                        |              |
  |-------------------------->|                                |              |
  |                           | fetch CT product by variantId  |              |
  |                           |---------------------------------------------->|
  |                           | get variant at variantPosition |              |
  |                           | extract new subscription attrs |              |
  |                           | (subscription-mapper.ts)       |              |
  |                           | get CT price by newPriceId     |              |
  |                           |---------------------------------------------->|
  |                           | getCreateSubscriptionPriceId() (stripe-subscription.service.ts:671) |
  |                           |   → search existing Stripe prices by variant   |
  |                           |     SKU + CT price ID metadata (AND query)     |
  |                           |   → if match (active, same amount/interval/    |
  |                           |     interval_count): reuse                     |
  |                           |   → else: deactivate stale match (if any),     |
  |                           |     create new                                 |
  |                           |-------------------------------->|              |
  |                           | subscriptions.update(id,       |              |
  |                           |   { items: [new price],        |              |
  |                           |     proration_behavior,        |              |
  |                           |     billing_cycle_anchor,      |              |
  |                           |     cancel_at, ... })          |              |
  |                           |-------------------------------->|              |
  |   { id, status, outcome:  |                                |              |
  |     "updated" }           |                                |              |
  |<--------------------------|                                |              |
```

---

## Advanced Update Flow

```
Merchant                  Processor                        Stripe
  |                           |                                |
  | POST /subscription-api    |                                |
  | /advanced/:customerId     |                                |
  | { id,                     |                                |
  |   params: Stripe.SubscriptionUpdateParams,                 |
  |   options? }              |                                |
  |-------------------------->|                                |
  |                           | subscriptions.update(id,       |
  |                           |   params,                      |
  |                           |   { idempotencyKey })          |
  |                           |-------------------------------->|
  |   { id, status, outcome } |                                |
  |<--------------------------|                                |
```

Advanced update passes raw Stripe params directly. No CT product lookup or price management. Only an
idempotency key is forwarded: `options.idempotencyKey` if given, else a random UUID; the rest of `options`
is deliberately dropped (`processor/src/services/stripe-subscription.service.ts:1423, 1427-1433`). Used for
billing cycle changes, trial extensions, and other Stripe-native operations.

---

## Subscription Update: Price Management Detail

When changing subscription variant/price, `getCreateSubscriptionPriceId()` (`stripe-subscription.service.ts:671-694`) follows this logic — the same function used at subscription creation:

```
1. Search Stripe prices via getStripePriceByMetadata() (:796-801): an AND query on
   metadata['ct_variant_sku'] == <variant SKU> AND metadata['ct_price_id'] == <CT price id>

2. CASE: match found, active AND same amount AND same interval AND same interval_count
   → REUSE existing price ID
   → No Stripe API write needed

3. CASE: match found but active/amount/interval/interval_count differ
   → DEACTIVATE the stale price (disableStripePrice(), prices.update({ active: false }))
   → CREATE new price with the current amount/interval + the same metadata keys
   → USE new price ID

4. CASE: no existing price found
   → CREATE new price
   → USE new price ID

5. Update subscription items with new price ID
```

---

## Decision Points

| Point | Condition | Path |
|---|---|---|
| Cancel timing | Always | `cancelSubscription()` calls `stripe.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: true })` unconditionally (`:923-928`) — there is no `cancel_at_period_end` branch; cancellation is always immediate. |
| Price change | Same amount + interval | Reuse existing Stripe price |
| Price change | Different amount | Deprecate old, create new |
| Proration | `proration_behavior` on variant | Applied per variant configuration |
| Advanced update | Raw Stripe params provided | No CT product lookup |

---

## Error Paths

| Error | Cause | State |
|---|---|---|
| Product not found | CT product deleted | Cannot update; error returned |
| Variant not at position | Position out of bounds | Cannot update; error returned |
| Price creation fails | Stripe API error | Subscription not updated; old price remains |
| `subscriptions.update()` fails | Stripe validation error | CT not updated; Stripe unchanged |
| Cancel fails | Sub already canceled | Error returned; CT unchanged |
