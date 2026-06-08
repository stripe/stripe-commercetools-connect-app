# ADR-005 — Subscription Price Sync as Opt-In Feature

**Status:** Accepted  
**Date:** 2024

## Context

CT is the product catalog source of truth. When a product price changes in CT, the corresponding Stripe subscription price may become stale — leading to billing discrepancies.

Automatic price sync adds complexity: every CT price update could trigger a Stripe API call, and Stripe's proration rules need to be considered.

## Decision

Subscription price synchronization is **opt-in** via `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true`.

When enabled, the connector listens to Stripe's `invoice.upcoming` webhook (fires ~1 hour before an invoice is generated) and:
1. Reads the current CT price for each subscription line item
2. Compares to the Stripe subscription item price
3. If different, calls `stripe.subscriptions.update()` with the new price
4. Creates a new Stripe Price object if no matching price exists

## Consequences

- Default (disabled): prices are set at subscription creation and never updated automatically — merchants must manage price changes manually
- Enabled: price changes in CT propagate to Stripe within ~1 hour before the next billing cycle
- The `invoice.upcoming` webhook is only sent for active subscriptions — cancelled subscriptions are not synced
- Proration behavior on price change is controlled by the `stripeConnector_proration_behavior` product attribute
- CT price ID and variant SKU are stored in Stripe Price metadata (`ct_price_id`, `ct_variant_sku`) to enable reverse lookup

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| Sync on every CT price update event | Requires CT subscriptions (messages) + additional infrastructure; overkill for most merchants |
| Always sync on invoice.upcoming | Unexpected behavior if merchant intentionally wants Stripe prices to diverge; opt-in is safer |
