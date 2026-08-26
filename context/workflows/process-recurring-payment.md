# Workflow: Recurring Payment (Subsequent Billing Cycles)

**Trigger:** Stripe generates an invoice on the subscription's billing cycle and charges the saved payment method.
**Actors:** Stripe (initiator), Processor, CT API.
**Outcome:** New CT order created (or payment added to existing order) reflecting the recurring charge.

This workflow is fully automatic — no customer or merchant action required. The connector processes Stripe webhook events.

---

## Flow

```
Stripe                    Processor                                        CT
  |                           |                                              |
  | POST /stripe/webhooks     |                                              |
  | invoice.paid              |                                              |
  |-------------------------->|                                              |
  |   200 OK                  |                                              |
  |<--------------------------|                                              |
  |                           | processSubscriptionEventPaid()               |
  |                           |                                              |
  |                           | extract subscriptionId from invoice          |
  |                           | resolve CT payment ID from subscription      |
  |                           | metadata (ct_payment_id), then look up the   |
  |                           | order by that payment ID                    |
  |                           |--------------------------------------------->|
  |                           |                                              |
  |                           | create AUTHORIZATION + CHARGE transaction    |
  |                           | (always — no amount_due guard exists;        |
  |                           |  a $0 trial invoice still writes a $0 CHARGE)|
  |                           |                                              |
  |                           | if STRIPE_SUBSCRIPTION_PAYMENT_HANDLING      |
  |                           |   == "createOrder":                          |
  |                           |   reconstruct cart from original order       |
  |                           |   → re-add line items (variant ID replayed   |
  |                           |     from the original order, not re-resolved |
  |                           |     by position)                             |
  |                           |   → set shipping/billing addresses           |
  |                           |   → apply current prices (externalPrice)     |
  |                           |   create CT Payment                          |
  |                           |   add payment to cart                        |
  |                           |   create CT Order from cart                  |
  |                           |--------------------------------------------->|
  |                           |                                              |
  |                           |   == "addPaymentToOrder":                    |
  |                           |   find existing CT Order                     |
  |                           |   create CT Payment                          |
  |                           |   add payment to existing order              |
  |                           |--------------------------------------------->|
  |                           |                                              |
  | POST /stripe/webhooks     |                                              |
  | charge.succeeded /        |                                              |
  | payment_intent.succeeded  |                                              |
  | (subscription invoice)    |                                              |
  |-------------------------->|                                              |
  |   200 OK                  |                                              |
  |<--------------------------|                                              |
  |                           | isFromSubscriptionInvoice() → IGNORED        |
  |                           | (invoice.paid is the single source of truth; |
  |                           |  no CT write — prevents duplicate payments)  |
```

> **Recurring payments are driven solely by `invoice.paid`.** Stripe also emits `charge.succeeded` / `payment_intent.succeeded` for the same subscription invoice, but the route drops them via `isFromSubscriptionInvoice()` (`stripe-payment.route.ts`) so they never create a second CT payment/order. `processSubscriptionEventCharged()` is `@deprecated` and unwired. See `business-rules/recurring-billing.md` Rule 4.

---

## Steps Detail

### invoice.paid processing
1. Extract invoice from event, get `subscription_id` and `customer`
2. Look up the original CT order via `resolvePaymentIdFromSubscription()` (`stripe-subscription.service.ts:1425`), which reads the CT payment ID from the Stripe **subscription's own metadata** (`ct_payment_id`), falling back to `findPaymentsByInterfaceId()` — then `getOrderByPaymentId({ paymentId })`. The line-item custom field `stripeConnector_stripeSubscriptionId` is read elsewhere (to filter which cloned line items belong to the subscription when reconstructing the cart, `:2223`) but is **not** what locates the order.
3. **Transaction shape depends on the pending state.** `populateTransactions()` (`subscriptionEventConverter.ts`) branches on `isPaymentChargePending`:
   - **Async settlement path (ACH `us_bank_account`):** when the CT Payment already carries a `Charge/Pending` — written at confirm for a `processing` PaymentIntent, see `process-subscription-creation.md` — `invoice.paid` transitions that existing charge **Pending → Success** (a single CHARGE transaction; no new AUTHORIZATION). This is the async ACH settlement that lands days after checkout; `invoice.payment_failed` transitions the same charge to **Failure**.
   - **Synchronous path (card):** with no pending charge, it creates AUTHORIZATION + CHARGE transactions with `amount = invoice.amount_paid`.
   - **No `amount_due` guard:** for a free-trial first invoice (`amount_paid = 0`), a CHARGE transaction with `centAmount: 0` is still created — see `business-rules/recurring-billing.md` Rule 3 for the gap between intended and actual behavior.
4. Branch on `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING`:
   - **createOrder**: reconstruct cart → create payment → create order
   - **addPaymentToOrder**: find existing order → create payment → add to order

### Cart reconstruction (createOrder mode)
1. Load original CT order
2. Create new cart with the same customer, currency, country, and tax settings (`createNewCartFromOrder()`, `stripe-subscription.service.ts:2194-2213`) — **not** locale or store; neither is carried over
3. Re-add each line item via `buildLineItemAction()` (`:2256-2287`):
   - Replays `variantId: item.variant?.id` directly from the original order's line item — does **not** re-resolve the variant by position. (Position-based resolution, `getVariantByPosition()` at `:1069`, exists in this codebase but is only used by the separate merchant-initiated `updateSubscription()` endpoint, not by this recurring path — see `business-rules/recurring-billing.md` Rule 5.)
   - Apply `externalPrice` if subscription price was synced
4. Set shipping and billing addresses from invoice charge data
5. Create CT Payment with AUTHORIZATION + CHARGE transactions
6. Associate payment to cart, create order

---

## Payment Failure Flow

```
Stripe                    Processor                                        CT
  |                           |                                              |
  | POST /stripe/webhooks     |                                              |
  | invoice.payment_failed    |                                              |
  |-------------------------->|                                              |
  |   200 OK                  |                                              |
  |<--------------------------|                                              |
  |                           | processSubscriptionEventFailed()             |
  |                           |                                              |
  |                           | create AUTHORIZATION: FAILURE transaction    |
  |                           |--------------------------------------------->|
  |                           |                                              |
  |                           | if createOrder mode:                         |
  |                           |   create order in FAILED state               |
  |                           |--------------------------------------------->|
```

---

## Decision Points

| Point | Condition | Path |
|---|---|---|
| Amount | Always | Create AUTHORIZATION + CHARGE transactions — no `amount_due`/`amount_paid` guard exists; a $0 trial invoice still gets a $0 CHARGE (see `business-rules/recurring-billing.md` Rule 3) |
| Payment handling | `createOrder` | New cart + new order per cycle |
| Payment handling | `addPaymentToOrder` | Payment added to original order |
| Price sync | Price changed since last cycle | `externalPrice` applied on cart reconstruction |
| Payment failure | `invoice.payment_failed` | Create FAILURE transaction; cart remains frozen (Stripe handles retries via Smart Retries/Dunning) |

---

## Error Paths

| Error | Cause | CT State |
|---|---|---|
| Original order not found | CT data gap | Cannot create recurring order; event logged |
| Cart reconstruction fails | CT API error or missing variant | Recurring payment recorded in Stripe; CT order not created |
| Subscription-invoice `charge.succeeded` / `payment_intent.succeeded` | Stripe emits them alongside `invoice.paid` | Ignored by `isFromSubscriptionInvoice()` — no CT write; only `invoice.paid` creates the payment/order |
| CT Payment creation fails | CT API error | Stripe charged; no CT record (requires manual reconciliation) |
