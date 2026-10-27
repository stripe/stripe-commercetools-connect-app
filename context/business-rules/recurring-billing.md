# Business Rule: Recurring Billing

## Overview

After the initial subscription is created, Stripe generates invoices automatically on each billing cycle. The connector receives these via webhooks and creates CT orders or adds payments to existing orders depending on configuration.

---

## Rule 1: Each recurring payment event creates a new CT order (default behavior)

**What:** When `invoice.paid` arrives for a recurring cycle (not the first payment), `handleOrderProcessingForPaidEvent()` creates a new CT cart reconstructed from the original order, creates a payment, and creates an order from that cart.

**Why:** Each billing cycle represents a new delivery/fulfillment event. A separate CT order per cycle enables independent fulfillment, tracking, and accounting per period.

**Invariant:** The reconstructed cart must carry the subscription's own line item(s) from the original order, with their quantities, and the original order's addresses. One-time items of a mixed cart are not re-added — they are billed on the first invoice only (`business-rules/mixed-carts.md` Rule 1); `createNewCartFromOrder()` keeps only the line items carrying this subscription's id, or matching its Stripe Price, and falls back to cloning every original line item, with a warning, only when it identifies none (`processor/src/services/stripe-subscription.service.ts:2893-2916`). Never create an order with different items than what was originally subscribed.

**Implementation:** `stripe-subscription.service.ts` → `processSubscriptionEventPaid()` → `handleOrderProcessingForPaidEvent()` → `handleSubscriptionPaymentCreateNewOrder()`. (Not `handleRecurringChargeOrder()` — that is only called by the `@deprecated`, unwired `processSubscriptionEventCharged()`; see Rule 3.)

---

## Rule 2: `addPaymentToOrder` mode adds payments to the existing order instead

**What:** When `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING=addPaymentToOrder`, recurring `invoice.paid` events add a new payment to the existing CT order rather than creating a new one.

**Why:** Some merchants model subscriptions as a single ongoing order with multiple payments (e.g., installment plans or continuous service). Creating a new order per cycle would not fit their data model.

**Invariant:** The mode is set at deployment time and must not change mid-subscription.

**Implementation:** `stripe-subscription.service.ts` → `handleOrderProcessingForPaidEvent()` — branches on `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING`.

---

## Rule 3: Recurring payments are processed from `invoice.paid` only — subscription-invoice `charge.*` / `payment_intent.*` events are ignored

**What:** The first payment on a subscription is recorded by `POST /subscription/confirm` (`confirmSubscriptionPayment()`, which writes its transactions at `processor/src/services/stripe-subscription.service.ts:1063-1070`) and by the first-cycle `invoice.paid` (`billing_reason: subscription_create`, `processor/src/services/stripe-subscription.service.ts:1563`), which creates the order from the frozen cart (`processor/src/services/stripe-subscription.service.ts:1597-1606`). Its `payment_intent.succeeded` is not processed: subscription creation stamps the subscription id into the PaymentIntent's metadata (`processor/src/services/stripe-subscription.service.ts:213-221` → `processor/src/services/ct-payment-creation.service.ts:118-125`), so `isFromSubscriptionInvoice()` returns true (`processor/src/utils.ts:71-82`) and the route drops the event (`processor/src/routes/stripe-payment.route.ts:324`). Every subsequent recurring payment is processed **exclusively** from `invoice.paid` via `processSubscriptionEventPaid()`. Stripe also emits `charge.succeeded` / `payment_intent.succeeded` for the same subscription invoice, but the webhook route drops those when they originate from a subscription invoice — the `isFromSubscriptionInvoice()` guard in `stripe-payment.route.ts` stops them before `processStripeEvent()`. `processSubscriptionEventCharged()` still exists but is `@deprecated` and no longer wired.

**Why:** Making `invoice.paid` the single source of truth — and keying subscription CT transactions by the Stripe **invoice id** (`in_…`) rather than the PaymentIntent id — guarantees exactly one CT payment/order per cycle.

**Invariant:** For a subscription invoice, exactly one CT payment record is created per cycle, keyed by the invoice id. A subscription-invoice `charge.succeeded` / `payment_intent.succeeded` must never trigger CT payment or order creation.

**Implementation:** `stripe-payment.route.ts` → `isFromSubscriptionInvoice()` guard on `charge.succeeded` / `payment_intent.succeeded`; `stripe-subscription.service.ts` → `processSubscriptionEventPaid()` (source of truth, `:1518`); `processSubscriptionEventCharged()` marked `@deprecated` (`:2057`, defined at `:2065`).

---

## Rule 4: Cart reconstruction for recurring orders adds each item by the SKU on the subscription's Stripe Price

**What:** When creating a CT cart from a recurring invoice, `buildLineItemAction()` (`stripe-subscription.service.ts:2937-2968`) adds each cloned item by `sku: subscriptionPrice.metadata['ct_variant_sku']`, read from the subscription's current Stripe Price, with the original item's quantity (`:2962-2967`).

**Invariant (recurring path):** `buildLineItemAction()` adds each cloned item by the `ct_variant_sku` of the subscription's current Stripe Price.

**Implementation:** `stripe-subscription.service.ts:2937-2968` (`buildLineItemAction()`, recurring path).

---

## Rule 5: An asynchronous recurring payment is `Charge/Pending` until `invoice.paid`, never `Success` at confirm

**What:** `confirmSubscriptionPayment()` retrieves the real PaymentIntent status instead of assuming a synchronous card. `succeeded` / `requires_capture` write `Charge/Success`; `processing` — an ACH `us_bank_account` debit in flight — sets `isAsyncProcessing` and writes `Charge/Pending`; any other status (e.g. `requires_action` micro-deposit verification) throws as out of scope. The Pending charge becomes `Success` only when `invoice.paid` confirms real settlement, and `Failure` on `invoice.payment_failed`. `send_invoice` and trial modes are Pending by type and skip the status check entirely.

**Invariant:** No `Charge/Success` exists on a subscription payment whose PaymentIntent is still `processing`. The transition out of `Pending` is owned by `invoice.paid` / `invoice.payment_failed`, never by the confirm endpoint.

**Implementation:** `stripe-subscription.service.ts` → `confirmSubscriptionPayment()` (`isAsyncProcessing` branch); settlement in `processSubscriptionEventPaid()` / `processSubscriptionEventFailed()`.
