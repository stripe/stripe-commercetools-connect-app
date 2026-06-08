# Workflow: Subscription Management (Update & Cancel)

**Trigger:** Merchant calls subscription management endpoints (cancel, update, advanced update).
**Actors:** Merchant backend / admin, Processor, Stripe API, CT API.
**Outcome:** Stripe subscription modified; CT line item updated with new state.

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
  |     outcome: "CANCELLED" } |                               |              |
  |<--------------------------|                                |              |
```

---

## Update Subscription (Variant/Price Change) Flow

```
Merchant                  Processor                        Stripe          CT
  |                           |                                |              |
  | POST /subscription-api    |                                |              |
  | /:customerId              |                                |              |
  | { subscriptionId,         |                                |              |
  |   newVariantId,           |                                |              |
  |   newPriceId,             |                                |              |
  |   variantPosition }       |                                |              |
  |-------------------------->|                                |              |
  |                           | fetch CT product by variantId  |              |
  |                           |---------------------------------------------->|
  |                           | get variant at variantPosition |              |
  |                           | extract new subscription attrs |              |
  |                           | (subscription-mapper.ts)       |              |
  |                           | get CT price by newPriceId     |              |
  |                           |---------------------------------------------->|
  |                           | getOrCreateStripePriceForProduct()             |
  |                           |   → search existing Stripe prices by metadata |
  |                           |   → if match: reuse                           |
  |                           |   → if different amount: deprecate + create new|
  |                           |-------------------------------->|              |
  |                           | subscriptions.update(id,       |              |
  |                           |   { items: [new price],        |              |
  |                           |     proration_behavior,        |              |
  |                           |     billing_cycle_anchor,      |              |
  |                           |     cancel_at, ... })          |              |
  |                           |-------------------------------->|              |
  |   { id, status, outcome:  |                                |              |
  |     "UPDATED" }           |                                |              |
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
  |                           |   params, options)             |
  |                           |-------------------------------->|
  |   { id, status, outcome } |                                |
  |<--------------------------|                                |
```

Advanced update passes raw Stripe params directly. No CT product lookup or price management. Used for billing cycle changes, trial extensions, and other Stripe-native operations.

---

## Subscription Update: Price Management Detail

When changing subscription variant/price, price management follows this logic:

```
1. Build price lookup key: { ct_price_id, amount, currency, interval }

2. Search Stripe prices with metadata: { ct_price_id: newPriceId }

3. CASE: existing price found, same amount and interval
   → REUSE existing price ID
   → No Stripe API call needed

4. CASE: existing price found, different amount
   → DEPRECATE old price (prices.update({ active: false }))
   → CREATE new price with updated amount + same metadata
   → USE new price ID

5. CASE: no existing price found
   → CREATE new price
   → USE new price ID

6. Update subscription items with new price ID
```

---

## Decision Points

| Point | Condition | Path |
|---|---|---|
| Cancel timing | `cancel_at_period_end=true` on original sub | Cancels at period end, not immediately |
| Cancel timing | Default | Immediate cancellation |
| Price change | Same amount + interval | Reuse existing Stripe price |
| Price change | Different amount | Deprecate old, create new |
| Proration | `proration_behavior` on variant | Applied per variant configuration |
| Advanced update | Raw Stripe params provided | Bypass CT product lookup |

---

## Error Paths

| Error | Cause | State |
|---|---|---|
| Product not found | CT product deleted | Cannot update; error returned |
| Variant not at position | Position out of bounds | Cannot update; error returned |
| Price creation fails | Stripe API error | Subscription not updated; old price remains |
| `subscriptions.update()` fails | Stripe validation error | CT not updated; Stripe unchanged |
| Cancel fails | Sub already canceled | Error returned; CT unchanged |

> **Known gap:** CT line item custom field (`stripeConnector_stripeSubscriptionId`) is NOT cleared on cancellation. A TODO exists in `cancelSubscription()` for CT-side state update. Merchants relying on this field to detect active subscriptions must check Stripe directly after cancellation.
