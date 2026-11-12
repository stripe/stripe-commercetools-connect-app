# Business Rule: Mixed Carts

## Overview

A mixed cart contains one subscription line item plus any number of one-time items. The subscription recurs every billing cycle; the one-time items are billed only on the first invoice.

---

## Rule 1: One-time items are added as invoice items on the first invoice only

**What:** Non-subscription line items are converted to Stripe prices and passed via `add_invoice_items` when creating the subscription. This charges them on the first invoice alongside the first subscription payment.

**Why:** Stripe subscriptions only recur on their `items` array. One-time items must be attached to a specific invoice, not to the recurring subscription structure.

**Invariant:** One-time items must only appear in `add_invoice_items`, never in `items`.

**Implementation:** `stripe-subscription.service.ts` → `getAllLineItemPrices()` → passed to `subscriptions.create({ add_invoice_items })`

A trial does not cover one-time items: they are billed with the first invoice whether or not the subscription starts in a trial.

---

## Rule 2: Shipping cost is added as a recurring subscription item when present

**What:** If the cart has `shippingInfo`, the shipping cost is converted into a recurring Stripe price with the same interval as the subscription, and added to the subscription's `items` array.

**Why:** Shipping on a subscription order recurs with each delivery. It must be modeled as a recurring item to appear on every invoice.

**Invariant:** Shipping is added to `items` (recurring), not `add_invoice_items` (one-time). The shipping interval must always match the subscription interval.

**Implementation:** `stripe-subscription.service.ts` → shipping price creation, added to subscription `items`.

---

## Rule 3: Stripe prices for one-time items are looked up by metadata and reused when still valid, created fresh otherwise

**What:** For each non-subscription line item, `getLineItemPriceId()` first searches for an existing Stripe price via `getStripePriceByMetadata()` (keyed on the line item's variant SKU). If found and both `active` and matching the current CT amount (`hasSamePrice`), that price is reused. Otherwise the stale price is disabled (`disableStripePrice()`) and a new non-recurring (`type: one_time`) Stripe price is created with the current CT amount and variant SKU in its metadata.

**Why:** One-time line items are ordinary CT products, not ephemeral checkout-only entities — the same product can appear in a mixed cart across multiple checkouts. Reuse-when-valid mirrors the pattern used for subscription and shipping prices (`getCreateSubscriptionPriceId()`, `getSubscriptionShippingPriceId()`).

**Invariant:** Never reuse a price whose `unit_amount` no longer matches the current CT line item price — always verify `active && hasSamePrice` before reuse, and disable+recreate when it fails either check.

**Implementation:** `stripe-subscription.service.ts` → `getLineItemPriceId()` (lookup/reuse/create logic), `getAllLineItemPrices()` (caller), `disableStripePrice()` (deprecation on mismatch).

---

## Rule 4: Mixed cart identification requires checking product type, not line item flags

**What:** The connector distinguishes subscription from one-time items by checking if `lineItem.productType.obj?.name` equals the hardcoded literal `'payment-connector-subscription-information'` (`stripe-subscription.service.ts`, the `productType.obj?.name === productTypeSubscription.name` comparison in `getAllLineItemPrices()`, `assertSingleSubscriptionLineItem()` and `findSubscriptionLineItem()`) — not by the `CT_PRODUCT_TYPE_SUBSCRIPTION_KEY` env var, which only configures the product type's `key`, unrelated to this `name` comparison. See `business-rules/subscription-lifecycle.md` Rule 3. All other line items are treated as one-time.

**Why:** There is no explicit "is recurring" flag on CT line items. The product type is the authoritative classifier.

**Invariant:** Every cart processed by this connector is one of: (a) all one-time items (standard checkout), or (b) exactly one subscription item + N one-time items (mixed cart). A cart with only one-time items is processed as standard checkout, not as a subscription. A cart with more than one subscription item is rejected at subscription creation — `assertSingleSubscriptionLineItem()` throws `Errorx('MultipleSubscriptionsNotSupported', 400)`.

**Implementation:** Cart processing logic in `stripe-subscription.service.ts`; the one-subscription-per-cart invariant is enforced by `assertSingleSubscriptionLineItem()`, called from `prepareSubscriptionData()` so every create entry point (`createSetupIntent`, `createSubscription`, `createSubscriptionFromSetupIntent`) rejects a multi-subscription cart before any Stripe object is created.

---

## Rule 5: Custom line items are billed on the first invoice too

**What:** The cart's `customLineItems` (ad-hoc fees and service charges — setup fees, handling, manual surcharges) are added to `add_invoice_items` alongside the regular one-time line items of Rule 1. Each is billed via Stripe `price_data` (custom line items carry no `productId` / `variant.sku` / `price.id`, so `getLineItemPriceId()` cannot price them), with a Stripe Product reused per `slug`, at its **`totalPrice` as a single unit (`quantity: 1`)**. This sits under the one subscription-discount rule: on **every** subscription cart what Stripe collects on the first invoice must equal `cart.totalPrice`, so **only a single discount the invoice-wide coupon reproduces is supported**: a cart-total code, or a single **percentage** line-item code when the subscription is the only billed line (quantity 1, no shipping charge, no positive fee, and commercetools applied the code to it). Refused in `prepareSubscriptionData()` before any Stripe object is created: any other discount **code** whose target is not the cart total; **more than one** code; a code of any target on a **prorated anchor** or on a **trial that bills one-time items or fees during the trial**; and any **automatic or code-less direct discount that lands on the cart total, a line item or shipping** (read from `discountOnTotalPrice.includedDiscounts`, `lineItems[].discountedPricePerQuantity` and `shippingInfo.discountedPrice`, matched against the accepted code's own cart discount). **Allowed**: a single cart-total discount, and a discount landing **only on custom line items** — the fee is billed at its already-net `totalPrice`, so a fee-only discount bills correctly (a product discount, `price.discounted`, is likewise fine). Billing `totalPrice` is correct because a total-price discount lives in `cart.discountOnTotalPrice`, **not** in the fee's own `totalPrice`, so the invoice-wide Stripe coupon applies it once across the whole invoice.

**Why:** A custom line item is part of what the shopper agreed to pay — `cart.totalPrice` includes it.

**Invariant:** Every positive custom line item appears as exactly one `add_invoice_items` entry `{ unit_amount: totalPrice.centAmount, quantity: 1 }` with no `tax_behavior` (the subscription invoice carries no Stripe Tax, so it stays comparable to `cart.totalPrice`). A **zero-amount** entry is skipped. Three refusals fire in `prepareSubscriptionData()`, **before any Stripe object is created**: a **negative (credit)** custom line item → `Errorx` 400 `NegativeCustomLineItemNotSupported`; a subscription cart whose discount the invoice-wide coupon cannot reproduce — anything but a single cart-total code, or a single percentage line-item code when the subscription is the only billed line → `Errorx` 400 `UnsupportedCartDiscountForSubscription`; and a code of any target on a trial that bills one-time charges or on a prorating anchor → the same 400. The Stripe coupon id is the CT discount code id, with no `applies_to` scoping — coupon identity is owned by `coupon-sync.md`. The promise: a discount the connector cannot reproduce is refused before payment.

**Automatic (code-less) promotions:** A merchant who runs automatic promotions should exclude subscription carts in the promotion's cart predicate, e.g. `forAllLineItems(productType.key != "payment-connector-subscription-information")` — the key of this connector's subscription product type, overridable with `CT_PRODUCT_TYPE_SUBSCRIPTION_KEY` (cart predicate functions: docs.commercetools.com/api/projects/predicates).

**Implementation:** `stripe-subscription.service.ts` → `getAllLineItemPrices()` (custom-line-item loop, billed at `totalPrice`), `getStripeProductForCustomLineItem()` (Product reuse by slug), `assertNoNegativeCustomLineItem()` + `assertSupportedSubscriptionDiscounts()` (both refusals, pre-Stripe, in `prepareSubscriptionData()`); `stripe-coupon.service.ts` → `getStripeCoupons(cart)` (unscoped coupon, id = discount code id) + `translatesToWholeInvoiceCoupon()` (the target rule the refusal consults).
