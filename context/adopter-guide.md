# ct-connect-stripe-composable — Adopter Guide

> Who this is for: teams deploying ct-connect-stripe-composable for subscription payments, mixed carts, or price sync.
> For connector internals see `context/ARCHITECTURE.md`.
> Not sure which connector you need? See `ct-stripe/context/adopter-guide.md`.

---

## 1. Prerequisites

Before deploying, confirm you have:

**commercetools:**
- CT project with API client credentials (client ID, client secret, project key)
- API client scopes: `manage_payments`, `manage_orders`, `manage_customers`, `manage_types`, `manage_products`, `view_products`

**Stripe:**
- Stripe account (test or live)
- Stripe secret key (`sk_test_...` or `sk_live_...`)
- Stripe publishable key (`pk_test_...` or `pk_live_...`)
- Stripe webhook signing secret — created automatically by CT Connect post-deploy; do not set before first deploy

> If you use `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true`, Stripe must already have a product and price corresponding to every CT product variant with subscription attributes. Misconfiguration silently changes prices on live subscriptions.

---

## 2. What This Connector Deploys

Post-deploy creates these resources automatically:

| Component | Type | What it does |
| --- | --- | --- |
| Stripe webhook endpoint | Stripe | Receives payment and subscription events; delivers to processor's `/stripe/webhooks` |
| `payment-connector-stripe-customer-id` | CT Custom Type (customer) | Links a CT customer to their Stripe Customer via `stripeConnector_stripeCustomerId` |
| `payment-connector-subscription-information` | CT Product Type | 15 subscription configuration attributes on product variants (`stripeConnector_*`) |
| `payment-connector-subscription-line-item-type` | CT Custom Type (line-item) | Stores `stripeConnector_stripeSubscriptionId` on cart line items |

> **Not created by the connector:** `payment-launchpad-purchase-order` — required for B2B purchase orders; must be created by your team before deploying. See Section 5.

---

## 3. Installation

### Step 1 — Deploy via CT Connect

Deploy `ct-connect-stripe-composable` through the CT Connect marketplace. The post-deploy script runs automatically and creates the resources listed above.

### Step 2 — Configure environment variables

**Shared with ct-connect-stripe-checkout:**

| Variable | Required | Description |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | **Yes** | Stripe secret API key |
| `STRIPE_PUBLISHABLE_KEY` | **Yes** | Stripe publishable key — sent to the browser enabler |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | **Yes** | Copy from Stripe Dashboard after first deploy |
| `MERCHANT_RETURN_URL` | **Yes** | Full URL of your storefront's payment return page |
| `ALLOWED_ORIGINS` | **Yes** | Comma-separated storefront origins for `/express-config` (without this, Express Checkout returns 403) |
| `CTP_PROJECT_KEY` | **Yes** | CT project key |
| `CTP_CLIENT_ID` | **Yes** | CT API client ID |
| `CTP_CLIENT_SECRET` | **Yes** | CT API client secret |
| `STRIPE_CAPTURE_METHOD` | No | `automatic` (default), `automatic_async`, or `manual` |
| `STRIPE_ENABLE_MULTI_OPERATIONS` | No | `true` to enable partial captures and multi-refund |
| `STRIPE_COLLECT_BILLING_ADDRESS` | No | `auto` (default), `never`, or `if_required` |

**Composable-only:**

| Variable | Required | Description |
| --- | --- | --- |
| `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING` | No | `createOrder` (default) or `addPaymentToOrder` — controls how recurring invoices create records in CT |
| `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED` | No | `true` to sync CT prices to Stripe on `invoice.upcoming`. Use with caution — see prerequisite note above |

> **After first deploy:** copy `STRIPE_WEBHOOK_SIGNING_SECRET` from Stripe Dashboard → Developers → Webhooks → your endpoint. Redeploy.

### Step 3 — Verify post-deploy resources

In CT Merchant Center → Settings → Developer → API:
- Custom type `payment-connector-stripe-customer-id` exists
- Product type `payment-connector-subscription-information` exists with 15 `stripeConnector_*` attributes
- Custom type `payment-connector-subscription-line-item-type` exists

In Stripe Dashboard → Developers → Webhooks:
- Webhook endpoint for `https://your-processor/stripe/webhooks` exists

---

## 4. Configuring Products for Subscriptions

Every CT product variant sold as a subscription must have all required `stripeConnector_*` attributes on the `payment-connector-subscription-information` product type:

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `stripeConnector_stripePriceId` | String | **Yes** | Stripe Price ID (`price_...`) for this variant |
| `stripeConnector_isSubscription` | Boolean | **Yes** | Must be `true` to enable subscription checkout |
| `stripeConnector_billingCycleAnchorConfig_day` | Number | No | Day of month for billing anchor |
| `stripeConnector_billingCycleAnchorConfig_hour` | Number | No | Hour for billing anchor |
| `stripeConnector_billingCycleAnchorConfig_minute` | Number | No | Minute for billing anchor |
| `stripeConnector_billingCycleAnchorConfig_month` | Number | No | Month for billing anchor (yearly subscriptions) |
| `stripeConnector_proration_behavior` | String | No | `create_prorations`, `none`, or `always_invoice` |
| `stripeConnector_trialPeriodDays` | Number | No | Trial period in days |
| `stripeConnector_paymentBehavior` | String | No | Stripe subscription `payment_behavior` value |
| `stripeConnector_pendingInvoiceItemInterval_interval` | String | No | `day`, `week`, `month`, or `year` |
| `stripeConnector_pendingInvoiceItemInterval_intervalCount` | Number | No | Interval count |

> The `stripeConnector_stripePriceId` must exist as a valid Stripe Price before checkout. The connector does not create Stripe prices from CT price data; it only reads `stripePriceId` and uses it directly.

---

## 5. Integrating the Enabler

### One-time payments

Same as ct-connect-stripe-checkout:

```typescript
import { Enabler } from '@your-scope/ct-connect-stripe-composable-enabler';

const enabler = new Enabler({
  processorUrl: 'https://your-processor.ct-connect.example.com',
  sessionId: ctSessionId,
  locale: 'en-US',
});

const dropin = await enabler.createDropin({ paymentElementType: 'paymentElement' });
await dropin.mount('#payment-element');
```

### Subscription checkout

Pass `paymentMode: 'subscription'` when creating the drop-in. The enabler calls `POST /subscription` on the processor and freezes the CT cart automatically.

```typescript
const dropin = await enabler.createDropin({
  paymentElementType: 'paymentElement',
  paymentMode: 'subscription',
});
await dropin.mount('#payment-element');
```

### Express Checkout (Apple Pay / Google Pay)

```typescript
const dropin = await enabler.createDropin({ paymentElementType: 'expressCheckout' });
await dropin.mount('#express-checkout-element');
```

### B2B Launchpad purchase orders

Create the `payment-launchpad-purchase-order` CT custom type **before deploying**:

```typescript
{
  key: 'payment-launchpad-purchase-order',
  resourceTypeIds: ['payment'],
  fields: [
    { name: 'launchpadPurchaseOrderNumber', type: { name: 'String' }, required: false },
    { name: 'launchpadPurchaseOrderInvoiceMemo', type: { name: 'String' }, required: false },
  ]
}
```

---

## 6. Verification Checklist

Before go-live:

**One-time payments:**
- [ ] `GET /operations/config` returns `publishableKey`
- [ ] Complete a test payment with Stripe test card `4242 4242 4242 4242` — CT payment has `CHARGE:SUCCESS`
- [ ] Stripe Dashboard shows PaymentIntent with `ct_payment_id` in metadata
- [ ] Stripe Dashboard → Webhooks → Recent deliveries — all events show HTTP 200

**Subscriptions:**
- [ ] Create a product with `stripeConnector_isSubscription=true` and a valid `stripeConnector_stripePriceId`
- [ ] Complete a subscription checkout — CT cart should be frozen; Stripe subscription appears in Dashboard
- [ ] Receive an `invoice.paid` event — a CT order should be created (or payment added, per `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING`)
- [ ] Cancel the subscription in Stripe Dashboard — manually verify CT cart state (see known gap below)

---

## 7. Known Gaps

These behaviors are not bugs in your configuration — they are known limitations of the current connector version:

| Gap | What happens | Workaround |
| --- | --- | --- |
| Subscription cancellation does not update CT | `cancelSubscription()` cancels in Stripe but CT cart remains Frozen | Manually unfreeze via CT API: `changeCartState → Active`; clear `stripeConnector_stripeSubscriptionId` on the line item |
| `customer.subscription.deleted` webhook not registered | Stripe sends this event on dunning/cancellation but the connector does not subscribe | No automatic recovery — monitor Stripe Dashboard for canceled subscriptions and unfreeze carts manually |
| Cart freeze failure silently swallowed | If cart freeze fails after subscription creation, cart stays modifiable | Check processor logs for freeze errors; manually freeze: `changeCartState → Frozen` |

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Stripe webhook events show HTTP 400 | `STRIPE_WEBHOOK_SIGNING_SECRET` wrong or not set | Copy from Stripe Dashboard webhook endpoint; redeploy |
| Payment succeeds in Stripe but CT not updated | Webhook signing secret mismatch | Same as above |
| Subscription created but CT cart still Active (not Frozen) | Cart freeze failed silently | Check processor logs; manually freeze cart via CT API |
| CT cart remains Frozen after subscription canceled | `customer.subscription.deleted` not registered (known gap) | Manually unfreeze cart and clear subscription ID on line item |
| Recurring invoice paid but no CT order created | Subscription event processing error swallowed (connector returns 200 regardless) | Check processor logs around the `invoice.paid` event timestamp |
| Price sync changes live subscription prices unexpectedly | `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true` with misconfigured prices | Disable price sync; audit Stripe prices against CT product attributes |
| Express Checkout buttons not appearing | `ALLOWED_ORIGINS` not set | Set `ALLOWED_ORIGINS` to your storefront's origin |
| All payments fail at startup with auth errors | Placeholder credentials still in env vars | Set all required env vars with real values |
