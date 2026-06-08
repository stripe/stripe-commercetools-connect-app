# Workflow: Price Synchronization

**Trigger:** Stripe sends `invoice.upcoming` webhook (~1 hour before next invoice is generated).
**Actors:** Stripe (initiator), Processor, CT API, Stripe API.
**Precondition:** `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true`.
**Outcome:** Stripe subscription updated to use current CT product price for next invoice.

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
  |                           | extract subscriptionId from invoice            |
  |                           | subscriptions.retrieve(id)     |              |
  |                           |-------------------------------->|              |
  |                           | get current price item from    |              |
  |                           | subscription.items             |              |
  |                           |                                |              |
  |                           | extract ct_price_id from       |              |
  |                           | price.metadata                 |              |
  |                           |                                |              |
  |                           | getProductById(ct_price_id)    |              |
  |                           |---------------------------------------------->|
  |                           | getProductMasterPrice()        |              |
  |                           | (current CT price)             |              |
  |                           |                                |              |
  |                           | compare CT price amount        |              |
  |                           | vs Stripe price amount         |              |
  |                           |                                |              |
  |         IF SAME AMOUNT — no action needed — stop           |              |
  |                           |                                |              |
  |         IF DIFFERENT AMOUNT:                               |              |
  |                           |                                |              |
  |                           | prices.update(oldPriceId,      |              |
  |                           |   { active: false })  ← deprecate             |
  |                           |-------------------------------->|              |
  |                           | prices.create({                |              |
  |                           |   amount: new CT amount,       |              |
  |                           |   interval: same as before,    |              |
  |                           |   metadata: { ct_price_id,     |              |
  |                           |     ct_variant_sku }})         |              |
  |                           |-------------------------------->|              |
  |                           | subscriptions.update(id,       |              |
  |                           |   { items: [new price ID] })   |              |
  |                           |-------------------------------->|              |
  |                           | (next invoice will use         |              |
  |                           |  new price)                    |              |
```

---

## Steps Detail

### 1. Guard check
- If `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=false` → return immediately (no-op)

### 2. Subscription retrieval
- Extract `subscription_id` from `invoice.subscription`
- Retrieve current subscription from Stripe to get its items and current price

### 3. CT price lookup
- Read `ct_price_id` from current Stripe price metadata
- Fetch CT product by that price ID
- Get master variant price (current amount in CT)

### 4. Price comparison
- Compare `CT price centAmount` vs `Stripe price unit_amount`
- Same → no action needed
- Different → proceed to price update

### 5. Price deprecation and creation
- Deactivate old Stripe price: `prices.update(id, { active: false })`
- Create new Stripe price with:
  - `unit_amount`: new CT centAmount
  - `currency`: same as subscription
  - `recurring.interval`: same as subscription
  - `recurring.interval_count`: same as subscription
  - `metadata.ct_price_id`: same CT price ID
  - `metadata.ct_variant_sku`: same variant SKU

### 6. Subscription update
- Update subscription items to use the new price ID
- `proration_behavior` is not set here (price sync doesn't prorate)

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
| Price comparison | CT amount != Stripe amount | Deprecate + create + update |
| CT product not found | Product deleted in CT | Log error; keep old price |

---

## Error Paths

| Error | Cause | Effect |
|---|---|---|
| `ct_price_id` missing from Stripe metadata | Price created without metadata | Cannot look up CT price; sync skipped for this subscription |
| CT product not found | Product deleted | Sync skipped; old price used for next cycle |
| Stripe price creation fails | Stripe API error | Old price remains; subscriber charged old amount |
| Subscription update fails | Stripe API error | New price created but not applied; orphaned Stripe price exists |
