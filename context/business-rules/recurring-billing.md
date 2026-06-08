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

## Rule 3: Free trial invoices (zero amount) are processed but do not create charges

**What:** The first invoice of a trial subscription has `amount_due = 0`. The connector processes the `invoice.paid` event and creates the CT order, but no CT CHARGE transaction is created because there was no money movement.

**Why:** The CT order must be created even for free trials so fulfillment systems are notified. But recording a zero-amount charge would pollute financial reporting.

**Invariant:** When `invoice.amount_due === 0`, create the order but skip the financial transaction. Do not create a CHARGE transaction with amount 0.

**Implementation:** `stripe-subscription.service.ts` → `processSubscriptionEventPaid()` — conditional on `amount_due`.

**What breaks if violated:** Zero-amount CHARGE transactions appear in CT financial reports, inflating transaction counts and potentially confusing reconciliation systems.

---

## Rule 4: Recurring `charge.succeeded` is distinct from initial `payment_intent.succeeded`

**What:** The first payment on a subscription arrives via `payment_intent.succeeded`. Subsequent recurring payments arrive via `charge.succeeded` with the subscription's invoice attached. These are handled by different handlers.

**Why:** Stripe's event model differs between the initial checkout confirmation (payment intent flow) and automatic recurring charges (invoice + charge flow). The CT transaction type and order creation logic differ between them.

**Invariant:** Never route a subscription `charge.succeeded` to the payment intent handler, and never route an initial `payment_intent.succeeded` to the subscription handler.

**Implementation:** `stripe-subscription.service.ts` → `processSubscriptionEventCharged()` for recurring; `stripe-payment.service.ts` → `processStripeEvent()` for initial.

**What breaks if violated:** The initial payment is processed as a recurring charge (creating an extra order) or a recurring charge is processed as an initial payment (failing because there's no matching PaymentIntent to update).

---

## Rule 5: Cart reconstruction for recurring orders must use the original order's variant positions

**What:** When creating a CT cart from a recurring invoice, line items are rebuilt using the variant's position in the product (position 1 = master variant, position >1 = index in variants array), not the variant ID directly.

**Why:** CT product variants can be updated (new variants added). Using the variant position ensures the correct variant is selected when the product structure changes between billing cycles.

**Invariant:** Always resolve variants by position from the product, not by storing and replaying the original variant ID.

**Implementation:** `stripe-subscription.service.ts` → subscription update handler, cart reconstruction logic.

**What breaks if violated:** If a product's variant list is modified between billing cycles, the wrong variant (wrong size, color, tier) is added to the recurring order.
