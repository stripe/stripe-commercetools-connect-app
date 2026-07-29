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

## Rule 3 (intended, not fully achieved — see KI-013 and KI-032): Stripe prices should be reused when amount and interval match; deprecated when they differ

**What (intended):** Before creating a new Stripe price during sync, the connector should check whether an existing price for the same CT product at the current amount already exists, and reuse it if so — creating a new one and retiring the old one only when the amount genuinely changed.

**What actually happens:** `getOrCreateStripePriceForProduct()` calls `findStripePriceByProductAndPrice()`, which searches `metadata['ct_variant_sku']` against the CT **product ID** (not a real SKU, and not `ct_price_id` — no Price-level `ct_price_id` metadata exists in this path at all). Checkout-time prices store `ct_variant_sku` as the actual variant SKU, so this search can never match them — see **KI-032**. When a new price is created here, the `ct_price_id` metadata it stamps is a synthetic `price_${Date.now()}` value, not a real CT price ID — see **KI-013**. Net effect: this path essentially always creates a new Stripe Price on a CT price change rather than reusing an existing one, and prior sync-created prices accumulate as orphans.

**Why (intended):** Stripe prices are immutable once created. You cannot change the amount on an existing price — you must create a new one and update the subscription. Reuse-when-unchanged avoids creating a fresh orphaned Price object on every sync cycle.

**Invariant (target state):** Never mutate an existing Stripe price's amount — always deprecate and replace. The metadata field actually searched by a reuse lookup must be populated with the real value it is compared against (today it is not — see KI-013, KI-032).

**Implementation:** `stripe-subscription.service.ts` → `getOrCreateStripePriceForProduct()` (`:1909-1976`), `findStripePriceByProductAndPrice()` (`:1984-2010`).

**What breaks today:** Every `invoice.upcoming` cycle where a subscribed product's CT price changed creates a new orphaned Stripe Price instead of reusing a prior one — not because reuse-vs-mutate is violated, but because the reuse lookup can never succeed (KI-032) and the price-ID metadata meant to help it can't either (KI-013).

---

## Rule 4: Price sync is opt-in and disabled by default

**What:** `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED` defaults to `false`. When false, `invoice.upcoming` events are ignored.

**Why:** Not all deployments require automatic price propagation. Some merchants prefer to manage Stripe prices manually or batch pricing changes with explicit subscription updates.

**Invariant:** When disabled, the `processSubscriptionEventUpcoming()` handler must be a no-op. Never sync prices when the flag is false.

**Implementation:** `stripe-subscription.service.ts` → `processSubscriptionEventUpcoming()` — early return if flag is false.

**What breaks if violated:** Unintended automatic price changes in Stripe affect live subscriptions without merchant awareness.
