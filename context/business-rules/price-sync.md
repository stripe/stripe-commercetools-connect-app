# Business Rule: Price Synchronization

## Overview

When `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true`, the connector automatically updates Stripe subscription prices when CT product prices change. Stripe is the billing authority; CT is the pricing authority.

---

## Rule 1: CT is the source of truth for amounts; Stripe is the source of truth for billing lifecycle

**What:** Price changes originate in CT (merchant updates product price). The connector detects the change and propagates it to Stripe. Stripe then applies it from the next billing cycle onward.

**Why:** Merchants manage pricing in CT. Stripe manages recurring billing. The sync bridges these two systems.

**Invariant:** Never change a subscription price directly in Stripe without also updating CT. Changes made only in Stripe will be overwritten by the next sync event.

**Implementation:** `stripe-subscription.service.ts` → `synchronizeSubscriptionPrice()`

**What breaks if violated:** Price changes made in Stripe are silently reverted on the next `invoice.upcoming` event, causing billing at the wrong (CT) amount.

---

## Rule 2: Price sync is triggered by `invoice.upcoming`, not by CT product update

**What:** The sync does not happen when a merchant updates a CT product price. It happens when Stripe sends `invoice.upcoming` (typically 1 hour before the next invoice is generated).

**Why:** Proactive sync on CT update would require polling or webhook-driven CT events, adding complexity. The Stripe-driven trigger guarantees the price is current before the next charge.

**Invariant:** Price sync only runs during the `invoice.upcoming` webhook handler. It must complete before the invoice is finalized by Stripe (within the ~1 hour window).

**Implementation:** `stripe-subscription.service.ts` → `processSubscriptionEventUpcoming()`

**What breaks if violated:** If sync takes longer than the invoice finalization window, the old price is charged for that cycle and sync applies only to the following cycle.

---

## Rule 3: Stripe prices are reused when amount and interval match; deprecated when they differ

**What:** Before creating a new Stripe price, the connector checks if an existing active price with the same CT price ID, amount, currency, and interval exists. If yes, it reuses it. If the amount changed, it:
1. Deactivates (archives) the old Stripe price
2. Creates a new Stripe price with the updated amount
3. Updates the subscription to use the new price

**Why:** Stripe prices are immutable once created. You cannot change the amount on an existing price — you must create a new one and update the subscription.

**Invariant:** Never mutate an existing Stripe price's amount. Always deprecate and replace. Always store `ct_price_id` and `ct_variant_sku` in the Stripe price metadata to enable lookup.

**Implementation:** `stripe-subscription.service.ts` → `getOrCreateStripePriceForProduct()`

**What breaks if violated:** The old price continues to be used after a CT price change, charging customers the stale amount indefinitely.

---

## Rule 4: Price sync is opt-in and disabled by default

**What:** `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED` defaults to `false`. When false, `invoice.upcoming` events are ignored.

**Why:** Not all deployments require automatic price propagation. Some merchants prefer to manage Stripe prices manually or batch pricing changes with explicit subscription updates.

**Invariant:** When disabled, the `processSubscriptionEventUpcoming()` handler must be a no-op. Never sync prices when the flag is false.

**Implementation:** `stripe-subscription.service.ts` → `processSubscriptionEventUpcoming()` — early return if flag is false.

**What breaks if violated:** Unintended automatic price changes in Stripe affect live subscriptions without merchant awareness.
