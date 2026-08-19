# Failure Modes — ct-connect-stripe-composable

Operational failure scenarios specific to this connector. Scenarios shared identically with `ct-connect-stripe-checkout` (Payment Intent operations, webhook processing, webhook endpoint update at post-deploy, Stripe/CT unavailability, webhook signature verification) live in `../../context/failure-modes.md` — not duplicated here.

---

## CT Platform API — Post-deploy product type update (delete-then-create)

**Trigger:** `updateProductType()` called during connector post-deploy; the delete succeeds but the create fails. Note: post-deploy (`actions.ts:136-141`) only reaches this call when zero existing products currently reference the type (`getProductsByProductTypeId()` guard) — if any product already uses it, the update is skipped entirely and this failure mode cannot occur.
**Current behavior on failure:** The product type is permanently deleted from the CT project. The connector starts but subscription product lookups fail at runtime (no product type to match against).
**Blast radius:** No product currently uses the type at the moment this fires (by the guard above), so no *existing* subscription product is affected immediately. All *future* subscription product creation against this type fails until it is manually re-created (with all 15 attributes).
**File:** `processor/src/services/commerce-tools/product-type-client.ts:33`
**Recommendation:** Use an update-in-place strategy (check existing fields, add missing, remove stale) rather than delete-then-create.

---

## Stripe cash balance — Funding reversed after the order exists

**Trigger:** `customer_cash_balance_transaction.created` arrives with `type: 'funding_reversed'` or `'adjusted_for_overdraft'`. Stripe withdrew bank transfer funds **after** `payment_intent.succeeded` already wrote `Charge/Success` and created the commercetools order. USD funding can be reversed for up to five days.
**Current behavior on failure:** A single `log.error` with the customer id, amount, currency and cash-balance transaction id. **No CT write of any kind** — the order stays Paid, the `Charge/Success` transaction stays, and nothing marks the payment as reversed.
**Blast radius:** commercetools and Stripe diverge on real money, silently. The reversal does **not** surface as a dispute, so there is no other signal. Goods may already have shipped against an order whose payment no longer exists. Detection depends entirely on someone watching the log.
**File:** `processor/src/routes/stripe-payment.route.ts` — `logCustomerCashBalanceTransaction`
**Recommendation:** Wire this `log.error` to an alerting channel — in v1 it is the only detection available. Modelling the reversal as a CT transaction is deferred (the event object is customer-scoped and carries no `ct_payment_id`, so mapping it back requires resolving customer → CT customer → open payments, or reading the nested `applied_to_payment.payment_intent`). See KI-041.

---

## CT Platform API — Interface interaction write for `partially_funded`

**Trigger:** `payment_intent.partially_funded` arrives (shopper wired part of the amount) and the `updatePayment` call that persists the interface interaction fails.
**Current behavior on failure:** The error is caught and logged, and the connector answers Stripe **200**. `partially_funded` is deliberately excluded from `ASYNC_PENDING_EVENTS`, so it is not re-thrown and Stripe never redelivers.
**Blast radius:** One audit line lost. **No state divergence** — this event writes no CT transaction by design, so the `Authorization/Pending` for the full amount remains correct and the payment still resolves normally on `payment_intent.succeeded`. Support loses the timestamped record that a partial payment arrived, and `amount_remaining` is only visible in Stripe.
**File:** `processor/src/services/stripe-payment.service.ts` — catch in `processStripeEvent`
**Recommendation:** Accepted trade-off, not a defect to fix. Re-throwing would cause a retry storm on an event that fires on every partial funding, in exchange for an audit line. See KI-035 for the full rationale and why `requires_action` is treated differently.
