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
  |                           | get original order from CT                   |
  |                           |--------------------------------------------->|
  |                           |                                              |
  |                           | if amount_due > 0:                           |
  |                           |   create AUTHORIZATION + CHARGE transaction  |
  |                           |                                              |
  |                           | if STRIPE_SUBSCRIPTION_PAYMENT_HANDLING      |
  |                           |   == "createOrder":                          |
  |                           |   reconstruct cart from original order       |
  |                           |   → re-add line items (by variant position)  |
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
  | charge.succeeded          |                                              |
  | (subscription charge)     |                                              |
  |-------------------------->|                                              |
  |   200 OK                  |                                              |
  |<--------------------------|                                              |
  |                           | processSubscriptionEventCharged()            |
  |                           | update CT Payment transactions               |
  |                           |--------------------------------------------->|
```

---

## Steps Detail

### invoice.paid processing
1. Extract invoice from event, get `subscription_id` and `customer`
2. Look up original CT order via subscription ID stored in line item custom field
3. Evaluate `amount_due`:
   - `> 0`: create AUTHORIZATION + CHARGE transactions
   - `== 0` (free trial): skip financial transactions, still create order
4. Branch on `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING`:
   - **createOrder**: reconstruct cart → create payment → create order
   - **addPaymentToOrder**: find existing order → create payment → add to order

### Cart reconstruction (createOrder mode)
1. Load original CT order
2. Create new cart with same customer, locale, currency, store
3. Re-add each line item:
   - Resolve variant by position from product (not variant ID)
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
| Amount | `amount_due > 0` | Create financial transactions |
| Amount | `amount_due == 0` (trial) | Create order only, no transactions |
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
| `charge.succeeded` before `invoice.paid` | Event ordering | Transactions may be created out of sequence — idempotent checks prevent duplicates |
| CT Payment creation fails | CT API error | Stripe charged; no CT record (requires manual reconciliation) |
