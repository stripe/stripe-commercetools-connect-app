# Business Rule: Price Synchronization

## Overview

When `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true`, the connector automatically updates Stripe subscription prices when CT product prices change. Stripe is the billing authority; CT is the pricing authority.

---

## Rule 1: CT is the source of truth for amounts; Stripe is the source of truth for billing lifecycle

**What:** Price changes originate in CT (merchant updates product price). The connector detects the change and propagates it to Stripe. Stripe then applies it from the next billing cycle onward.

**Why:** Merchants manage pricing in CT. Stripe manages recurring billing. The sync bridges these two systems.

**Invariant:** Never change a subscription price directly in Stripe without also updating CT. Changes made only in Stripe will be overwritten by the next sync event.

**Implementation:** `stripe-subscription.service.ts` → `synchronizeSubscriptionPrice()`

---

## Rule 2: Price sync is triggered by `invoice.upcoming`, not by CT product update

**What:** The sync does not happen when a merchant updates a CT product price. It happens when Stripe sends `invoice.upcoming` (typically 1 hour before the next invoice is generated).

**Why:** Proactive sync on CT update would require polling or webhook-driven CT events, adding complexity.

**Implementation:** `stripe-subscription.service.ts` → `processSubscriptionEventUpcoming()`

---

## Rule 3: Price sync is opt-in and disabled by default

**What:** `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED` defaults to `false`. When false, `invoice.upcoming` events are ignored.

**Why:** Not all deployments require automatic price propagation. Some merchants prefer to manage Stripe prices manually or batch pricing changes with explicit subscription updates.

**Implementation:** `stripe-subscription.service.ts` → `processSubscriptionEventUpcoming()` — early return if flag is false.
