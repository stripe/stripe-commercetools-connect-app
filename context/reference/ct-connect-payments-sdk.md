# Reference — CT Connect Payments SDK

Package: `@commercetools/connect-payments-sdk@1.2.2`

> **Migrated 0.27.2 → 1.2.2.** The SDK has no own-API breaking change across that range; the
> impact is transitive — it pins `@commercetools/platform-sdk@9.4.0`,
> `@commercetools/ts-client@5.0.2`, `@commercetools-backend/loggers@27.9.3`, and `jwks-rsa@4` →
> `jose@6` (ESM-only). Consequences: the processor declares `engines.node >=24.22.1` (well above
> jose@6's own `>=20.19.0` `require()` floor), `jest.config.ts` transforms jose's ESM entry, and
> the local dev JWT harness is a native JWKS mock (`jwt-server/server.js`, `use:"sig"`).
> `ts-client@5` also defaults `maskSensitiveHeaderData` to `true`, so `Authorization` headers are
> redacted in request/response error logs.

## Composable-Specific Custom Types

The connector requires these CT custom types, registered on deploy by
`processor/src/connectors/post-deploy.ts:38-40` (run as `dist/connectors/post-deploy.js`,
`processor/package.json:16`):

| Custom type key | Applied to | Purpose |
|---|---|---|
| `payment-connector-subscription-information` | Product type | Subscription attributes on product variants |
| `payment-connector-subscription-line-item-type` | Line item | Stores `stripeConnector_stripeSubscriptionId`, `stripeConnector_productSubscriptionId`, `stripeConnector_stripeSubscriptionError` on cart line item |
| `payment-connector-stripe-customer-id` | Customer | Stores `stripeConnector_stripeCustomerId` on CT customer |

## Cart Freezing Pattern

Subscriptions require the CT cart to be frozen after subscription initiation:

```typescript
// In cart-client.ts
await ctCartService.updateCart(cart, [{ action: 'freezeCart' }]);
```

If a subscription is cancelled, the cart can be unfrozen for re-use or a new cart must be created.

## Subscription Line Item Lookup

To link a Stripe subscription item back to a CT line item:

1. Read `stripeConnector_stripeSubscriptionId` from CT line item custom field (`payment-connector-subscription-line-item-type`)
2. Match against Stripe subscription `id` to find the billing relationship

## Environment Variables (Additional)

| Variable | Default | Effect |
|---|---|---|
| `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED` | `false` | Enable automatic price sync on `invoice.upcoming` |
| `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING` | `createOrder` | `createOrder`: new CT order per recurring event; `addPaymentToOrder`: appends to existing order |
| `CT_CUSTOM_TYPE_SUBSCRIPTION_LINE_ITEM_KEY` | `payment-connector-subscription-line-item-type` | Key for line item custom type |
| `CT_PRODUCT_TYPE_SUBSCRIPTION_KEY` | `payment-connector-subscription-information` | Key for subscription product type |

## Official Docs

- CT Cart freeze: https://docs.commercetools.com/api/projects/carts#freeze-cart
- CT Custom types: https://docs.commercetools.com/api/projects/custom-objects
- CT Line item custom fields: https://docs.commercetools.com/api/projects/carts#set-lineitem-customfield
