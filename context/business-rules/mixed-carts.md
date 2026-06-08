# Business Rule: Mixed Carts

## Overview

A mixed cart contains one subscription line item plus any number of one-time items. The subscription recurs every billing cycle; the one-time items are billed only on the first invoice.

---

## Rule 1: One-time items are added as invoice items on the first invoice only

**What:** Non-subscription line items are converted to Stripe prices and passed via `add_invoice_items` when creating the subscription. This charges them on the first invoice alongside the first subscription payment.

**Why:** Stripe subscriptions only recur on their `items` array. One-time items must be attached to a specific invoice, not to the recurring subscription structure.

**Invariant:** One-time items must only appear in `add_invoice_items`, never in `items`. Placing a one-time item in `items` would cause it to recur on every invoice.

**Implementation:** `stripe-subscription.service.ts` → `getAllLineItemPrices()` → passed to `subscriptions.create({ add_invoice_items })`

**What breaks if violated:** One-time products (e.g., a setup fee, a physical product bundled with a subscription) are charged on every billing cycle instead of only once.

---

## Rule 2: Shipping cost is added as a recurring subscription item when present

**What:** If the cart has `shippingInfo`, the shipping cost is converted into a recurring Stripe price with the same interval as the subscription, and added to the subscription's `items` array.

**Why:** Shipping on a subscription order recurs with each delivery. It must be modeled as a recurring item to appear on every invoice.

**Invariant:** Shipping is added to `items` (recurring), not `add_invoice_items` (one-time). The shipping interval must always match the subscription interval.

**Implementation:** `stripe-subscription.service.ts` → shipping price creation, added to subscription `items`.

**What breaks if violated:** Shipping is either charged only once (if in `add_invoice_items`) or not charged at all, causing revenue leakage on each recurring shipment.

---

## Rule 3: Stripe prices for one-time items are created on the fly

**What:** For each non-subscription line item, a new Stripe price is created using the CT line item price and variant SKU. These prices are non-recurring (`type: one_time`).

**Why:** One-time line items don't have pre-existing Stripe prices. They're arbitrary products that happen to be in the cart alongside the subscription.

**Invariant:** These prices are ephemeral — created per-checkout, not reused. Never attempt to reuse a one-time invoice item price across different checkouts.

**Implementation:** `stripe-subscription.service.ts` → `getAllLineItemPrices()`

**What breaks if violated:** Reusing old prices risks applying stale prices (old amounts, wrong currency) to current checkouts.

---

## Rule 4: Mixed cart identification requires checking product type, not line item flags

**What:** The connector distinguishes subscription from one-time items by checking if the line item's product belongs to `CT_PRODUCT_TYPE_SUBSCRIPTION_KEY`. All other line items are treated as one-time.

**Why:** There is no explicit "is recurring" flag on CT line items. The product type is the authoritative classifier.

**Invariant:** Every cart processed by this connector is assumed to be one of: (a) all one-time items (standard checkout), or (b) exactly one subscription item + N one-time items (mixed cart). A cart with only one-time items is processed as standard checkout, not as a subscription.

**Implementation:** Cart processing logic in `stripe-subscription.service.ts`.

**What breaks if violated:** One-time items could be mistakenly added to the recurring `items` array, or a subscription item could be added to `add_invoice_items` (charged once, then subscription starts without that item recurring).
