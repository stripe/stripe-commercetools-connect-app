# stripe-commercetools-connect-app — Adopter Guide

> Who this is for: teams deploying stripe-commercetools-connect-app for subscription payments, mixed carts, or price sync.
> For connector internals see `context/ARCHITECTURE.md`.

---

## 1. Prerequisites

Before deploying, confirm you have:

**commercetools:**
- CT project with API client credentials (client ID, client secret, project key)
- API client scopes the connector's client declares (`connect.yaml:100`): `manage_payments`, `manage_orders`, `view_sessions`, `view_api_clients`, `manage_checkout_payment_intents`, `introspect_oauth_tokens`, `manage_types`, `view_types`.
- `manage_subscriptions` is **not** a scope of this client. The subscription cancel/update/patch routes check the **caller's** OAuth token — the host backend's — with `authorize('manage_project', 'manage_subscriptions')` (`processor/src/routes/stripe-subscription.route.ts:156`, `:203`, `:256`); see `host-integration.md` §2 for that client.

**Stripe:**
- Stripe account (test or live)
- Stripe secret key
- Stripe publishable key
- Stripe webhook endpoint, created by you in Stripe Dashboard → Developers → Webhooks **before the first deploy**: its id is `STRIPE_WEBHOOK_ID` and its signing secret is `STRIPE_WEBHOOK_SIGNING_SECRET`, both `required: true` (`connect.yaml:45-47`, `connect.yaml:105-107`). Post-deploy retrieves the endpoint by `STRIPE_WEBHOOK_ID` and updates it only when its URL differs from the deployed one (`processor/src/connectors/post-deploy.ts:22-34`).

> With `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true`, Stripe needs **no pre-existing product or price** — the connector creates them.

---

## 2. What This Connector Deploys

Post-deploy creates or updates the three commercetools types below, and **updates** — never creates — the Stripe webhook endpoint you created before deploying (`processor/src/connectors/post-deploy.ts:22-40`):

| Component | Type | What it does |
| --- | --- | --- |
| Stripe webhook endpoint (**yours, updated**) | Stripe | Receives payment and subscription events. Post-deploy retrieves it by `STRIPE_WEBHOOK_ID` and, when its URL differs from the deployed one, points it at the processor's `/stripe/webhooks` and resets its enabled events (`processor/src/connectors/post-deploy.ts:30-34`) |
| `payment-connector-stripe-customer-id` | CT Custom Type (customer) | Links a CT customer to their Stripe Customer via `stripeConnector_stripeCustomerId` |
| `payment-connector-subscription-information` | CT Product Type | 15 subscription configuration attributes on product variants (`stripeConnector_*`) |
| `payment-connector-subscription-line-item-type` | CT Custom Type (line-item) | Stores `stripeConnector_stripeSubscriptionId` on cart line items |

> **Not created by the connector:** `payment-launchpad-purchase-order` — required for B2B purchase orders; must be created by your team before deploying. See Section 5.

---

## 3. Installation

### Step 1 — Deploy via CT Connect

Deploy `stripe-commercetools-connect-app` through the CT Connect marketplace. The post-deploy script runs automatically and creates the resources listed above.

### Step 2 — Configure environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | **Yes** | Stripe secret API key |
| `STRIPE_PUBLISHABLE_KEY` | **Yes** | Stripe publishable key — sent to the browser enabler |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | **Yes** | The signing secret of the endpoint you create in the Stripe Dashboard **before** the first deploy (`connect.yaml:105-107` marks it required) |
| `MERCHANT_RETURN_URL` | **Yes** | Full URL of your storefront's payment return page |
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
| `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED` | No | `true` to sync CT prices to Stripe for subscriptions |
| `STRIPE_PAYMENT_FLOW` | No | `deferred` (default) or `pi_first`. Required by bank transfers and BLIK |
| `STRIPE_PAYMENT_BEHAVIOR_RULES` | No | JSON map of per-market overrides, keyed by cart country or CT store key. Exceptions only; the flat variables above are always the default |

> **Before the first deploy:** create the webhook endpoint in Stripe Dashboard → Developers → Webhooks, then set `STRIPE_WEBHOOK_ID` to its id and `STRIPE_WEBHOOK_SIGNING_SECRET` to its signing secret — both are `required: true` (`connect.yaml:45-47`, `connect.yaml:105-107`). Post-deploy retrieves the endpoint by `STRIPE_WEBHOOK_ID` and, when its URL differs from the deployed one, updates its URL and enabled events (`processor/src/connectors/post-deploy.ts:22-34`).

### Bank transfers (`customer_balance`)

Bank transfers ship **disabled**. Nothing changes for your deployment unless you set
`STRIPE_PAYMENT_FLOW=pi_first`, and that variable plus the Bank transfers toggle in your Stripe Dashboard
is the whole configuration for a merchant on default settings.

Unlike a card, the shopper is shown account details and a reference, transfers the funds themselves, and
the money arrives hours or days later. The order is created only when it arrives.

**Four independent gates decide whether the method appears.** All four must hold:

1. Bank transfers enabled in the Stripe Dashboard, with a supported currency for your account country
2. `STRIPE_PAYMENT_FLOW=pi_first` — Elements must be initialized with a `clientSecret`
3. An authenticated shopper with a Stripe Customer — guests cannot use this rail, a Stripe constraint
4. Automatic capture and no `setup_future_usage` mandate — either one removes `customer_balance` from
   the methods Stripe resolves

Gate 4 is what `STRIPE_PAYMENT_BEHAVIOR_RULES` is for: a merchant running manual capture globally enables
bank transfer in one market with `{"DE":{"captureMethod":"automatic"}}`. There is deliberately no enable
flag — the rail itself is a Dashboard setting. The optional `euBankTransferCountry` field (`DE`, `FR`,
`IE`, `NL`) only chooses which of your IBANs a EUR shopper is told to wire to; omit it and Stripe shows an
Irish IBAN, which works for every eurozone shopper since SEPA is a single payment area.

### ACH Direct Debit (`us_bank_account`)

ACH needs **no connector configuration** — it is a toggle in your Stripe Dashboard. It does need an
operational decision, because the money moves days after the shopper leaves.

- **A subscription payment is `Charge/Pending` for ~2–4 business days.** The confirm does not write
  `Charge/Success` for a rail that has not settled. `invoice.paid` promotes it to `Success`;
  `invoice.payment_failed` turns it into `Failure`. Anything downstream that treats a commercetools
  `Charge` as "money received" regardless of state — fulfillment triggers, reporting, an OMS export —
  must wait for the transition.
- **Micro-deposit verification is supported for one-time payments only.** On a subscription cart the
  confirm throws — the rail is not offered. On a one-time cart the shopper's cart is frozen for the
  verification window, and the order is created only if the amount collected still matches the cart.
- **An order can be refused after the money was captured.** If the cart changed between payment and
  settlement, order creation is blocked and the payment is left as a `Charge/Success` with no order, for
  manual reconciliation. The connector never auto-refunds; this is logged at `error`.
- **Wire `ach_late_return` to an alert.** A settled ACH debit can be reversed by the shopper's bank for
  up to ~60 days. Stripe does not re-fire `invoice.payment_failed`, so the connector flags the
  commercetools payment with the native `paymentStatus.interfaceCode = 'ach_late_return'`; no transaction,
  order or refund is written, and the correction happens in your Stripe Dashboard. The same applies to
  `customer_cash_balance_transaction.created` with type `funding_reversed`, the equivalent signal on the
  bank-transfer rail.

### Step 3 — Verify post-deploy resources

In CT Merchant Center → Settings → Developer → API:
- Custom type `payment-connector-stripe-customer-id` exists
- Product type `payment-connector-subscription-information` exists with 15 `stripeConnector_*` attributes
- Custom type `payment-connector-subscription-line-item-type` exists

In Stripe Dashboard → Developers → Webhooks:
- Webhook endpoint for `https://your-processor/stripe/webhooks` exists

---

## 4. Configuring Products for Subscriptions

Every CT product variant sold as a subscription must have all required `stripeConnector_*` attributes on the `payment-connector-subscription-information` product type (verified against `processor/src/custom-types/custom-types.ts`):

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `stripeConnector_recurring_interval` | Enum (`day`, `week`, `month`, `year`) | **Yes** | Billing interval |
| `stripeConnector_recurring_interval_count` | Number | **Yes** | Interval count (e.g. `1` for every 1 month) |
| `stripeConnector_off_session` | Boolean | **Yes** | Whether the subscription is created off-session |
| `stripeConnector_collection_method` | Enum (`charge_automatically`, `send_invoice`) | **Yes** | How Stripe collects payment for invoices |
| `stripeConnector_description` | Text | No | Free-text description used as the Stripe Price nickname |
| `stripeConnector_days_until_due` | Number | No | Only applies when `collection_method=send_invoice`; default `1` |
| `stripeConnector_cancel_at_period_end` | Boolean | No | Cancel automatically at the end of the current period |
| `stripeConnector_cancel_at` | Datetime | No | Specific date/time to cancel the subscription |
| `stripeConnector_billing_cycle_anchor_day` | Number | No | Day of month for billing anchor |
| `stripeConnector_billing_cycle_anchor_time` | Time (HH:MM UTC) | No | Time of day for billing anchor |
| `stripeConnector_billing_cycle_anchor_date` | Datetime | No | Exact date/time for billing anchor; used only when `billing_cycle_anchor_day` is not set — day (with or without time) is checked first and wins (`processor/src/mappers/subscription-mapper.ts:88-110`) |
| `stripeConnector_trial_period_days` | Number | No | Trial length in days — mutually exclusive with `trial_end_date` |
| `stripeConnector_trial_end_date` | Datetime | No | Trial end date/time — mutually exclusive with `trial_period_days` |
| `stripeConnector_missing_payment_method_at_trial_end` | Enum (`cancel`, `create_invoice`, `pause`) | No | Behavior when trial ends without a saved payment method |
| `stripeConnector_proration_behavior` | Enum (`none`, `create_prorations`, `always_invoice`) | No | Proration behavior on price/plan change |

> There is no `stripeConnector_stripePriceId` attribute — the connector looks up or creates the Stripe Price itself via product/price metadata (see `context/business-rules/price-sync.md`); it does not read a pre-existing Stripe Price ID from the product.

---

## 5. Integrating the Enabler

The enabler bundle is served from the connector's `enabler` deployment (`connect.yaml:2-3`) and exports
`Enabler`. For how a storefront loads the bundle, creates the session, drives the drop-in and reads the
outcome, follow `host-integration.md` (§2–§5).

### One-time payments

The API is `createDropinBuilder('embedded')`, which returns a builder whose `.build(config)` produces the
mountable component; mount it on your payment element.

### Subscription checkout

Subscription mode is determined **server-side** from the cart: when the CT cart being checked out contains
a subscription line item, the processor's `GET /config-element/:payment` response sets
`paymentMode: 'subscription'` (`stripe-subscription.service.ts` → `getPaymentMode(cart)`) and the enabler
renders the subscription-aware Payment Element automatically.

### Express Checkout (Apple Pay / Google Pay)

Pass `paymentElementType: 'expressCheckout'` to the `Enabler` constructor (not to the drop-in builder).

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
- [ ] Create a product on the `payment-connector-subscription-information` product type with the required `stripeConnector_*` attributes set (see Section 4)
- [ ] Complete a subscription checkout — CT cart should be frozen; Stripe subscription appears in Dashboard
- [ ] Receive an `invoice.paid` event — a CT order should be created (or payment added, per `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING`)

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Stripe webhook events show HTTP 400 | `STRIPE_WEBHOOK_SIGNING_SECRET` wrong or not set | Copy from Stripe Dashboard webhook endpoint; redeploy |
| Payment succeeds in Stripe but CT not updated | Webhook signing secret mismatch | Same as above |
| CT cart remains Frozen while dunning retries | Expected — the cart is released only on terminal cancellation, not during the Smart Retry window | Wait for retries to be exhausted, or cancel the subscription in Stripe |
| Subscription order stuck in `Charge/Pending` for days | Expected on ACH — the debit has not settled yet. `invoice.paid` promotes it to `Success` | Wait for settlement; if it never arrives, check the PaymentIntent in the Stripe Dashboard |
| Payment captured in Stripe but no CT order exists | The order-creation amount gate refused: the cart total, `pi.amount` or `pi.amount_received` diverged | Reconcile manually — the connector never auto-refunds. Search the processor logs for the amount-mismatch error |
| All payments fail at startup with auth errors | Placeholder credentials still in env vars | Set all required env vars with real values |
