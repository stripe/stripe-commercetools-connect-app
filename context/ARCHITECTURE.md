# Architecture — stripe-commercetools-connect-app

## At a glance

| # | Section | Read it when |
| --- | --- | --- |
| 1 | [Overview](#1-overview) | you need the one-paragraph picture |
| 2 | [Projects and placement](#2-projects-and-placement) | you need to know what deploys and why there is one `context/` |
| 3 | [Processor](#3-processor) | you are changing a route, a service or its caller |
| 4 | [Webhook events](#4-webhook-events) | you are adding, routing or debugging a Stripe event |
| 5 | [Enabler](#5-enabler) | you are changing the browser bundle or what it calls |
| 6 | [Cross-module and cross-application contracts](#6-cross-module-and-cross-application-contracts) | you change a response shape, a metadata key or a custom field |
| 7 | [commercetools data model](#7-commercetools-data-model) | you touch custom types, the subscription product type or Stripe metadata |
| 8 | [Elements initialization: `deferred` and `pi_first`](#8-elements-initialization-deferred-and-pi_first) | you touch `flowType`, bank transfer or the cart freeze |
| 9 | [Key Configuration](#9-key-configuration) | you set or read an environment variable |
| 10 | [Out of Scope](#10-out-of-scope) | someone asks "does it do X?" |

Every `file:line` is relative to the repository root.

---

## 1. Overview

A commercetools Connect payment connector for Stripe. It takes one-time payments through the Stripe
Payment Element and Express Checkout, sells recurring Stripe subscriptions from a commercetools cart
(including mixed carts of subscription and one-time items), saves payment methods through SetupIntents,
and mirrors every outcome back onto commercetools Payments and Orders from Stripe webhooks. It also
syncs commercetools discount codes to Stripe coupons, optionally syncs commercetools prices onto running
subscriptions, and exposes merchant-side capture, cancel and refund operations and a subscription
management API. Two modules ship together: a backend **processor** and a browser **enabler**.

---

## 2. Projects and placement

| Project | Type | Stack | Purpose |
| --- | --- | --- | --- |
| `processor/` | service (`applicationType: service`, `connect.yaml:4-6`) | TypeScript on Node `>=24.22.1` (`processor/package.json:22-24`), Fastify 5, `@commercetools/connect-payments-sdk` 1.2.2, `stripe` ^20.1.0 | Every Stripe and commercetools call; webhooks; post-deploy and pre-undeploy |
| `enabler/` | ui (browser bundle) | TypeScript, Vite library build, `@stripe/stripe-js`; Node `>=24.22.1` at build time | Mounts the Payment Element or Express Checkout Element in the host's page and calls the processor |
| `jwt-server/` | local development utility (`server.js`), no manifest | Node | Not deployed; not a module |

**One `context/` for both modules, at the repository root.** Both are deployed by the single
`connect.yaml`. The enabler has no function without the processor: it reads its configuration, customer
session, PaymentIntents and subscriptions only from processor routes, at the URL the commercetools
session supplies (`processorUrl`, read in `processor/src/libs/fastify/context/context.ts:42-65`).
Deployed alone, every enabler call targets a service that does not exist. The processor is partly
operable alone (webhooks, the subscription management API, merchant operations), but the enabler's
contract with it — twelve HTTP endpoints and their response shapes — means a change on either side has
to be read against the other.

```text
stripe-commercetools-connect-app/
├── connect.yaml          # deploys processor (service) and enabler (assets)
├── processor/            # backend
│   └── src/
│       ├── routes/       # Fastify routes (stripe-payment, stripe-subscription, stripe-shipping, stripe-customer, operation)
│       ├── services/     # payment, subscription, coupon, shipping, customer, ct-payment-creation, converters/, commerce-tools/
│       ├── connectors/   # post-deploy, pre-undeploy, actions (webhook endpoint, custom types, product type)
│       ├── config/       # config.ts — every environment variable
│       ├── custom-types/ # commercetools type and product-type drafts
│       ├── mappers/      # subscription, bank transfer
│       └── utils.ts      # predicates and shared guards (isFromSubscriptionInvoice, paidAmountMatchesTotal, retry classifier)
├── enabler/              # browser bundle
│   └── src/
│       ├── main.ts       # export { MockPaymentEnabler as Enabler }
│       ├── payment-enabler/  # construction, Elements creation, flowType handling
│       ├── dropin/       # DropinEmbeddedBuilder — mount, submit, Express events
│       └── services/     # api-service (processor calls), stripe-service (Stripe.js confirms)
├── jwt-server/           # local development only
└── docs/                 # team design notes and diagrams
```

---

## 3. Processor

### Layout

| Layer | Path | Purpose |
| --- | --- | --- |
| Routes | `processor/src/routes/stripe-payment.route.ts` | payments, confirm, config-element, Apple Pay file, the Stripe webhook dispatcher |
| Routes | `processor/src/routes/stripe-subscription.route.ts` | subscription creation and the `/subscription-api` management API |
| Routes | `processor/src/routes/stripe-shipping.route.ts` | Express Checkout shipping |
| Routes | `processor/src/routes/stripe-customer.route.ts` | Stripe customer session |
| Routes | `processor/src/routes/operation.route.ts` | `/operations/*` — config, status, components, payment modifications |
| Service | `processor/src/services/stripe-payment.service.ts` | one-time payments, confirm gate, webhook processing (`processStripeEvent`), order creation, refunds, multicapture |
| Service | `processor/src/services/stripe-subscription.service.ts` | subscription create/confirm/update/cancel/list, `invoice.*` handlers, price sync, recurring orders |
| Service | `processor/src/services/stripe-coupon.service.ts` | discount code → Stripe coupon |
| Service | `processor/src/services/stripe-shipping.service.ts` | shipping methods, rate selection, freeze/unfreeze around them |
| Service | `processor/src/services/stripe-customer.service.ts` | Stripe customer resolution, ephemeral key, CustomerSession |
| Service | `processor/src/services/ct-payment-creation.service.ts` | commercetools Payment creation and Stripe metadata linking |
| Resolver | `processor/src/services/payment-behavior-resolver.ts` | per-cart overrides from `STRIPE_PAYMENT_BEHAVIOR_RULES` |
| Converters | `processor/src/services/converters/stripeEventConverter.ts`, `subscriptionEventConverter.ts` | Stripe events → commercetools transactions |
| Clients | `processor/src/services/commerce-tools/*.ts` | raw commercetools API calls (cart freeze/unfreeze, orders, types, prices) |

### Entry points

All HTTP routes listen on `0.0.0.0:8080` (`processor/src/main.ts:9-14`). Only the operations routes carry
a prefix, `/operations` (`processor/src/server/plugins/operation.plugin.ts:8`); every other route is at
the root. **Caller** is read from the auth hook and from the enabler's call sites, never from the route
name.

| Method and path | Handler | Auth | Caller | File |
| --- | --- | --- | --- | --- |
| `GET /operations/config` | `config()` → `{ environment, publishableKey }` | session header | enabler (`enabler/src/services/api-service.ts:80`) | `processor/src/routes/operation.route.ts:30` |
| `GET /operations/status` | health: commercetools permissions + Stripe `paymentMethods.list` | JWT (Merchant Center issuer) | host platform | `operation.route.ts:46` |
| `GET /operations/payment-components` | `{ dropins: [{type:'embedded'}], components: [] }` | JWT | host platform | `operation.route.ts:62` |
| `POST /operations/payment-intents/:id` | `modifyPayment` — capture, cancel, refund, reverse; one action per call | OAuth2 + `manage_project`, `manage_checkout_payment_intents` | host platform or a project OAuth2 client | `operation.route.ts:78` |
| `GET /customer/session` | Stripe customer + ephemeral key + CustomerSession, or 204 | session header | enabler (`api-service.ts:58`) | `stripe-customer.route.ts:14` |
| `POST /setupIntent` | `createSetupIntent()` | session header | enabler (`api-service.ts:144`) | `stripe-subscription.route.ts:39` |
| `POST /subscription` | `createSubscription()` | session header | enabler (`api-service.ts:162`) | `stripe-subscription.route.ts:49` |
| `POST /subscription/withSetupIntent` | `createSubscriptionFromSetupIntent()` | session header | enabler (`api-service.ts:182`) | `stripe-subscription.route.ts:59` |
| `POST /subscription/confirm` | `confirmSubscriptionPayment()` → 200 `approved` / 400 `rejected` | session header | enabler (`api-service.ts:204`) | `stripe-subscription.route.ts:82` |
| `GET /subscription-api/:customerId` | list the customer's Stripe subscriptions (one page) | OAuth2 | a host backend | `stripe-subscription.route.ts:109` |
| `DELETE /subscription-api/:customerId/:subscriptionId` | `cancelSubscription` — Stripe only | OAuth2 + `manage_project`, `manage_subscriptions` | a host backend | `stripe-subscription.route.ts:152` |
| `POST /subscription-api/:customerId` | `updateSubscription` — new variant/price | OAuth2 + scopes | a host backend | `stripe-subscription.route.ts:199` |
| `POST /subscription-api/advanced/:customerId` | `patchSubscription` — caller-supplied Stripe `params` | OAuth2 + scopes | a host backend | `stripe-subscription.route.ts:252` |
| `GET /payments`, `POST /payments` | `createPaymentIntent()` | session header | enabler (`api-service.ts:105-113`) | `stripe-payment.route.ts:44`, `:61` |
| `POST /confirmPayments/:id` | confirm gate → 200 `approved` / 202 `pending` / 400 `rejected` | session header | enabler (`api-service.ts:128-133`) | `stripe-payment.route.ts:82` |
| `POST /stripe/webhooks` | Stripe event dispatcher (section 4) | `constructEvent` signature check, 400 on failure | Stripe | `stripe-payment.route.ts:277` |
| `GET /config-element/:payment` | `initializeCartPayment()` — Elements config, `paymentMode`, `flowType` | session header | enabler (`api-service.ts:79`) | `stripe-payment.route.ts:393` |
| `GET /applePayConfig` | returns `STRIPE_APPLE_PAY_WELL_KNOWN` | — | Apple, through a redirect the host serves — see `host-integration.md` §3a | `stripe-payment.route.ts:417` |
| `POST /shipping-methods` | set shipping address, list methods | session header | enabler (`api-service.ts:219`) | `stripe-shipping.route.ts:32` |
| `POST /shipping-methods/update` | set shipping method | session header | enabler (`api-service.ts:242`) | `stripe-shipping.route.ts:57` |
| `GET /shipping-methods/remove` | unfreeze cart, clear shipping method | session header | enabler (`api-service.ts:264`) | `stripe-shipping.route.ts:81` |
| CLI `post-deploy` | webhook endpoint, custom types, product type, Launchpad type check | — | Connect, at deploy (`connect.yaml:8`) | `processor/src/connectors/post-deploy.ts:43-55` |
| CLI `pre-undeploy` | removes the subscription product type and two custom types | — | Connect, at undeploy (`connect.yaml:9`) | `processor/src/connectors/pre-undeploy.ts:11-21` |

### Payment confirmation by mode

| Mode | Path | What decides the outcome |
| --- | --- | --- |
| One-time (`payment`) | `POST /payments` → Stripe.js confirm → `POST /confirmPayments/:id` | `updatePaymentIntentStripeSuccessful` (`processor/src/services/stripe-payment.service.ts:942`) retrieves the real PaymentIntent and fails closed on a retrieve error (`:971-979`); allows only `succeeded`, `requires_capture`, `processing` (`:982`); compares amount and currency against the cart's live total, `taxedPrice.totalGross ?? totalPrice` (`:1021-1034`); freezes the cart (`:1048-1060`); answers `APPROVED` or, for `processing`, writes `Authorization/Pending` and answers `PENDING` (HTTP 202) |
| Subscription | `POST /subscription` → Stripe.js confirm → `POST /subscription/confirm` | `confirmSubscriptionPayment` reads the real PaymentIntent: `succeeded`/`requires_capture` → `Charge/Success`; `processing` (ACH) → `Charge/Pending`, settled later by `invoice.paid` or `invoice.payment_failed`; any other status throws. `send_invoice` and trials are Pending by type and skip the status read (`processor/src/services/stripe-subscription.service.ts:1063-1070`) |
| Setup | `POST /setupIntent` → Stripe.js confirm → `POST /subscription/withSetupIntent` → `POST /subscription/confirm` | as Subscription |

Asynchronous rails never reach the confirm gate on the one-time path: a bank transfer or ACH
micro-deposit confirm returns `requires_action`, and the webhook does the work (section 4). The full flows
are in `workflows/`.

---

## 4. Webhook events

**Registered** — the `enabled_events` array post-deploy sends to Stripe, `processor/src/connectors/actions.ts:66-87`
(16 events).

**Dispatched** — the `switch (event.type)` in `processor/src/routes/stripe-payment.route.ts:309-381`.
The route answers 200 after the switch (`:383`); a handler that throws reaches the error handler and the
response is non-2xx, which is what makes Stripe redeliver.

| Event | Registered | Dispatch (`stripe-payment.route.ts`) | Effect |
| --- | --- | --- | --- |
| `payment_intent.succeeded` | `:69` | `:320` → `processStripeEvent` unless the event belongs to a subscription invoice (`:324`) | `Charge/Success`; promotes a lingering `Authorization/Pending` to Success; creates the order behind the amount, currency, already-`Ordered`, post-address and version-pin guards (`stripe-payment.service.ts:1493-1641`) |
| `payment_intent.canceled`, `payment_intent.payment_failed` | `:77`, `:78` | `:320` → `processStripeEvent`; a subscription-invoice `payment_failed` goes to `processSubscriptionEventLateReturn` (`:327-331`) | Failure transaction and cart unfreeze; for a subscription invoice that was already paid, the ACH late-return flag only |
| `charge.succeeded` | `:67` | `:320` → `processStripeEvent` unless subscription invoice | captured: payment fields + `Authorization Initial→Success` fixup; uncaptured: an Authorization transaction |
| `payment_intent.processing` | `:80` | `:339` → `processStripeEvent` unless subscription invoice | `Authorization/Pending` for the full `pi.amount`; re-throws on failure |
| `payment_intent.requires_action` | `:79` | `:313` → `handleBankTransferPendingEvent` (`:186-216`) | skipped for subscription invoices; processed only when `isBankTransferNextAction` **or** `isMicrodepositNextAction` (`:204`); then `processStripeEvent` writes `Authorization/Pending` for the full `pi.amount` **for both rails** (`processor/src/services/converters/stripeEventConverter.ts:164-178`) and `freezeCartForBankTransfer` freezes the cart (`:215`). Card 3DS and Boleto stay log-only |
| `payment_intent.partially_funded` | `:81` | `:314` → same handler and predicate | no transaction; only the interface interaction is persisted |
| `customer_cash_balance_transaction.created` | `:82` | `:317` → `logCustomerCashBalanceTransaction` (`:140-166`) | log only, built field by field; `funding_reversed` and `adjusted_for_overdraft` logged at `error` (`:161-163`) |
| `charge.refunded` | `:70` | `:355` → `handleChargeRefundedEvent` (`:265-273`) | multi-operations off: `processStripeEvent`; on: `processStripeEventRefunded` |
| `refund.updated`, `refund.failed` | `:75`, `:76` | `:358-359` → `handleRefundOutcomeEvent` (`:241-249`) | acts only on status `failed`/`canceled`; re-throws on write failure |
| `charge.captured` | `:68` | `:310` | log only |
| `invoice.paid` | `:83` | `:362` → `processSubscriptionEventPaid` | transactions, then the order (`createOrder`) or a payment added to the first order (`addPaymentToOrder`); sole source of truth for subscription money |
| `invoice.payment_failed` | `:84` | `:366` → `processSubscriptionEventFailed` | failure transaction; cart stays frozen |
| `invoice.upcoming` | `:86` | `:370` → `processSubscriptionEventUpcoming` | price sync when enabled |
| `customer.subscription.deleted` | `:85` | `:374` → `processSubscriptionEventDeleted` | unfreezes the cart |

Subscription-invoice `payment_intent.succeeded`, `canceled` and `charge.succeeded` are dropped without
processing (`:324-338`): `invoice.paid` is the single source of truth for recurring money
(`business-rules/recurring-billing.md` Rule 4). The drop is keyed on the connector's own
`subscription_id` metadata (`processor/src/utils.ts:71-83`).

**What re-throws.** `processStripeEvent` (`stripe-payment.service.ts:1231`) re-throws for
`payment_intent.processing`, `payment_intent.requires_action` (`ASYNC_PENDING_EVENTS`, `:83-86`) and a
`PaidWithoutOrderError` (`:1293-1295`). The subscription handlers re-throw when the error *message*
matches the transient pattern.

---

## 5. Enabler

**Exported:** one symbol, `MockPaymentEnabler` re-exported as `Enabler` (`enabler/src/main.ts:3`).
`DropinEmbeddedBuilder` is used internally and not exported. **Built** as a Vite library, formats `es`
and `umd`, global name `Connector`, files `connector-enabler.{es,umd}.js` (`enabler/vite.config.ts:14-17`).
How a host loads and drives it is in `host-integration.md` §4.

### Initialization

```text
getConfigData(paymentElementType)   GET /config-element/{paymentElementType} + GET /operations/config
getCustomerOptions()                GET /customer/session
loadStripe(publishableKey)
[pi_first only, see section 8]      GET|POST /payments before mount → clientSecret
getElements(...)                    elements({ mode, amount, currency, ... }) or elements({ clientSecret })
getPaymentElement(...)              elements.create('expressCheckout' | 'payment')
createDropinBuilder('embedded')
```

`enabler/src/payment-enabler/payment-enabler-mock.ts:98-101` (config and customer), `:199-204`
(`loadStripe`), `:327-391` (`getElements`), `:417-433` (`getPaymentElement`). The element **created**
is chosen by the `paymentElementType` option (`=== "expressCheckout"`, `:422`); the **mount** branch is
chosen by the processor's `webElements` value (`=== "paymentElement"`, `enabler/src/dropin/dropin-embedded.ts:64`).

### Payment modes

| `paymentMode` (from `/config-element`) | Submit path |
| --- | --- |
| `payment` | `GET/POST /payments` (deferred only) → `stripe.confirmPayment` → `POST /confirmPayments/:id` |
| `subscription` | `POST /subscription` → `stripe.confirmPayment` → `POST /subscription/confirm` |
| `setup` | `POST /setupIntent` → `stripe.confirmSetup` → `POST /subscription/withSetupIntent` → `POST /subscription/confirm` |

An outcome of `pending` reaches `onComplete({ isSuccess: false })` (`dropin-embedded.ts:178-181`).

### Express Checkout events

| Stripe Element event | Processor call | Effect |
| --- | --- | --- |
| `shippingaddresschange` | `POST /shipping-methods` | sets the address, returns methods and line items |
| `shippingratechange` | `POST /shipping-methods/update` | sets the method (unfreeze → update → re-freeze) |
| `cancel` | `GET /shipping-methods/remove` | unfreezes and clears the method |

The freeze/unfreeze contract of these endpoints is in `workflows/process-shipping.md`.

---

## 6. Cross-module and cross-application contracts

**Enabler → processor (HTTP).** Twelve endpoints.

**Processor ← commercetools session.** `cartId`, `allowedPaymentMethods`, `paymentInterface`,
`processorUrl`, `merchantReturnUrl` from the session principal (`processor/src/libs/fastify/context/context.ts:42-65`).

**Processor ← a tax connector, through the cart.** The processor reads
`connectorStripeTax_calculationReferences` (`processor/src/constants.ts:18`, read at
`stripe-payment.service.ts:544`), a `String[]` of Stripe Tax calculation ids that nothing in this
repository writes. When the array has exactly one element it is passed to the PaymentIntent; zero or
several are dropped (`business-rules/tax-integration.md` Rule 3). The subscription path never reads it.

**Processor → Stripe metadata** — the keys in `processor/src/constants.ts:1-15`, listed in section 7.

---

## 7. commercetools data model

### Types post-deploy creates or checks

| Type (default key) | Resource | Fields | Post-deploy |
| --- | --- | --- | --- |
| `payment-connector-stripe-customer-id` (`CT_CUSTOM_TYPE_STRIPE_CUSTOMER_KEY`) | customer | `stripeConnector_stripeCustomerId` | created when its key is absent (`processor/src/services/commerce-tools/custom-type-helper.ts:42-73`) |
| `payment-connector-subscription-line-item-type` (`CT_CUSTOM_TYPE_SUBSCRIPTION_LINE_ITEM_KEY`) | line item | `stripeConnector_productSubscriptionId`, `stripeConnector_stripeSubscriptionId`, `stripeConnector_stripeSubscriptionError` | created when its key is absent, for line-item types |
| `payment-connector-subscription-information` (`CT_PRODUCT_TYPE_SUBSCRIPTION_KEY`) | product type | 15 attributes below | created if absent; updated by delete-then-create only when no product uses it (`actions.ts:146-159`) |
| `payment-launchpad-purchase-order` (`CT_CUSTOM_TYPE_LAUNCHPAD_PURCHASE_ORDER_KEY`) | payment | `launchpadPurchaseOrderNumber`, `launchpadPurchaseOrderInvoiceMemo` | existence check only — never created (`actions.ts:42-47`); must be created by the merchant |

Subscription line items are detected by the product type's **name**, not by the configurable key
(`processor/src/services/stripe-subscription.service.ts:782`, `:1186`; `business-rules/subscription-lifecycle.md` Rule 3).

### Subscription product type attributes

Declared in `processor/src/custom-types/custom-types.ts:83-368`.

| Attribute | Required | Values |
| --- | --- | --- |
| `stripeConnector_recurring_interval` | yes | `day`, `week`, `month`, `year` |
| `stripeConnector_recurring_interval_count` | yes | number |
| `stripeConnector_off_session` | yes | boolean |
| `stripeConnector_collection_method` | yes | `charge_automatically`, `send_invoice` |
| `stripeConnector_description` | no | text |
| `stripeConnector_days_until_due` | no | number; only for `send_invoice`, default 1 (`processor/src/mappers/subscription-mapper.ts:22`) |
| `stripeConnector_cancel_at_period_end` | no | boolean |
| `stripeConnector_cancel_at` | no | date-time |
| `stripeConnector_billing_cycle_anchor_day` | no | number |
| `stripeConnector_billing_cycle_anchor_time` | no | time |
| `stripeConnector_billing_cycle_anchor_date` | no | date-time |
| `stripeConnector_trial_period_days` | no | number |
| `stripeConnector_trial_end_date` | no | date-time |
| `stripeConnector_missing_payment_method_at_trial_end` | no | `cancel`, `create_invoice`, `pause` |
| `stripeConnector_proration_behavior` | no | `none`, `create_prorations`, `always_invoice` |

### Stripe metadata written by the connector

| Key (`processor/src/constants.ts`) | Meaning |
| --- | --- |
| `cart_id`, `ct_project_key`, `ct_payment_id`, `ct_customer_id`, `ct_order_id` | commercetools identities on PaymentIntents and Subscriptions; `ct_payment_id` is how every webhook finds its Payment |
| `subscription_id` | set on a subscription's PaymentIntent; the key `isFromSubscriptionInvoice` reads |
| `ct_product_id` | on Stripe Products only |
| `ct_variant_sku`, `ct_price_id` | on Stripe Prices |
| `ct_shipping_price_amount` | on shipping Prices; part of the reuse search |
| `ct_cart_total_amount`, `ct_cart_total_currency` | the cart total sealed onto a Subscription at creation; read back at `invoice.paid` (`business-rules/payment-confirmation.md` Rule 7) |

---

## 8. Elements initialization: `deferred` and `pi_first`

`STRIPE_PAYMENT_FLOW`, or a matching rule's `flowType`, chooses how Elements is initialized.

| | `deferred` (default) | `pi_first` |
| --- | --- | --- |
| `elements()` receives | `{ mode, amount, currency, captureMethod, … }` | `{ clientSecret }` |
| PaymentIntent created | at submit | before mount, by the enabler |
| Needed by | every method in scope except below | bank transfer (`customer_balance`) and BLIK |

- **The processor resolves `flowType` from the trusted rule** — `cart.country`, then the store key, never
  the billing country — at both places it is read, so `/config-element` and the PaymentIntent cannot
  disagree (`stripe-payment.service.ts:513-514`, `:1148-1149`). `euBankTransferCountry` uses the same
  trusted rule (`:567`).
- **The enabler fetches the PaymentIntent early only when** `flowType` is `pi_first`, `paymentElementType`
  is exactly `paymentElement` and `paymentMode` is `payment` (`enabler/src/payment-enabler/payment-enabler-mock.ts:239-287`).
  Otherwise it stays deferred.
- **Under `pi_first` the cart is frozen at each rail's commitment point, not at PaymentIntent creation.**
  Instant rails freeze in the confirm gate (`stripe-payment.service.ts:1048-1060`); bank transfer and ACH
  micro-deposits freeze in the `requires_action` handler (`freezeCartForBankTransfer`, `:1857-1886`);
  subscriptions freeze at creation. The confirm gate compares against the cart's live total.
- **The subscription path does not use the PaymentIntent behaviour rules:** `StripeSubscriptionService`
  never calls `resolvePaymentBehavior` and runs its own SetupIntent `usage`
  (`processor/src/services/stripe-subscription.service.ts:965`).

---

## 9. Key Configuration

Read in `processor/src/config/config.ts` unless stated. The only startup abort is a structurally
malformed `STRIPE_PAYMENT_BEHAVIOR_RULES`. `connect.yaml` marks some keys required for the deploy form.

| Variable | Module | Default | Effect |
| --- | --- | --- | --- |
| `CTP_PROJECT_KEY`, `CTP_CLIENT_ID`, `CTP_CLIENT_SECRET` | processor | placeholders (`:287-289`) | commercetools access |
| `CTP_AUTH_URL`, `CTP_API_URL`, `CTP_SESSION_URL`, `CTP_CHECKOUT_URL` | processor | europe-west1 URLs (`:292-295`) | platform endpoints |
| `CTP_JWKS_URL`, `CTP_JWT_ISSUER` | processor | Merchant Center europe-west1 (`:290-291`) | JWT auth of `/operations/status` and `/operations/payment-components` |
| `STRIPE_SECRET_KEY` | processor | `'stripeSecretKey'` (`:306`) | every Stripe call |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | processor | `''` (`:307`) | webhook signature; missing → every webhook 400 |
| `STRIPE_PUBLISHABLE_KEY` | processor → enabler | `''` (`:312`) | returned by `/operations/config` for Stripe.js |
| `STRIPE_CAPTURE_METHOD` | processor | `automatic` (`:308`) | `capture_method` for carts without a rule; `manual` excludes `customer_balance`, `us_bank_account` and `crypto` from the resolved methods |
| `STRIPE_PAYMENT_FLOW` | processor | `deferred` (`:421-438`) | `deferred` or `pi_first`, case-sensitive; blank or invalid → deferred |
| `STRIPE_PAYMENT_BEHAVIOR_RULES` | processor | unset (`:241-275`) | JSON map from cart country or store key to overrides of `flowType`, `captureMethod`, `setupFutureUsage`, `euBankTransferCountry`. Exceptions only; no wildcard. Malformed JSON, a non-object map or a non-object rule abort startup; an unknown field or invalid value is reported and dropped |
| `STRIPE_SAVED_PAYMENT_METHODS_CONFIG` | processor | unset → `{}`; `connect.yaml:62` default `{"payment_method_save":"disabled"}` | saved-method features |
| `STRIPE_COLLECT_BILLING_ADDRESS` | processor → enabler | `auto` (`:316`) | `auto`, `never` or `if_required` (`enabler/src/dtos/mock-payment.dto.ts:52`) |
| `STRIPE_LAYOUT` | processor → enabler | `{"type":"tabs","defaultCollapsed":false}` (`:311`) | Payment Element layout JSON |
| `STRIPE_APPEARANCE_PAYMENT_ELEMENT`, `STRIPE_APPEARANCE_EXPRESS_CHECKOUT` | processor → enabler | unset (`:309-310`) | appearance JSON strings |
| `STRIPE_APPLE_PAY_WELL_KNOWN` | processor | `'mockWellKnown'` (`:313`) | body of `GET /applePayConfig` |
| `STRIPE_API_VERSION` | processor | `2025-12-15.clover` (`:314`) | API version on every request |
| `MERCHANT_RETURN_URL` | processor | `''` (`:319`) | fallback; the session's value wins |
| `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING` | processor | `createOrder` (`:328-329`) | `createOrder`: a new order per `invoice.paid`; `addPaymentToOrder`: a payment added to the first order |
| `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED` | processor | `false` (`:338`) | only the string `true` enables price sync on `invoice.upcoming` |
| `STRIPE_ENABLE_MULTI_OPERATIONS` | processor | `false` (`:351`) | only `true` enables multicapture and multirefund routing |
| `CT_CUSTOM_TYPE_STRIPE_CUSTOMER_KEY`, `CT_CUSTOM_TYPE_SUBSCRIPTION_LINE_ITEM_KEY`, `CT_PRODUCT_TYPE_SUBSCRIPTION_KEY`, `CT_CUSTOM_TYPE_LAUNCHPAD_PURCHASE_ORDER_KEY` | processor | the default keys in section 7 (`processor/src/custom-types/custom-types.ts:5`, `:13`, `:41`, `:85`) | type keys |
| `HEALTH_CHECK_TIMEOUT`, `LOGGER_LEVEL`, `MOCK_ENVIRONMENT`, `MOCK_CLIENT_KEY` | processor | `5000`, `info`, `TEST`, `stripe` (`:296-303`) | — |
| `CONNECT_SERVICE_URL` | processor, post-deploy | platform-injected | webhook URL = this + `stripe/webhooks` (`post-deploy.ts:31`) |
| `STRIPE_WEBHOOK_ID` | processor, post-deploy | `''` | the endpoint post-deploy updates (`post-deploy.ts:22-28`) |

---

## 10. Out of Scope

| Not supported | What the code shows |
| --- | --- |
| Subscription pause | no pause route among the subscription routes (`processor/src/routes/stripe-subscription.route.ts:108-297`) |
| A free trial without collecting a payment method | both create paths need a payment method: a `default_incomplete` PaymentIntent (`stripe-subscription.service.ts:189`) or the SetupIntent's method (`:289`) |
| Changing a subscription's quantity | updates keep the current quantity (`:1349`, `:2715`, `:3039`) |
| More than one subscription product per cart | only the first is subscribed |
| Bank transfer on a subscription | subscription-invoice events are skipped by the bank-transfer handler (`processor/src/routes/stripe-payment.route.ts:190-193`), by decision |
| ACH micro-deposit verification on a subscription | the subscription confirm throws on `requires_action` |
| Guest checkout for subscriptions or bank transfer | one-time payments work for a guest cart; subscriptions and bank transfer need a customer (`host-integration.md` §2) |
| commercetools update after an API cancel | `cancelSubscription` writes nothing to commercetools |
| Correcting commercetools after an ACH late return | only a `paymentStatus.interfaceCode` flag is written; the reversal is handled in the Stripe Dashboard |
| Correcting commercetools after a cash-balance clawback | log only |
| Disputes | no `charge.dispute.*` event is registered or dispatched (`business-rules/refunds-and-disputes.md` Rule 2) |
| Tax on subscription invoices | no `automatic_tax` or tax rates anywhere on the subscription path |
| Stripe Terminal | no Terminal call anywhere in `processor/src` |
