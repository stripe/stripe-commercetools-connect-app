# Business Rule: Recurring Billing

## Overview

After the initial subscription is created, Stripe generates invoices automatically on each billing cycle. The connector receives these via webhooks and creates CT orders or adds payments to existing orders depending on configuration.

---

## Rule 1: Each recurring payment event creates a new CT order (default behavior)

**What:** When `invoice.paid` arrives for a recurring cycle (not the first payment), `handleOrderProcessingForPaidEvent()` creates a new CT cart reconstructed from the original order, creates a payment, and creates an order from that cart.

**Why:** Each billing cycle represents a new delivery/fulfillment event. A separate CT order per cycle enables independent fulfillment, tracking, and accounting per period.

**Invariant:** The reconstructed cart must mirror the original order's line items, quantities, and addresses. Never create an order with different items than what was originally subscribed.

**Implementation:** `stripe-subscription.service.ts` → `handleOrderProcessingForPaidEvent()`, `handleRecurringChargeOrder()`

**What breaks if violated:** Recurring charges in Stripe have no corresponding CT orders. Fulfillment systems that depend on CT orders to trigger shipping or provisioning never fire for subsequent billing cycles.

---

## Rule 2: `addPaymentToOrder` mode adds payments to the existing order instead

**What:** When `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING=addPaymentToOrder`, recurring `invoice.paid` events add a new payment to the existing CT order rather than creating a new one.

**Why:** Some merchants model subscriptions as a single ongoing order with multiple payments (e.g., installment plans or continuous service). Creating a new order per cycle would not fit their data model.

**Invariant:** The mode is set at deployment time and must not change mid-subscription. Switching modes after subscriptions are active would create a mix of new orders and payments-on-old-orders for the same subscription.

**Implementation:** `stripe-subscription.service.ts` → `handleOrderProcessingForPaidEvent()` — branches on `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING`.

**What breaks if violated:** Orders are created for some cycles and payments added to the old order for others, producing an inconsistent CT data structure that breaks reporting and fulfillment.

---

## Rule 3 (not implemented — describes intended behavior only): Free trial invoices (zero amount) still write a zero-amount CHARGE transaction today

**What (intended):** The first invoice of a trial subscription has `amount_due = 0`. The CT order should be created, but no CT CHARGE transaction should be created since there was no money movement.

**What actually happens:** `populateTransactions()` (`subscriptionEventConverter.ts:57-90`) has no `amount_due`/`amount_paid` guard at all — on `invoice.paid` it unconditionally returns an AUTHORIZATION + CHARGE pair (or just CHARGE, if a charge was already pending), both with `amount: populateAmount(invoice)` = `invoice.amount_paid` (`:175-178`). For a free-trial first invoice this is `0`, so a CHARGE transaction with `centAmount: 0` **is** written to CT today.

**Why (intended):** The CT order must be created even for free trials so fulfillment systems are notified. But recording a zero-amount charge would pollute financial reporting.

**Invariant (target state, not yet enforced):** When `invoice.amount_due === 0` (or `amount_paid === 0`), create the order but skip the financial transaction — this check does not exist in `populateTransactions()` today.

**Implementation:** `processor/src/services/converters/subscriptionEventConverter.ts:57-90` (`populateTransactions()`), `:175-178` (`populateAmount()`) — invoked from `processSubscriptionEventPaid()` (`stripe-subscription.service.ts:1232`) via `subscriptionEventConverter.convert(...)`, but the missing guard is in the converter, not in `processSubscriptionEventPaid()`'s own logic.

**What breaks today:** Zero-amount CHARGE transactions appear in CT for every free-trial first invoice, inflating transaction counts and potentially confusing reconciliation systems — exactly the outcome this rule was meant to prevent.

---

## Rule 4: Recurring payments are processed from `invoice.paid` only — subscription-invoice `charge.*` / `payment_intent.*` events are ignored

**What:** The first payment on a subscription arrives via `payment_intent.succeeded` (initial checkout, handled by `processStripeEvent()`). Every subsequent recurring payment is processed **exclusively** from `invoice.paid` via `processSubscriptionEventPaid()`. Stripe also emits `charge.succeeded` / `payment_intent.succeeded` for the same subscription invoice, but the webhook route drops those when they originate from a subscription invoice — the `isFromSubscriptionInvoice()` guard in `stripe-payment.route.ts` stops them before `processStripeEvent()`. `processSubscriptionEventCharged()` still exists but is `@deprecated` and no longer wired.

**Why:** Routing both the invoice event and the charge/PI events for the same recurring cycle previously created **duplicate** CT payments and orders. Making `invoice.paid` the single source of truth — and keying subscription CT transactions by the Stripe **invoice id** (`in_…`) rather than the PaymentIntent id — guarantees exactly one CT payment/order per cycle. (Fix landed on `fix/composable-order-creation-on-success-only`.)

**Invariant:** For a subscription invoice, exactly one CT payment record is created per cycle, keyed by the invoice id. A subscription-invoice `charge.succeeded` / `payment_intent.succeeded` must never trigger CT payment or order creation.

**Implementation:** `stripe-payment.route.ts` → `isFromSubscriptionInvoice()` guard on `charge.succeeded` / `payment_intent.succeeded`; `stripe-subscription.service.ts` → `processSubscriptionEventPaid()` (source of truth, `:1186`); `processSubscriptionEventCharged()` marked `@deprecated` (`:1484`).

**What breaks if violated:** Re-wiring subscription-invoice `charge.succeeded` reintroduces duplicate CT payments/orders per cycle — the exact defect this fix removed.

---

## Rule 5: Cart reconstruction for recurring orders replays the original variant ID directly — variant-position resolution is a separate, merchant-update-only mechanism

**What:** When creating a CT cart from a recurring invoice, `buildLineItemAction()` (`stripe-subscription.service.ts:2256-2287`) rebuilds line items with `variantId: item.variant?.id` — the **original variant ID copied directly** from the prior order's line item (`:2271-2278`), falling back to a SKU lookup from the Stripe Price metadata only if the item doesn't match the subscription price (`:2280-2286`). Variant-**position** resolution (`getVariantByPosition()`, `:1069`) exists in this codebase, but it is called only from `updateSubscription()` (`:983`) — the merchant-initiated `POST /subscription-api/:customerId` variant/price-change endpoint — never from the recurring-order cart-reconstruction path (`createNewCartFromOrder()`, `:2194`, or `buildLineItemAction()`).

**Why:** This rule described the intended safeguard against a product's variant list changing between billing cycles, but the recurring path doesn't implement it — it trusts the variant ID stored on the prior order to still be valid.

**Invariant (as implemented, recurring path only):** `buildLineItemAction()` replays `item.variant?.id` verbatim; it does not re-resolve the variant from the product by position or by any other means.

**Implementation:** `stripe-subscription.service.ts:2256-2287` (`buildLineItemAction()`, recurring path); `:1069` (`getVariantByPosition()`, used only by the separate merchant-update path at `:983`).

**What breaks if violated (i.e., what the original intent was guarding against):** If a product's variant list is modified between billing cycles (e.g., a variant is deleted or reindexed) such that the stored `variantId` no longer resolves on the current product, cart reconstruction for that recurring cycle would fail or produce a stale/wrong variant — the recurring path currently has no mitigation for this.

---

## Rule 6: An asynchronous recurring payment is `Charge/Pending` until `invoice.paid`, never `Success` at confirm

**What:** `confirmSubscriptionPayment()` retrieves the real PaymentIntent status instead of assuming a synchronous card. `succeeded` / `requires_capture` write `Charge/Success`; `processing` — an ACH `us_bank_account` debit in flight — sets `isAsyncProcessing` and writes `Charge/Pending`; any other status (e.g. `requires_action` micro-deposit verification) throws as out of scope. The Pending charge becomes `Success` only when `invoice.paid` confirms real settlement, and `Failure` on `invoice.payment_failed`. `send_invoice` and trial modes are Pending by type and skip the status check entirely.

**Why:** The confirm previously wrote `Charge/Success` unconditionally, so an ACH subscription order was marked paid before any money had moved — a divergence from Stripe that lasts for the whole ~2–4 business day settlement window and becomes permanent if the debit fails. Reproduced live. See `decisions/adr-013-async-ach-charge-pending.md`.

**Invariant:** No `Charge/Success` exists on a subscription payment whose PaymentIntent is still `processing`. The transition out of `Pending` is owned by `invoice.paid` / `invoice.payment_failed`, never by the confirm endpoint.

**Implementation:** `stripe-subscription.service.ts` → `confirmSubscriptionPayment()` (`isAsyncProcessing` branch); settlement in `processSubscriptionEventPaid()` / `processSubscriptionEventFailed()`.

**What breaks if violated:** commercetools claims a subscription payment is captured while the funds are in flight. If the debit then fails, the order stays paid against money that never arrived, and nothing reconciles it.

---

## Rule 7: A transient commercetools write failure rethrows so Stripe redelivers — a permanent one does not

**What:** `processSubscriptionEventPaid()` / `processSubscriptionEventFailed()` rethrow only errors matching a transient pattern (`ConcurrentModification | 409 | 429 | 502 | 503 | ETIMEDOUT | ECONNRESET`). A rethrow makes the webhook respond non-2xx, which is what triggers Stripe's own redelivery. Every other error keeps the previous behavior: logged and swallowed, webhook returns 200.

**Why:** The handlers previously caught everything and returned 200, so a version conflict or a timeout left Stripe updated and commercetools not, with nothing to bring them back into sync. Rethrowing *all* errors was tried first and rejected — it turned a permanent failure (bad credentials, missing customer) into a days-long redelivery storm. See `decisions/adr-015-redeliver-transient-ct-errors.md`.

**Invariant:** A transient CT-write failure never ends in a 200. A permanent one never triggers a retry.

**Implementation:** `stripe-subscription.service.ts` → the retryable-error check in `processSubscriptionEventPaid()` / `processSubscriptionEventFailed()`.

**What breaks if violated:** Swallowing transient errors reintroduces silent divergence with no recovery path. Rethrowing permanent ones poisons the webhook endpoint with retries that can never succeed. The split is a regex on error text, so an unrecognised transient error is still swallowed — the known residual.
