# ct-connect-stripe-composable — Adopter Guide

> Who this is for: teams deploying ct-connect-stripe-composable for subscription payments, mixed carts, or price sync.
> For connector internals see `context/ARCHITECTURE.md`.
> Not sure which connector you need? See `ct-stripe/context/adopter-guide.md`.

---

## 1. Prerequisites

Before deploying, confirm you have:

**commercetools:**
- CT project with API client credentials (client ID, client secret, project key)
- API client scopes: `manage_payments`, `manage_orders`, `manage_customers`, `manage_types`, `manage_products`, `view_products`, `manage_subscriptions` (required for the subscription cancel/update/patch endpoints — see `processor/src/routes/stripe-subscription.route.ts`)

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
| `STRIPE_PAYMENT_FLOW` | No | `deferred` (default) or `pi_first`. Required by bank transfers and BLIK — **do not set `pi_first` yet**, see below |
| `STRIPE_PAYMENT_BEHAVIOR_RULES` | No | JSON map of per-market overrides, keyed by cart country or CT store key. Exceptions only; the flat variables above are always the default |

> **After first deploy:** copy `STRIPE_WEBHOOK_SIGNING_SECRET` from Stripe Dashboard → Developers → Webhooks → your endpoint. Redeploy.

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

> **Not yet ready to enable.** `pi_first` has two open processor-side risks: opening the payment page
> alone creates a PaymentIntent and a CT Payment with no deterministic idempotency key, so a remount
> orphans the previous pair (no KI of its own — recorded in `CHANGELOG.md → Known gaps` and in the
> resolution note of KI-044, which is itself resolved and no longer a blocker); and an unfunded bank
> transfer makes the cart read as paid in full, so a shopper reloading the page sees an error rather than
> an "awaiting your transfer" state (KI-049). Subscriptions are out of scope by decision — a renewal
> debits a cash balance the shopper must keep pre-funded, which needs a top-up flow this connector does
> not provide.

### ACH Direct Debit (`us_bank_account`)

ACH needs **no connector configuration** — it is a toggle in your Stripe Dashboard, and none of the
behavior below is behind a flag. What it does need is an operational decision, because the money moves
days after the shopper leaves.

- **A subscription payment is `Charge/Pending` for ~2–4 business days.** The confirm no longer writes
  `Charge/Success` for a rail that has not settled. If anything downstream of you treats a commercetools
  `Charge` as "money received" regardless of state — fulfillment triggers, reporting, an OMS export — it
  will now see a Pending charge with no order, and must wait for the transition. `invoice.paid` promotes
  it to `Success`; `invoice.payment_failed` turns it into `Failure`.
- **Micro-deposit verification is supported for one-time payments only.** On a subscription cart the
  confirm throws — the rail is not offered. On a one-time cart the shopper's cart is frozen for the
  verification window, and the order is created only if the amount collected still matches the cart.
- **An order can be refused after the money was captured.** If the cart changed between payment and
  settlement, order creation is blocked and the payment is left as a `Charge/Success` with no order, for
  a human to reconcile. By hub rule the connector never auto-refunds. Watch your processor logs for this;
  it is logged at `error`.
- **Wire `ach_late_return` to an alert.** A settled ACH debit can be reversed by the shopper's bank for
  up to ~60 days. Stripe does not re-fire `invoice.payment_failed`, so the connector flags the CT payment
  with the native `paymentStatus.interfaceCode = 'ach_late_return'` and stops there — no transaction,
  order or refund is written, and the correction happens in your Stripe Dashboard. The write is
  best-effort and never throws, so **this flag is your only in-connector signal that money was clawed
  back.** The same applies to `customer_cash_balance_transaction.created` with type `funding_reversed`,
  the equivalent signal on the bank-transfer rail.

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
| `stripeConnector_billing_cycle_anchor_date` | Datetime | No | Exact date/time for billing anchor; overrides day + time |
| `stripeConnector_trial_period_days` | Number | No | Trial length in days — mutually exclusive with `trial_end_date` |
| `stripeConnector_trial_end_date` | Datetime | No | Trial end date/time — mutually exclusive with `trial_period_days` |
| `stripeConnector_missing_payment_method_at_trial_end` | Enum (`cancel`, `create_invoice`, `pause`) | No | Behavior when trial ends without a saved payment method |
| `stripeConnector_proration_behavior` | Enum (`none`, `create_prorations`, `always_invoice`) | No | Proration behavior on price/plan change |

> There is no `stripeConnector_stripePriceId` attribute — the connector looks up or creates the Stripe Price itself via product/price metadata (see `context/business-rules/price-sync.md`); it does not read a pre-existing Stripe Price ID from the product.

---

## 5. Integrating the Enabler

### One-time payments

Same as ct-connect-stripe-checkout. There is no `enabler.createDropin()` method — the real API is `createDropinBuilder(type)`, which returns a builder whose `.build(config)` produces the mountable component:

```typescript
import { Enabler, DropinType } from '@your-scope/ct-connect-stripe-composable-enabler';

const enabler = new Enabler({
  processorUrl: 'https://your-processor.ct-connect.example.com',
  sessionId: ctSessionId,
  locale: 'en-US',
});

const dropinBuilder = await enabler.createDropinBuilder(DropinType.embedded);
const dropin = dropinBuilder.build({});
dropin.mount('#payment-element');
```

### Subscription checkout

There is no `paymentMode` option on `EnablerOptions` or on the drop-in's `build()` config — an adopter cannot select subscription mode directly. It is determined **server-side** from the cart: if the CT cart being checked out contains a subscription line item, the processor's `GET /config-element/:payment` response sets `paymentMode: 'subscription'` internally (`stripe-subscription.service.ts` → `getPaymentMode(cart)`), and the enabler renders the subscription-aware Payment Element automatically. Use the exact same snippet as basic checkout above — the only difference is what's in the cart.

### Express Checkout (Apple Pay / Google Pay)

Pass `paymentElementType: 'expressCheckout'` to the `Enabler` constructor (not to the drop-in builder):

```typescript
const enabler = new Enabler({
  processorUrl: 'https://your-processor.ct-connect.example.com',
  sessionId: ctSessionId,
  paymentElementType: 'expressCheckout',
});

const dropinBuilder = await enabler.createDropinBuilder(DropinType.embedded);
const dropin = dropinBuilder.build({});
dropin.mount('#express-checkout-element');
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
- [ ] Create a product on the `payment-connector-subscription-information` product type with the required `stripeConnector_*` attributes set (see Section 4)
- [ ] Complete a subscription checkout — CT cart should be frozen; Stripe subscription appears in Dashboard
- [ ] Receive an `invoice.paid` event — a CT order should be created (or payment added, per `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING`)
- [ ] Cancel the subscription in Stripe Dashboard — manually verify CT cart state (see known gap below)

---

## 7. Known Gaps

These behaviors are not bugs in your configuration — they are known limitations of the current connector version:

| Gap | What happens | Workaround |
| --- | --- | --- |
| Subscription cancellation does not update CT | `cancelSubscription()` cancels in Stripe but CT cart remains Frozen | Manually unfreeze via CT API: `changeCartState → Active`; clear `stripeConnector_stripeSubscriptionId` on the line item |
| Stale subscription ID left on the line item after cancellation | `customer.subscription.deleted` now unfreezes the cart automatically, but does not clear `stripeConnector_stripeSubscriptionId` | Clear the custom field manually if you rely on it to detect an active subscription; otherwise check Stripe directly |
| Cart freeze failure silently swallowed | If cart freeze fails after subscription creation, cart stays modifiable | Check processor logs for freeze errors; manually freeze: `changeCartState → Frozen` |

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Stripe webhook events show HTTP 400 | `STRIPE_WEBHOOK_SIGNING_SECRET` wrong or not set | Copy from Stripe Dashboard webhook endpoint; redeploy |
| Payment succeeds in Stripe but CT not updated | Webhook signing secret mismatch | Same as above |
| Subscription created but CT cart still Active (not Frozen) | Cart freeze failed silently | Check processor logs; manually freeze cart via CT API |
| CT cart remains Frozen after subscription canceled | The cancellation was merchant-initiated via `cancelSubscription()`, which cancels in Stripe only. Terminal cancellation *from Stripe* now unfreezes the cart via `customer.subscription.deleted` | Manually unfreeze cart and clear subscription ID on line item |
| CT cart remains Frozen while dunning retries | Expected — the cart is released only on terminal cancellation, not during the Smart Retry window | Wait for retries to be exhausted, or cancel the subscription in Stripe |
| Recurring invoice paid but no CT order created | A permanent error during subscription event processing is logged and swallowed (webhook returns 200). Transient errors are retried by Stripe instead | Check processor logs around the `invoice.paid` event timestamp |
| Subscription order stuck in `Charge/Pending` for days | Expected on ACH — the debit has not settled yet. `invoice.paid` promotes it to `Success` | Wait for settlement; if it never arrives, check the PaymentIntent in the Stripe Dashboard |
| Payment captured in Stripe but no CT order exists | The order-creation amount gate refused: the cart total, `pi.amount` or `pi.amount_received` diverged | Reconcile manually — the connector never auto-refunds. Search the processor logs for the amount-mismatch error |
| Price sync changes live subscription prices unexpectedly | `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true` with misconfigured prices | Disable price sync; audit Stripe prices against CT product attributes |
| All payments fail at startup with auth errors | Placeholder credentials still in env vars | Set all required env vars with real values |
