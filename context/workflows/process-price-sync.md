# Workflow: Price Synchronization

**Trigger:** Stripe sends `invoice.upcoming` webhook (~1 hour before next invoice is generated).
**Actors:** Stripe (initiator), Processor, CT API, Stripe API.
**Precondition:** `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true`.
**Outcome:** Stripe subscription updated to use a Stripe price matching the current CT product price for next invoice.

> **Known defects in this flow** — the reuse/lookup step described below does not work as intended; see `known-issues.md` KI-013 and KI-032, and `business-rules/price-sync.md` Rule 3. This document describes actual current behavior, including the defects.

---

## Flow

```
Stripe                    Processor                        Stripe          CT
  |                           |                                |              |
  | POST /stripe/webhooks     |                                |              |
  | invoice.upcoming          |                                |              |
  |-------------------------->|                                |              |
  |   200 OK                  |                                |              |
  |<--------------------------|                                |              |
  |                           | if !PRICE_SYNC_ENABLED → stop  |              |
  |                           |                                |              |
  |                           | processSubscriptionEventUpcoming()             |
  |                           |                                |              |
  |                           | extract subscriptionId from    |              |
  |                           | invoice.parent.subscription_    |              |
  |                           | details.subscription           |              |
  |                           | subscriptions.retrieve(id)     |              |
  |                           |-------------------------------->|              |
  |                           | synchronizeSubscriptionPrice() |              |
  |                           | get items.data[0].price        |              |
  |                           | (current Stripe price)         |              |
  |                           |                                |              |
  |                           | products.retrieve(price.product)|             |
  |                           |-------------------------------->|              |
  |                           | read ct_product_id from the    |              |
  |                           | Stripe PRODUCT's metadata       |              |
  |                           | (not the price's metadata)      |              |
  |                           |                                |              |
  |                           | getProductMasterPrice(ctProductId)            |
  |                           |---------------------------------------------->|
  |                           | (current CT price)             |              |
  |                           |                                |              |
  |                           | compare CT price amount        |              |
  |                           | vs current Stripe price amount |              |
  |                           |                                |              |
  |         IF SAME AMOUNT — no action needed — stop           |              |
  |                           |                                |              |
  |         IF DIFFERENT AMOUNT:                               |              |
  |                           |                                |              |
  |                           | findStripePriceByProductAndPrice() searches   |
  |                           | metadata['ct_variant_sku'] == ctProductId     |
  |                           | (see defect below — this never matches       |
  |                           |  a checkout-created price)                    |
  |                           |-------------------------------->|              |
  |                           |                                |              |
  |         NO defect-free reuse in practice — falls through to create:       |
  |                           |                                |              |
  |                           | products.retrieve for stripeProductId         |
  |                           |-------------------------------->|              |
  |                           | prices.create({                |              |
  |                           |   amount: new CT amount,       |              |
  |                           |   interval: from subscription  |              |
  |                           |     item's current price,      |              |
  |                           |   metadata: {                  |              |
  |                           |     ct_variant_sku: ctProductId,  ← a product ID,
  |                           |       not a real SKU (KI-032)     |              |
  |                           |     ct_price_id: `price_${Date.now()}` ← not a
  |                           |       real CT price ID (KI-013)   |              |
  |                           |   }})                          |              |
  |                           |-------------------------------->|              |
  |                           | subscriptions.update(id,       |              |
  |                           |   { items: [new price ID],     |              |
  |                           |     proration_behavior: 'none',|              |
  |                           |     billing_cycle_anchor:      |              |
  |                           |       'unchanged' })           |              |
  |                           |-------------------------------->|              |
  |                           | (old Stripe price is NOT       |              |
  |                           |  deactivated — remains active  |              |
  |                           |  and orphaned)                 |              |
```

---

## Steps Detail

### 1. Guard check
- If `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=false` → return immediately (no-op). `processSubscriptionEventUpcoming()`, `stripe-subscription.service.ts:1786-1793`.

### 2. Subscription retrieval
- Extract the subscription ID from `invoice.parent.subscription_details.subscription` (`:1797-1798`) — not from a top-level `invoice.subscription` field.
- Retrieve the current subscription from Stripe (`:1805`) to get its items and current price.

### 3. CT price lookup — via the Stripe **Product**, not the Price
- Take `subscriptionItem.price.product` (a Stripe **Product** id) from the current subscription item (`:1826-1827`).
- Retrieve that Stripe Product (`stripe.products.retrieve()`, `:1828`) and read its `ct_product_id` metadata (`METADATA_PRODUCT_ID_FIELD`, `:1835`) — **not** a `ct_price_id` read off the Price's own metadata.
- Call `getCommercetoolsProductPrice(ctProductId)` (`:1841`), which internally calls `getProductMasterPrice(ctProductId)` — a real CT lookup by product ID, not by a price ID.

### 4. Price comparison
- Compare `currentStripePrice.unit_amount` vs the CT master price's `centAmount` (`:1855`).
- Same → log "already synchronized", return. Different → proceed.

### 5. Reuse attempt, then price creation (`getOrCreateStripePriceForProduct()`, `:1909-1976`)
- `findStripePriceByProductAndPrice()` (`:1984-2010`) searches Stripe prices where `metadata['ct_variant_sku'] == ctProductId` — comparing a metadata field meant to hold a variant SKU against a **product ID** value. Checkout-time prices (`createStripePrice()`, `getLineItemPriceId()`) store the actual variant SKU under that same key, so this search can never match them — see KI-032. A prior sync-created price *can* match (both write and read use `ctProductId` under that key within this function), but only if its interval also still matches the subscription item's current interval.
- When no match is reused, a new Stripe price is created (`:1947-1962`) with `unit_amount` = the new CT amount, `recurring.interval`/`interval_count` copied from the current subscription item's price, and metadata `ct_variant_sku = ctProductId` (not a real SKU) and `ct_price_id = price_${Date.now()}` (not a real CT price ID — see KI-013).
- **The old Stripe price is never deactivated in this path.** Unlike `getCreateSubscriptionPriceId()` and `getLineItemPriceId()` (which both call `disableStripePrice()` on a stale match), `getOrCreateStripePriceForProduct()` has no equivalent call. The previous price is left `active` and becomes an orphan once the subscription stops referencing it.

### 6. Subscription update
- `updateSubscriptionPrice()` (`:2029-2046`) updates the subscription item to the new price ID with `proration_behavior: 'none'` and `billing_cycle_anchor: 'unchanged'`.

---

## Timing Constraint

Stripe sends `invoice.upcoming` approximately **1 hour** before the invoice is finalized. The price sync must complete within this window. If it doesn't:
- The invoice is generated with the old price
- The sync applies on the *next* upcoming event (next cycle)
- The customer is charged the old price for one more cycle

This is an inherent limitation of the Stripe event model. It is not an error — it means price changes can lag by up to one billing cycle.

---

## Decision Points

| Point | Condition | Path |
|---|---|---|
| Feature flag | `PRICE_SYNC_ENABLED=false` | No-op; return |
| Price comparison | CT amount == Stripe amount | No action |
| Price comparison | CT amount != Stripe amount | Attempt reuse (see KI-032 — rarely succeeds against a checkout-created price) → create + update |
| CT product not found | Product deleted in CT | `getCommercetoolsProductPrice()` returns `undefined`; `synchronizeSubscriptionPrice()` logs a warning and returns |

---

## Error Paths

| Error | Cause | Effect |
|---|---|---|
| No `ct_product_id` on the Stripe Product | Product created without this metadata | `synchronizeSubscriptionPrice()` logs a warning and returns; sync skipped for this subscription |
| CT product not found | Product deleted | Sync skipped; old price used for next cycle |
| Stripe price creation fails | Stripe API error | Old price remains; subscriber charged old amount |
| Subscription update fails | Stripe API error | New price created but not applied; orphaned Stripe price exists (in addition to the old price, which is never deactivated even on success — see Step 5) |
