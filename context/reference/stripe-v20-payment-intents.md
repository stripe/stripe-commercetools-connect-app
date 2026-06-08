# Reference — Stripe API v20: Payment Intents & Setup Intents

Stripe SDK version used: `stripe@^20.1.0`

See also: [ct-connect-stripe-checkout reference](../../ct-connect-stripe-checkout/context/reference/stripe-v20-payment-intents.md) for base PaymentIntent documentation.

## SetupIntent (Composable-specific)

Used to save a payment method for future off-session subscription charges without an immediate payment.

```typescript
const setupIntent = await stripe.setupIntents.create({
  customer: stripeCustomerId,
  usage: 'off_session',
  metadata: { ct_cart_id: cartId }
});
// Returns: { client_secret: 'seti_xxx_secret_xxx' }
```

The `client_secret` is passed to the frontend's Payment Element to collect the payment method.

## Subscription API (Composable-specific)

### Create subscription from cart

```typescript
await stripe.subscriptions.create({
  customer: stripeCustomerId,
  items: [{ price: stripePriceId, quantity: lineItemQuantity }],
  payment_behavior: 'default_incomplete',
  payment_settings: { save_default_payment_method: 'on_subscription' },
  expand: ['latest_invoice.confirmation_secret'],
  metadata: { ct_cart_id, ct_order_id }
});
```

### Key subscription statuses

| Status | Meaning |
|---|---|
| `incomplete` | Awaiting first payment confirmation |
| `active` | First payment succeeded, billing is active |
| `past_due` | Latest invoice payment failed; retrying |
| `canceled` | Subscription terminated |
| `unpaid` | All retry attempts exhausted |

## Webhook Events (Subscriptions)

| Event | CT Action |
|---|---|
| `invoice.paid` | Add `CHARGE` transaction (recurring) |
| `invoice.payment_failed` | Add `AUTHORIZATION` (Failure) |
| `invoice.upcoming` | Trigger price sync (if `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true`) |
| `customer.subscription.deleted` | **Not yet implemented** — event declared in enum only; not registered in `actions.ts` enabled events, Stripe will not send it to this connector (TODO) |
| `charge.succeeded` | Supplement for first invoice charge confirmation |

## Subscription Product Attribute Mapping

Products must belong to a product type with `stripeConnector_` prefixed attributes. The mapper at `src/mappers/subscription-mapper.ts` translates these to Stripe subscription params:

| CT attribute | Stripe param |
|---|---|
| `stripeConnector_recurring_interval` | `items[].price_data.recurring.interval` |
| `stripeConnector_recurring_interval_count` | `items[].price_data.recurring.interval_count` |
| `stripeConnector_trial_period_days` | `trial_period_days` |
| `stripeConnector_proration_behavior` | `proration_behavior` on update |

## Official Docs

- SetupIntents: https://stripe.com/docs/api/setup_intents
- Subscriptions: https://stripe.com/docs/api/subscriptions
- Subscription webhooks: https://stripe.com/docs/billing/subscriptions/webhooks
- Mixed payment models: https://stripe.com/docs/billing/subscriptions/model
