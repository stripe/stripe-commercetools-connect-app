# Workflow: Price Synchronization

**Trigger:** Stripe sends `invoice.upcoming` webhook (~1 hour before next invoice is generated).
**Actors:** Stripe (initiator), Processor, CT API, Stripe API.
**Precondition:** `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true`.

---

## Flow

```
Stripe                    Processor                        Stripe          CT
  |                           |                                |              |
  | POST /stripe/webhooks     |                                |              |
  | invoice.upcoming          |                                |              |
  |-------------------------->|                                |              |
  |                           | if price-sync flag off → stop  |              |
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
  |                           | findStripeProductById(ctProductId):           |
  |                           | products.search metadata       |              |
  |                           |   ['ct_product_id'] == ctProductId            |
  |                           |-------------------------------->|              |
  |                           | prices.create({                |              |
  |                           |   amount: new CT amount,       |              |
  |                           |   interval: from subscription  |              |
  |                           |     item's current price })    |              |
  |                           |-------------------------------->|              |
  |                           | subscriptions.update(id,       |              |
  |                           |   { items: [new price ID],     |              |
  |                           |     proration_behavior: 'none',|              |
  |                           |     billing_cycle_anchor:      |              |
  |                           |       'unchanged' })           |              |
  |                           |-------------------------------->|              |
  |                           |                                |              |
  |   200 OK                                                   |              |
  |<--------------------------|                                |              |
```

The webhook route awaits `processSubscriptionEventUpcoming()` and replies `200` only after it returns
(`processor/src/routes/stripe-payment.route.ts:370-373`, `processor/src/routes/stripe-payment.route.ts:383`).
The Stripe Product used for `prices.create` is found by `findStripeProductById()` — a
`stripe.products.search` on `metadata['ct_product_id']`
(`processor/src/services/stripe-subscription.service.ts:859-871`), not a `products.retrieve`.

---

## Steps Detail

### 1. Guard check
- If `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=false` → return immediately (no-op). `processSubscriptionEventUpcoming()`, `stripe-subscription.service.ts:2452-2459`.

### 2. Subscription retrieval
- Extract the subscription ID from `invoice.parent.subscription_details.subscription` (`:2463-2464`) — not from a top-level `invoice.subscription` field.
- Retrieve the current subscription from Stripe (`:2471`) to get its items and current price.

### 3. CT price lookup — via the Stripe **Product**, not the Price
- Take `subscriptionItem.price.product` (a Stripe **Product** id) from the current subscription item (`:2491-2493`).
- Retrieve that Stripe Product (`stripe.products.retrieve()`, `:2494`) and read its `ct_product_id` metadata (`METADATA_PRODUCT_ID_FIELD`, `:2501`) — **not** a `ct_price_id` read off the Price's own metadata.
- Call `getCommercetoolsProductPrice(ctProductId)` (`:2507`), which internally calls `getProductMasterPrice(ctProductId)` — a CT lookup by product ID, not by a price ID.

### 4. Price comparison
- Compare `currentStripePrice.unit_amount` vs the CT master price's `centAmount` (`:2521`).
- Same → log "already synchronized", return. Different → proceed.

### 5. Price creation (`getOrCreateStripePriceForProduct()`, `:2580-2649`)
- When the amount differs, a new Stripe price is created (`:2618-2634`) with `unit_amount` = the new CT amount, and `recurring.interval`/`interval_count` copied from the current subscription item's price.

### 6. Subscription update
- `updateSubscriptionPrice()` (`:2704-2735`) updates the subscription item to the new price ID with `proration_behavior: 'none'` and `billing_cycle_anchor: 'unchanged'`.

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
| Feature flag | `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED` not `'true'` (`processor/src/config/config.ts:338`) | No-op; return |
| Price comparison | CT amount == Stripe amount | No action |
| Price comparison | CT amount != Stripe amount | Create new Stripe price + update subscription |
| CT product not found | Product deleted in CT | `getCommercetoolsProductPrice()` returns `undefined`; `synchronizeSubscriptionPrice()` logs a warning and returns |
