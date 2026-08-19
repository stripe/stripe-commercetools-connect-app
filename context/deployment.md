# Deployment — ct-connect-stripe-composable

Prerequisites, configuration, and deploy/undeploy lifecycle for CT Connect. Source of truth: `connect.yaml`.

---

## Prerequisites

Complete these steps before deploying the connector. Skipping any will cause silent failures.

### Stripe account

- [ ] Stripe account with **multicapture enabled** (if using `STRIPE_ENABLE_MULTI_OPERATIONS=true`) — Dashboard → Settings → Payment capturing
- [ ] Create a Webhook Endpoint in Stripe Dashboard pointing to `<CONNECT_SERVICE_URL>/stripe/webhooks`
- [ ] Note the Webhook Endpoint ID (`we_*****`) — required as `STRIPE_WEBHOOK_ID`
- [ ] Note the Webhook Signing Secret (`whsec_*****`) — required as `STRIPE_WEBHOOK_SIGNING_SECRET`
- [ ] Note the Publishable Key and Secret Key

### commercetools project

- [ ] API client with these scopes on `CTP_CLIENT_ID`:
  - `manage_payments`
  - `manage_orders`
  - `view_sessions`
  - `view_api_clients`
  - `manage_checkout_payment_intents`
  - `introspect_oauth_tokens`
  - `manage_types`
  - `view_types`
- [ ] Subscription Product Type created with `stripeConnector_*` attributes (see `context/ARCHITECTURE.md` — Subscription product type attributes table). Key must match `CT_PRODUCT_TYPE_SUBSCRIPTION_KEY`.
- [ ] **Launchpad custom type created manually** (see `context/known-issues.md` KI-004) — the deploy script does NOT auto-create it.

### Apple Pay (optional)

- [ ] Domain association file served at `/.well-known/apple-developer-merchantid-domain-association`
- [ ] Set `STRIPE_APPLE_PAY_WELL_KNOWN` to the URL of the Stripe-provided file

---

## Environment Variables

### Standard configuration (not encrypted)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `CTP_PROJECT_KEY` | Yes | — | CT project key |
| `CTP_AUTH_URL` | Yes | `https://auth.europe-west1.gcp.commercetools.com` | |
| `CTP_API_URL` | Yes | `https://api.europe-west1.gcp.commercetools.com` | |
| `CTP_SESSION_URL` | Yes | `https://session.europe-west1.gcp.commercetools.com` | |
| `CTP_CHECKOUT_URL` | Yes | — | |
| `CTP_JWKS_URL` | Yes | `https://mc-api.europe-west1.gcp.commercetools.com/.well-known/jwks.json` | |
| `CTP_JWT_ISSUER` | Yes | `https://mc-api.europe-west1.gcp.commercetools.com` | |
| `STRIPE_WEBHOOK_ID` | Yes | — | `we_*****` from Stripe Dashboard |
| `STRIPE_PUBLISHABLE_KEY` | Yes | — | `pk_*****` |
| `MERCHANT_RETURN_URL` | Yes | — | URL for 3DS redirects |
| `STRIPE_COLLECT_BILLING_ADDRESS` | Yes | `auto` | `auto` \| `never` \| `if_required` |
| `CT_CUSTOM_TYPE_LAUNCHPAD_PURCHASE_ORDER_KEY` | Yes | `payment-launchpad-purchase-order` | |
| `CT_CUSTOM_TYPE_STRIPE_CUSTOMER_KEY` | Yes | `payment-connector-stripe-customer-id` | |
| `CT_CUSTOM_TYPE_SUBSCRIPTION_LINE_ITEM_KEY` | Yes | `payment-connector-subscription-line-item-type` | |
| `CT_PRODUCT_TYPE_SUBSCRIPTION_KEY` | Yes | `payment-connector-subscription-information` | |
| `STRIPE_CAPTURE_METHOD` | No | `automatic` | `automatic` \| `manual` |
| `STRIPE_APPEARANCE_PAYMENT_ELEMENT` | No | — | JSON string (Stripe Appearance API) |
| `STRIPE_APPEARANCE_EXPRESS_CHECKOUT` | No | — | JSON string (Stripe Appearance API) |
| `STRIPE_LAYOUT` | No | `{"type":"tabs","defaultCollapsed":false}` | JSON string |
| `STRIPE_SAVED_PAYMENT_METHODS_CONFIG` | No | `{"payment_method_save":"disabled"}` | JSON string |
| `STRIPE_APPLE_PAY_WELL_KNOWN` | No | — | URL for Apple Pay domain file |
| `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING` | No | `createOrder` | `createOrder` \| `addPaymentToOrder` |
| `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED` | No | `false` | `true` \| `false` |
| `STRIPE_ENABLE_MULTI_OPERATIONS` | No | `false` | `true` \| `false` — requires Stripe account config |
| `STRIPE_PAYMENT_FLOW` | No | `deferred` | `deferred` \| `pi_first` (case-sensitive). Required by bank transfers and BLIK — **do not set `pi_first` yet**, see below |
| `STRIPE_PAYMENT_BEHAVIOR_RULES` | No | — | JSON map of cart country or CT store key to per-market overrides. See below |

**`STRIPE_PAYMENT_FLOW`** selects how the enabler initializes Stripe Elements. `deferred` creates Elements
with `{ mode, amount, currency }` and the PaymentIntent at submit. `pi_first` creates the PaymentIntent
before the Element mounts and initializes Elements with its `clientSecret`, which bank transfers
(`customer_balance`) and BLIK require — they cannot render in the deferred flow at all.

> **Do not set `pi_first` yet.** Two open processor-side risks: mounting the payment page alone creates a
> PaymentIntent and a commercetools Payment with no deterministic idempotency key, so any remount orphans
> the previous pair (KI-044); and an unfunded bank transfer makes the cart read as paid in full (KI-049).
> An invalid value does **not** abort startup — it is reported to the deploy log and falls back to
> `deferred`, which silently disables bank transfers and BLIK. Check that log after changing it.

**`STRIPE_PAYMENT_BEHAVIOR_RULES`** contains exceptions only — the flat variables above are always the
default, and there is no wildcard key. Keys are a cart country (`"DE"`) or a CT store key (`"store-mx"`).
Rule fields: `flowType`, `captureMethod` (`automatic` \| `automatic_async` \| `manual`), `setupFutureUsage`
(`off_session` \| `on_session` \| `""` \| `none` \| `null` \| `undefined`) and `euBankTransferCountry`
(`DE` \| `FR` \| `IE` \| `NL`).

Example: `{"DE":{"captureMethod":"automatic","euBankTransferCountry":"DE"},"MX":{"captureMethod":"manual"}}`

Bank transfers have **no enable flag here, by design**. Whether the rail is offered at all is a Stripe
Dashboard setting for the whole account; whether the widget can render it is `STRIPE_PAYMENT_FLOW`. This
map resolves only the two conflicts the Dashboard cannot see: `captureMethod`, because manual capture and
an `off_session`/`on_session` mandate each remove `customer_balance` from the methods Stripe resolves; and
`euBankTransferCountry`, which only chooses which of your IBANs a EUR shopper is told to wire to — omit it
and Stripe shows an Irish IBAN, valid for every eurozone shopper since SEPA is a single payment area. A
market already on the default automatic capture needs no entry at all.

Two failure modes: malformed JSON, a non-object map or a non-object rule **abort startup** (no per-field
fallback exists, so the alternative is silently losing every rule at once). An unknown field or an invalid
**value** does not abort — it is reported to the deploy log and ignored, so that one setting falls back to
its default and the deployment survives a typo.

### Secured configuration (encrypted by CT Connect)

| Variable | Required | Notes |
|---|---|---|
| `CTP_CLIENT_SECRET` | Yes | CT API client secret |
| `CTP_CLIENT_ID` | Yes | CT API client ID with required scopes |
| `STRIPE_SECRET_KEY` | Yes | `sk_*****` |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | Yes | `whsec_*****` |

---

## Deploy Lifecycle

### Post-deploy (`npm run connector:post-deploy`)

Runs `processor/src/connectors/post-deploy.ts`. Executed automatically by CT Connect after deployment.

**What it does (in order):**

1. **Check Launchpad custom type** — calls `getTypeByKey()` for `CT_CUSTOM_TYPE_LAUNCHPAD_PURCHASE_ORDER_KEY`. Logs whether it exists. Does NOT create it. Fails silently if absent.
2. **Update Stripe webhook** — retrieves the webhook endpoint by `STRIPE_WEBHOOK_ID` and updates its URL to `<CONNECT_SERVICE_URL>/stripe/webhooks` and its enabled events to:
   - `charge.succeeded`
   - `charge.captured`
   - `payment_intent.succeeded`
   - `charge.refunded`
   - `refund.updated`
   - `refund.failed`
   - `payment_intent.canceled`
   - `payment_intent.payment_failed`
   - `payment_intent.requires_action`
   - `payment_intent.processing`
   - `payment_intent.partially_funded`
   - `customer_cash_balance_transaction.created`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `invoice.upcoming`

   > **Verify this list after every deploy** — `stripe webhook_endpoints list --project-name=<profile>`.
   > `updateWebhookEndpoint` replaces `enabled_events` wholesale inside a `try/catch` that logs and does
   > not re-throw, so a failed call leaves the deploy reporting success while the events are never
   > delivered. Observed on a developer account, where two endpoints were missing `invoice.upcoming`
   > despite it being present in the code. What a failed update costs is refund correctness and
   > observability — `refund.updated`/`refund.failed` correct a refund Stripe later rejects,
   > `payment_intent.partially_funded` is the underpayment audit trail, and
   > `customer_cash_balance_transaction.created` is the only clawback signal. The core bank transfer
   > flow rides on `payment_intent.requires_action` and `payment_intent.succeeded`, which predate this
   > work. See KI-042.
3. **Create subscription product type** — creates or updates `payment-connector-subscription-information` product type with all `stripeConnector_*` attributes.
4. **Create line item custom type** — creates or updates `payment-connector-subscription-line-item-type` with fields: `stripeConnector_productSubscriptionId`, `stripeConnector_stripeSubscriptionId`, `stripeConnector_stripeSubscriptionError`.
5. **Create customer custom type** — creates or updates `payment-connector-stripe-customer-id` with field `stripeConnector_stripeCustomerId`.

> **Note:** If `STRIPE_WEBHOOK_ID` is empty, step 2 is skipped with a warning. The webhook URL must be configured manually in the Stripe Dashboard.

### Pre-undeploy (`npm run connector:pre-undeploy`)

Runs `processor/src/connectors/pre-undeploy.ts`. Executed automatically by CT Connect before undeployment.

**What it does:**

1. Removes subscription product type (`CT_PRODUCT_TYPE_SUBSCRIPTION_KEY`)
2. Removes line item custom type (`CT_CUSTOM_TYPE_SUBSCRIPTION_LINE_ITEM_KEY`)
3. Removes customer custom type (`CT_CUSTOM_TYPE_STRIPE_CUSTOMER_KEY`)

> **Note:** The Launchpad custom type (`CT_CUSTOM_TYPE_LAUNCHPAD_PURCHASE_ORDER_KEY`) is NOT removed on undeploy.

---

## Deployed Applications

CT Connect deploys two applications from this connector (defined in `connect.yaml`):

| Name | Type | Description |
|---|---|---|
| `enabler` | `assets` | Frontend JavaScript bundle — serves the Stripe Payment Element and Express Checkout dropin |
| `processor` | `service` | Backend Node.js service — all Stripe and CT API calls, webhook handler |

The processor exposes its root at `/`. The enabler is a static asset bundle consumed by the merchant's frontend.

---

## Validation After Deploy

1. Stripe Dashboard → Webhooks → confirm the endpoint URL is updated and all 10 events are enabled
2. CT Merchant Center → Types → confirm `payment-connector-stripe-customer-id`, `payment-connector-subscription-line-item-type` exist
3. CT Merchant Center → Product Types → confirm `payment-connector-subscription-information` exists with all `stripeConnector_*` attributes
4. Hit `GET <CONNECT_SERVICE_URL>/health` — expect `200 OK`
5. Place a test subscription order end-to-end with a Stripe test card
