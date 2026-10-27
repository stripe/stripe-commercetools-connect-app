# Reference — Stripe API v20: Payment Intents & Setup Intents

Stripe SDK version used: `stripe@^20.1.0`

## SetupIntent (Composable-specific)

Used to save a payment method for future off-session subscription charges without an immediate payment.

```typescript
const setupIntent = await stripe.setupIntents.create({
  customer: stripeCustomerId,
  usage: 'off_session',
  metadata: { cart_id, ct_project_key, ct_customer_id }, // ct_customer_id only when the cart has a customerId
});
// Returns: { client_secret: 'seti_xxx_secret_xxx' }
```

The metadata is `getPaymentMetadata(cart)` (`processor/src/services/stripe-subscription.service.ts:966`;
keys built at `processor/src/services/ct-payment-creation.service.ts:156-158`, names in
`processor/src/constants.ts:1-5`).

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
  metadata: { cart_id, ct_project_key, ct_customer_id, ct_cart_total_amount, ct_cart_total_currency }
});
```

At create, the metadata is `sealCartTotal(cart, getPaymentMetadata(cart))`
(`processor/src/services/stripe-subscription.service.ts:192`, `processor/src/services/stripe-subscription.service.ts:298`, `processor/src/services/stripe-subscription.service.ts:1691-1696`) — the cart keys of
`processor/src/services/ct-payment-creation.service.ts:156-158` plus the sealed cart total. Keys are added to the
subscription afterwards: `ct_payment_id` once the CT payment exists
(`processor/src/services/ct-payment-creation.service.ts:134-140`), and `ct_order_id` once the order is created
(`processor/src/services/stripe-payment.service.ts:2084-2089`).

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
| `invoice.paid` | Add `CHARGE` transaction (recurring). Also promotes an async `CHARGE/Pending` — written at confirm for an ACH `us_bank_account` debit still `processing` — to `Success` |
| `invoice.payment_failed` | Add `AUTHORIZATION` (Failure), or turn an async `CHARGE/Pending` into `Failure` |
| `invoice.upcoming` | Trigger price sync (if `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true`) |
| `customer.subscription.deleted` | Registered and handled. Terminal cancellation unfreezes the subscription's cart, resolved via `ct_payment_id` metadata. No payment or order change |
| `charge.succeeded` | Registered, but **dropped** when it originates from a subscription invoice (`isFromSubscriptionInvoice()`) — `invoice.paid` is the single source of truth for recurring payments |
| `payment_intent.payment_failed` | On a subscription invoice that had **already** settled, this is an ACH late return: flags the CT payment with `paymentStatus.interfaceCode='ach_late_return'`. No transaction or order change |

## Subscription Product Attribute Mapping

Products must belong to a product type with `stripeConnector_` prefixed attributes. The mapper `getSubscriptionAttributes` (`processor/src/mappers/subscription-mapper.ts:6-41`) translates most of them to Stripe subscription params. The two recurring attributes are **not** read by the mapper: they go into the standalone recurring Price the connector creates with `stripe.prices.create` (`processor/src/services/stripe-subscription.service.ts:903-919`; the shipping Price likewise, `processor/src/services/stripe-subscription.service.ts:931-941`), and the subscription's `items[]` references that Price by id (`processor/src/services/stripe-subscription.service.ts:185`). This table is not a complete list of the mapped attributes:

| CT attribute | Stripe param |
|---|---|
| `stripeConnector_recurring_interval` | `prices.create` → `recurring.interval` (`processor/src/services/stripe-subscription.service.ts:913`, `processor/src/services/stripe-subscription.service.ts:939`) |
| `stripeConnector_recurring_interval_count` | `prices.create` → `recurring.interval_count` (`processor/src/services/stripe-subscription.service.ts:914`, `processor/src/services/stripe-subscription.service.ts:940`) |
| `stripeConnector_trial_period_days` | `trial_period_days` |
| `stripeConnector_proration_behavior` | `proration_behavior` on update |

## Official Docs

- SetupIntents: https://stripe.com/docs/api/setup_intents
- Subscriptions: https://stripe.com/docs/api/subscriptions
- Subscription webhooks: https://stripe.com/docs/billing/subscriptions/webhooks
- Mixed payment models: https://stripe.com/docs/billing/subscriptions/model
