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
  |                           | processSubscriptionEventPaid() (awaited)     |
  |                           |                                              |
  |                           | extract subscriptionId from invoice          |
  |                           | resolve CT payment ID from subscription      |
  |                           | metadata (ct_payment_id), then look up the   |
  |                           | order by that payment ID                    |
  |                           |--------------------------------------------->|
  |                           |                                              |
  |                           | create AUTHORIZATION + CHARGE transaction    |
  |                           |                                              |
  |                           | if STRIPE_SUBSCRIPTION_PAYMENT_HANDLING      |
  |                           |   == "createOrder":                          |
  |                           |   reconstruct cart from original order       |
  |                           |   → re-add only the subscription line        |
  |                           |     item(s), by the SKU in the Stripe        |
  |                           |     Price metadata (one-time items dropped)  |
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
  |   200 OK (after handler)  |                                              |
  |<--------------------------|                                              |
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

The webhook route awaits the handler and replies 200 only after it returns (`processor/src/routes/stripe-payment.route.ts:362-365, 383`). A handler that rethrows — a retryable CT error in `processSubscriptionEventPaid()` / `processSubscriptionEventFailed()` (`processor/src/services/stripe-subscription.service.ts:1610-1612, 2359-2361`) — becomes a 500 through the global error handler (`processor/src/libs/fastify/error-handler.ts:32`), so Stripe redelivers.

> **Recurring payments are driven solely by `invoice.paid`.** Stripe also emits `charge.succeeded` / `payment_intent.succeeded` for the same subscription invoice, but the route drops them via `isFromSubscriptionInvoice()` (`stripe-payment.route.ts`) so they never create a second CT payment/order. `processSubscriptionEventCharged()` is `@deprecated` and unwired. See `business-rules/recurring-billing.md` Rule 4.

---

## Steps Detail

### invoice.paid processing
1. Extract invoice from event, get `subscription_id` and `customer`
2. Look up the original CT order via `resolvePaymentIdFromSubscription()` (`stripe-subscription.service.ts:1998`), which reads the CT payment ID from the Stripe **subscription's own metadata** (`ct_payment_id`), falling back to `findPaymentsByInterfaceId()` — then `getOrderByPaymentId({ paymentId })`. The line-item custom field `stripeConnector_stripeSubscriptionId` is read elsewhere (to filter which cloned line items belong to the subscription when reconstructing the cart, `:2904`), not to locate the order.
3. **Transaction shape depends on the pending state.** `populateTransactions()` (`subscriptionEventConverter.ts`) branches on `isPaymentChargePending`:
   - **Async settlement path (ACH `us_bank_account`):** when the CT Payment already carries a `Charge/Pending` — written at confirm for a `processing` PaymentIntent, see `process-subscription-creation.md` — `invoice.paid` transitions that existing charge **Pending → Success** (a single CHARGE transaction; no new AUTHORIZATION). This is the async ACH settlement that lands days after checkout; `invoice.payment_failed` transitions the same charge to **Failure**.
   - **Synchronous path (card):** with no pending charge, it creates AUTHORIZATION + CHARGE transactions with `amount = invoice.amount_paid`.
4. Branch on `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING`:
   - **createOrder**: reconstruct cart → create payment → create order
   - **addPaymentToOrder**: find existing order → create payment → add to order

### Cart reconstruction (createOrder mode)
1. Load original CT order
2. Create new cart with the same customer, currency, country, and tax settings (`createNewCartFromOrder()`, `stripe-subscription.service.ts:2875-2889`) — not locale or store; neither is carried over
3. Re-add the subscription's line item(s) via `buildLineItemAction()` (`:2937-2968`):
   - Only the original order's line items whose `stripeConnector_stripeSubscriptionId` equals this subscription (or that match it by SKU + price id) are cloned; one-time items are not re-added.
   - Each cloned item is added **by SKU** — `sku: subscriptionPrice.metadata.ct_variant_sku`, the SKU stored on the subscription's Stripe Price (`:2962-2967`). Position-based resolution (`getVariantByPosition()` at `:1394`) is not used here; it serves only the merchant-initiated `updateSubscription()` endpoint.
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
  |                           | processSubscriptionEventFailed() (awaited;   |
  |                           |  200 OK only after it returns, see above)    |
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
| Amount | Always | Create AUTHORIZATION + CHARGE transactions |
| Payment handling | `createOrder` | New cart + new order per cycle |
| Payment handling | `addPaymentToOrder` | Payment added to original order |
| Price sync | Price changed since last cycle | `externalPrice` applied on cart reconstruction |
| Payment failure | `invoice.payment_failed` | Create FAILURE transaction; cart remains frozen (Stripe handles retries via Smart Retries/Dunning) |
