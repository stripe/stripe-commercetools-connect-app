# Reference — CT Connect Payments SDK

Package: `@commercetools/connect-payments-sdk@0.27.2`

Same base as [ct-connect-stripe-checkout reference](../../ct-connect-stripe-checkout/context/reference/ct-connect-payments-sdk.md).

## Composable-Specific Custom Types

The composable connector requires additional CT custom types beyond the base checkout connector. These are registered on deploy via `post-deploy.js`:

| Custom type key | Applied to | Purpose |
|---|---|---|
| `payment-connector-subscription-information` | Product type | Subscription attributes on product variants |
| `payment-connector-subscription-line-item-type` | Line item | Stores `stripeConnector_stripeSubscriptionId`, `stripeConnector_productSubscriptionId`, `stripeConnector_stripeSubscriptionError` on cart line item |
| `payment-connector-stripe-customer-id` | Customer | Stores `stripeConnector_stripeCustomerId` on CT customer |

## Cart Freezing Pattern

Subscriptions require the CT cart to be frozen after subscription initiation to prevent modification during active billing:

```typescript
// In cart-client.ts
await ctCartService.updateCart(cart, [{ action: 'freezeCart' }]);
```

The cart remains frozen for the subscription lifetime. If a subscription is cancelled, the cart can be unfrozen for re-use or a new cart must be created.

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
