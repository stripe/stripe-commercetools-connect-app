# stripe-commercetools-connect-app — Host Integration

> Who this is for: developers of an application that calls or embeds this unit — a storefront that
> mounts its payment drop-in, or a merchant backend that manages subscriptions or payments through it.
> To install and run the unit itself, see `adopter-guide.md`.

---

## 1. Integration paths

| # | Path | How the host reaches the unit | Caller | Code |
| --- | --- | --- | --- | --- |
| P1 | **Direct embed.** The storefront page loads the unit's browser bundle and mounts its drop-in; the bundle calls the processor | `const { Enabler } = await import('{enabler URL}')` → `new Enabler({ processorUrl, sessionId, … })` → `createDropinBuilder('embedded')` → `build({})` → `mount(selector)` → `submit()` (§4) | host browser (the bundle, from the host's page); host backend creates the session | `enabler/vite.config.ts:11-18`, `enabler/src/main.ts:3` |
| P4 | **Subscription management from the host backend** (customer account pages) | `GET/POST/DELETE {processorUrl}/subscription-api/…` with a platform OAuth2 bearer token (§3a) | host backend | `processor/src/routes/stripe-subscription.route.ts:108-297`. Flow: `workflows/process-subscription-management.md` |

**Which path to choose.** A storefront that checks out its own carts uses **P1**. Subscription
self-service pages call **P4** from the backend, never from the browser (it needs a platform
OAuth2 token).

---

## 2. Before the first call

| What the host needs | Where it comes from | Who creates it | Lifetime / scope |
| --- | --- | --- | --- |
| **Enabler URL** (`connector-enabler.es.js`, or `connector-enabler.umd.js` for a script tag) | the Connect deployment of the `enabler` application, `applicationType: assets` (`connect.yaml:2-3`; file names `enabler/vite.config.ts:17`) | operator (installs the connector) | per deployment. Shape `https://assets-{uuid}.{region}.commercetools.app/connector-enabler.es.js` |
| **Processor URL** (`processorUrl`) | the Connect deployment of the `processor` application, `applicationType: service`, endpoint `/` (`connect.yaml:4-6`) | operator | per deployment. Shape `https://service-{uuid}.{region}.commercetools.app` |
| **A cart** with line items and currency | the host's own cart logic | host backend | the session is bound to it: the processor reads the cart id from the session principal on every call (`processor/src/libs/fastify/context/context.ts:42-45`). **One session per cart** |
| **A `customerId` on the cart** — required for any subscription, for bank transfer, and for saved payment methods | host cart logic (a signed-in customer) | host backend | a guest cart (no `customerId`) cannot create a subscription; one-time card and ACH work without one. Without `customerId`, `GET /customer/session` answers 204 (`processor/src/services/stripe-customer.service.ts:39-43`, route `processor/src/routes/stripe-customer.route.ts:33-35`); how the Stripe customer is resolved or created: `workflows/process-customer-session.md` |
| **Shipping info on the cart** before payment for a non-Express checkout | host cart logic | host backend | the unit creates the order from the cart on `payment_intent.succeeded`; order creation fails without shipment info (`processor/README.md:1069-1071`). On a subscription cart, shipping becomes a recurring item priced once at creation (`business-rules/mixed-carts.md`) |
| **A platform session id** (`sessionId`, sent as `x-session-id`) | the platform's Sessions API, called by the host backend (§3a, *Create a session*) | host backend | requires a token with `manage_sessions`; the response carries `expiryAt` and `state: "ACTIVE"` |
| **An API client for the host backend with `manage_sessions`** | the platform's Merchant Center / API Clients API | operator | the host's own client — **not** the connector's `CTP_CLIENT_ID`, whose documented scope list has `view_sessions` only (`connect.yaml:100`) |
| **A platform OAuth2 token** for P4 | the platform's auth server, client-credentials grant | host backend | P4's mutating routes call `authorize('manage_project', 'manage_subscriptions')` (`stripe-subscription.route.ts:156`, `:203`, `:256`) |
| **A return page** at `MERCHANT_RETURN_URL` | host | host (operator configures the URL, `connect.yaml:63-65`) | used by every redirect-based payment method (§5). A per-session `merchantReturnUrl` principal overrides it if present (`processor/src/services/stripe-payment.service.ts:648`; subscriptions `processor/src/services/stripe-subscription.service.ts:411`) |
| **Payment method domains registered** with the provider (wallets and several redirect methods) | provider dashboard | operator | Apple Pay requires registration of every domain and subdomain that shows it; Stripe performs Apple's merchant validation itself; test domains must also be registered |
| A Stripe customer, ephemeral key and customer-session secret | `GET /customer/session` (§3b #3) | **the unit, at runtime**, when the enabler is constructed | per construction, for a cart with a `customerId`; the unit may create a Stripe customer and writes its id onto the platform customer (`stripe-customer.service.ts:151-168`; `workflows/process-customer-session.md`) |

### What the unit trusts the host to have checked

- **The session id is the shopper's capability for its cart.** The host must not log or share it.
- **`POST /payments` merges the browser's `paymentMethodOptions` over the merchant's defaults**,
  browser values winning (`stripe-payment.service.ts:563-564`, merge at `:855-878`) — except
  `customer_balance`, which is discarded and replaced by the merchant's rule, so a shopper cannot
  choose the account bank-transfer funds go to (`:918-934`).
- **What the unit enforces:** a `paymentReference` sent to `POST /subscription/confirm` must belong
  to the session's cart (`business-rules/payment-ownership-binding.md`), and `POST /confirmPayments`
  binds the PaymentIntent to the payment by `interfaceId` (`business-rules/payment-confirmation.md`).
- **`manage_subscriptions` is an existing platform scope with another meaning.** The platform
  defines it as permission to "view, create, update, and delete Subscriptions" (event-delivery
  destinations). Granting it to a host backend for P4 also grants that.

---

## 3. Calls

All processor routes are relative to `processorUrl`. Error bodies produced by the unit's error handler
have the shape `{ "message": "…", "statusCode": 4xx|5xx, "errors": [{ "code": "…", "message": "…" }] }`
(`processor/src/libs/fastify/error-handler.ts:53-57`); authentication failures add `error` and
`error_description` (`:35-47`). Routes that catch their own errors answer differently, stated per call.

### 3a. Calls the host makes

#### Create a session — platform, not this unit
- **To:** `POST https://session.{region}.commercetools.com/{projectKey}/sessions` · **From:** host backend
- **Auth:** `Bearer {token with manage_sessions}`
- **Request** — example:
  ```http
  POST /my-project/sessions
  Authorization: Bearer eyJ…
  Content-Type: application/json

  { "cart": { "cartRef": { "id": "15f31374-4600-45f4-bf84-c8c4615c63a2" } },
    "metadata": { "processorUrl": "https://service-1a2b.europe-west1.gcp.commercetools.app",
                  "allowedPaymentMethods": ["dropin"] } }
  ```
- **Response** — example; the host uses `id`:
  ```json
  { "id": "ab12cd34-…", "expiryAt": "2026-10-16T11:20:45.661Z", "state": "ACTIVE",
    "activeCart": { "cartRef": { "id": "15f31374-…" } }, "metadata": { … } }
  ```
- **Errors:** platform-defined.

#### List a customer's subscriptions — P4
- **To:** `GET /subscription-api/{ctCustomerId}` · **From:** host backend
- **Auth:** OAuth2 bearer
- **Request** — `GET /subscription-api/7a1f…-customer` with `Authorization: Bearer eyJ…`
- **Response** — `200 { "subscriptions": [ { "id": "sub_1Q…", "status": "active", "items": { "data": [ { "price": { "id": "price_1Q…", "unit_amount": 2500, "currency": "usd" } } ] }, "latest_invoice": { … }, "default_payment_method": { … } } ] }` — raw Stripe Subscription objects with `latest_invoice` and `default_payment_method` expanded (`stripe-subscription.service.ts:1221-1224`). Do not pass them to the browser unfiltered.
- **At most 10, never canceled ones.** The call sets neither `limit` nor `status`
  (`stripe-subscription.service.ts:1221-1224`); Stripe's default `limit` is 10, and with no `status`
  all subscriptions that have not been canceled are returned.
- **Errors:** `400 { "subscriptions": [], "error": "No Stripe customer ID found for customer …" }` when the platform customer has no Stripe id yet (`stripe-subscription.service.ts:1215-1218`, route `stripe-subscription.route.ts:139-144`)

#### Cancel a subscription — P4
- **To:** `DELETE /subscription-api/{ctCustomerId}/{subscriptionId}` · **From:** host backend
- **Auth:** OAuth2 + `authorize('manage_project', 'manage_subscriptions')` (`stripe-subscription.route.ts:154-157`)
- **Request** — `DELETE /subscription-api/7a1f…/sub_1Q…`
- **Response** — `200 { "id": "sub_1Q…", "status": "canceled", "outcome": "canceled", "message": "Subscription sub_1Q… has been successfully canceled." }`. Cancels immediately, `invoice_now: false`, `prorate: true` (`stripe-subscription.service.ts:1246-1253`). **This call does not update the platform cart** — see §5.
- **Errors:** `400 { "id": "…", "status": "failed", "outcome": "error", "message": "Subscription … does not belong to customer …" }` (`stripe-subscription.route.ts:184-190`; thrown at `stripe-subscription.service.ts:1511`)

#### Change a subscription to another product variant — P4
- **To:** `POST /subscription-api/{ctCustomerId}` · **From:** host backend
- **Auth:** as *Cancel*
- **Request** — example (`processor/src/dtos/stripe-payment.dto.ts:131-136`):
  ```json
  { "subscriptionId": "sub_1Q…", "newSubscriptionVariantId": "{ctProductId}",
    "newSubscriptionVariantPosition": 2, "newSubscriptionPriceId": "{ctPriceId}" }
  ```
  **`newSubscriptionVariantPosition` is a variant id, despite its name**: `1` selects the master variant,
  any other value is matched against `variant.id` (`stripe-subscription.service.ts:1394-1407`); it is
  required. Flow and price reuse: `workflows/process-subscription-management.md`.
- **Response** — `200 { "id": "sub_1Q…", "status": "active", "outcome": "updated", "message": "…" }`
- **Errors:** `400` with `outcome: "error"` and messages such as `Product with ID … not found in commercetools` (`stripe-subscription.service.ts:1304`)

#### Patch a subscription with raw provider parameters — P4
- **To:** `POST /subscription-api/advanced/{ctCustomerId}` · **From:** host backend
- **Auth:** as *Cancel*
- **Request** — `{ "id": "sub_1Q…", "params": { "description": "updated" }, "options": { "idempotencyKey": "host-generated-key" } }`. `params` carries raw provider subscription-update parameters; `options` keeps **only** `idempotencyKey` (`stripe-payment.dto.ts:146-153`).
- **Response** — as *Change*. **Does not update the platform.**
- **Errors:** `400 outcome:"error"`. Unknown keys in `options` are ignored and the call returns 200.

#### Apple Pay domain association — host-side redirect, not a call
- **To:** the host serves `/.well-known/apple-developer-merchantid-domain-association` as a redirect to `GET {processorUrl}/applePayConfig` · **From:** Apple, via the host's domain
- **Response** — the text of `STRIPE_APPLE_PAY_WELL_KNOWN` (`enabler/README.md:206-210`; `stripe-payment.service.ts:1221-1223`; default `'mockWellKnown'`, `processor/src/config/config.ts:313`). The provider performs Apple's merchant validation itself once the domain is registered (§2).

### 3b. Calls the unit's component makes from the host's page

The host does not write these on P1, but they appear in its network log and must be allowed by its
content security policy. All send `Content-Type: application/json` and `x-session-id: {sessionId}`
(`enabler/src/services/api-service.ts:48-53`) and use session auth.

| # | When | Request — example | Response — example |
| --- | --- | --- | --- |
| 1 | construction | `GET /config-element/paymentElement` (or `/expressCheckout`) — `stripe-payment.route.ts:392-416` | `200 {"cartInfo":{"amount":12300,"currency":"USD"},"captureMethod":"automatic","webElements":"paymentElement","layout":"{\"type\":\"tabs\",\"defaultCollapsed\":false}","collectBillingAddress":"auto","paymentMode":"payment","flowType":"deferred"}` — `paymentMode` is decided by the cart, not the host (`stripe-subscription.service.ts:1141-1156`; `adopter-guide.md → Subscription checkout`). A non-2xx body is thrown to the constructor's promise (`api-service.ts:83-88`) |
| 2 | construction | `GET /operations/config` — `operation.route.ts:29-43` | `200 {"environment":"…","publishableKey":"…"}` (`stripe-payment.service.ts:141-147`) |
| 3 | construction | `GET /customer/session` — **sent without `stripeCustomerId`** (`api-service.ts:58`) | `200 {"stripeCustomerId":"cus_…","ephemeralKey":"ek_…","sessionId":"cuss_…_secret_…"}`, or `204` for a cart without `customerId` or whose platform customer is missing (`stripe-customer.service.ts:39-49`) |
| 4 | submit (`deferred`), or construction (`pi_first`, §4) | `GET /payments`, or `POST /payments` `{"paymentMethodOptions":{"pix":{"expires_after_seconds":3600}}}` when `stripeConfig.paymentIntent.paymentMethodOptions` is set — `stripe-payment.route.ts:43-75` | `200 {"clientSecret":"pi_…_secret_…","paymentReference":"{ctPaymentId}","merchantReturnUrl":"https://shop.example/return","cartId":"…"}`. **Each call creates a new PaymentIntent and a new platform Payment** (`stripe-payment.service.ts:588-601`, payment `:617-621`). A browser-sent `customer_balance` option is discarded (§2) |
| 5 | after provider confirmation, one-time | `POST /confirmPayments/{paymentReference}` `{"paymentIntent":"pi_…"}` — `stripe-payment.route.ts:77-123` | `200 {"outcome":"approved"}`, or `202 {"outcome":"pending"}` when the PaymentIntent is `processing` (`:106-107`). Both freeze the cart (`stripe-payment.service.ts:1040-1060`). `400 {"outcome":"rejected"}` (`:120`) when the PaymentIntent does not match, its status is not `succeeded`/`requires_capture`/`processing`, or the amount does not equal the cart's **current** total (`business-rules/payment-confirmation.md`) |
| 6 | submit, `paymentMode: subscription` | `POST /subscription` body `{}` — `stripe-subscription.route.ts:48-57` | `200 {"subscriptionId":"sub_…","clientSecret":"…","paymentReference":"…","merchantReturnUrl":"…","cartId":"…"}`; freezes the cart (`stripe-subscription.service.ts:225-239`). **A retry for the same cart returns the same subscription** rather than a second one; a reconciled, already-`active` subscription comes back with `clientSecret: ""`. Guest cart: fails (§2) |
| 7 | submit, `paymentMode: setup` | `POST /setupIntent` body `{}` — `stripe-subscription.route.ts:38-47` | `200 {"clientSecret":"seti_…_secret_…","merchantReturnUrl":"…"}` |
| 8 | after provider setup confirmation | `POST /subscription/withSetupIntent` `{"setupIntentId":"seti_…"}` — `:58-77` | `200 {"subscriptionId":"sub_…","paymentReference":"…"}` |
| 9 | after #6 or #8 | `POST /subscription/confirm` `{"subscriptionId":"sub_…","paymentReference":"…","paymentIntentId":"pi_…"}` — `:78-106` | `200 {"outcome":"approved"}`; an async ACH payment is written `Charge/Pending`. `400 {"outcome":"rejected","error":"Payment reference does not belong to the current cart."}` and others (`:100-103`; `stripe-subscription.service.ts:1012-1060`, `:1091-1098`). Micro-deposit verification is not offered on subscriptions (`adopter-guide.md → ACH Direct Debit`) |
| 10 | Express: shopper changes address | `POST /shipping-methods` `{"country":"US","state":"NY","city":"New York","postalCode":"10001"}` — `processor/src/routes/stripe-shipping.route.ts:28-52` | `200 {"shippingRates":[{"id":"…","displayName":"Standard","amount":500}],"lineItems":[{"name":"…","amount":12300}]}`; writes the address and a default method onto the cart (`workflows/process-shipping.md`). `400 {}` — empty body (`:47-50`) |
| 11 | Express: shopper picks a rate | `POST /shipping-methods/update` `{"id":"…","amount":500,"displayName":"Standard"}` — `:53-77` | `200 {"lineItems":[…]}` (`workflows/process-shipping.md`). `400 {}` (`:74`) |
| 12 | Express: sheet dismissed | `GET /shipping-methods/remove` — `:78-100` | `200 {"lineItems":[…]}`; leaves the cart unfrozen (`workflows/process-shipping.md`). `400 {}` (`:97`) |

The bundle also loads Stripe.js and talks to the provider from the host's page
(`enabler/src/payment-enabler/payment-enabler-mock.ts:195-206`).

---

## 4. The surface the host drives

### Distribution

| | |
| --- | --- |
| Artifact | `connector-enabler.es.js` (ES module) and `connector-enabler.umd.js` (UMD, global `Connector`), CSS injected by the script (`enabler/vite.config.ts:3,7,14-17`) |
| Exported symbols | **`Enabler` only** (`enabler/src/main.ts:3`, the class `MockPaymentEnabler` re-exported). `DropinType` and the TypeScript types are **not** exported — pass the string `'embedded'` |
| Loading | `const { Enabler } = await import(enablerUrl)` — the module namespace, destructured |
| Package | none — `enabler/package.json:3` is `"private": true` |
| Provider SDK | the bundle loads Stripe.js itself with the processor's publishable key (`payment-enabler-mock.ts:195-206`, `loadStripe` at `:199`); the host must not load a second instance for this element |

### `new Enabler(options)` — `enabler/src/payment-enabler/payment-enabler.ts:228-301`

**Construction starts the network work immediately** (`payment-enabler-mock.ts:86-88`): calls #1 and #2
of §3b run in parallel (`api-service.ts:78-81`), then #3 (`payment-enabler-mock.ts:101`), and a Stripe
customer may be created. **Under `pi_first`, call #4 runs too — a PaymentIntent and a platform Payment —
but only when `paymentElementType` is exactly `'paymentElement'` and the cart's `paymentMode` is
`'payment'`** (`payment-enabler-mock.ts:239-294`). Each construction repeats all of this.
**Construct once per checkout page**, not per render.

| Option | Required | Used for | Read at |
| --- | --- | --- | --- |
| `processorUrl` | yes | base of every §3b call | `payment-enabler-mock.ts:93-96` |
| `sessionId` | yes | `x-session-id` header | same |
| `paymentElementType` | no — but **set it**: `'paymentElement'` or `'expressCheckout'` | which element is created | `:98-100` |
| `locale` | no | passed to `stripe.elements()` | `:120, 368, 377` |
| `onComplete(result)` | no | §5 | `dropin-embedded.ts:179, 183, 209, 240` |
| `onError(error)` | no | §5 | `enabler/src/dropin/dropin-embedded.ts:146` |
| `stripeConfig.elements.{appearance, layout, collectBillingAddress}` | no | **override** the operator's `STRIPE_APPEARANCE_*`, `STRIPE_LAYOUT`, `STRIPE_COLLECT_BILLING_ADDRESS` (`'auto'`, `'never'`, `'if_required'`, `payment-enabler.ts:50`) | `payment-enabler-mock.ts:464-493` |
| `stripeConfig.paymentIntent.paymentMethodOptions` | no | sent as the `POST /payments` body; browser values win over backend defaults, except `customer_balance` (§2) | `dropin-embedded.ts:168`, `payment-enabler-mock.ts:292-294` |

### Drop-in lifecycle

| Step | Call | Side effects |
| --- | --- | --- |
| 1 | `const builder = await enabler.createDropinBuilder('embedded')` | awaits construction; rejects if any of #1–#3 (or #4 under `pi_first`) failed |
| 2 | `const dropin = builder.build({})` | none |
| 3 | `dropin.mount('#payment')` | mounts the provider element. For Express, also wires `shippingaddresschange` → #10, `shippingratechange` → #11, `cancel` → #12, `confirm` → `submit()` (`dropin-embedded.ts:63-122`) |
| 4 | **Payment Element: the host renders its own pay button and calls `dropin.submit()`.** Express: the wallet sheet's confirm calls it | runs the `paymentMode` branch (`dropin-embedded.ts:124-148`); ends in `onComplete`, `onError`, or a page navigation (§5) |
| — | unmount | there is no unmount method — the drop-in has only `submit` and `mount` (`payment-enabler.ts:396-407`). The host removes the DOM node; a new `Enabler` repeats construction side effects |

---

## 5. Outcome

**How the host learns it:** one of the two callbacks, or — for redirect-based methods — a navigation to
its own return page. **The callback values do not all mean what their names say:**

| What the host receives | What it means | Source |
| --- | --- | --- |
| `onComplete({ isSuccess: true, paymentReference, paymentIntent })`, one-time | confirmed with the provider and accepted by the processor: `Authorization/Success` written on the platform Payment, cart frozen. **No order yet** | `dropin-embedded.ts:183-187`; `stripe-payment.service.ts:1048-1111` |
| same, `paymentMode: subscription` | subscription created and confirmed; `paymentIntent` is a `pi_…` | `dropin-embedded.ts:240-244` |
| same, `paymentMode: setup` | subscription created from a saved method; **`paymentIntent` carries a SetupIntent id (`seti_…`)** | `dropin-embedded.ts:209-213` |
| `onComplete({ isSuccess: false })` | **not a failure.** Emitted only for outcome `pending`: the PaymentIntent is `processing` (ACH, async settlement); `Authorization/Pending` written and the cart frozen. Tell the shopper the payment is processing | `dropin-embedded.ts:178-181`; `stripe-payment.service.ts:1073-1097`; `workflows/process-crypto-payment.md` |
| `onError(err)` with `err.type === 'requires_action'` and `err.next_action` | the provider returned `requires_action`. For a bank transfer under `pi_first` this is the issuance of wire instructions — the storefront must render them; Stripe.js does not (`workflows/process-bank-transfer-payment.md`, steps 3–5). For ACH micro-deposits it means verification has started | `enabler/src/services/stripe-service.ts:64-75`; freeze by webhook, `stripe-payment.route.ts:186-216` |
| `onError(err)` with `err.type === 'payment_failed'` | declined; `err.last_payment_error` is the provider's | `stripe-service.ts:76-81` |
| `onError(…)` with a provider `submit` error or a processor JSON body | a validation failure or a processor rejection | `dropin-embedded.ts:126-130, 145-147` |
| **Navigation** to `{merchantReturnUrl}?cartId=…&paymentReference=…&payment_intent=…&payment_intent_client_secret=…` | a redirect-based method left the page. No callback fires and #5 is never called; the webhook path drives the outcome (`workflows/process-crypto-payment.md`, Notes). The setup-intent path returns to the bare URL (`stripe-service.ts:98`) | `stripe-service.ts:42-44`, `:55`. The provider appends `payment_intent` and `payment_intent_client_secret`, and redirects only for redirect-based methods under `redirect: "if_required"` |

**Who does what next**

| The unit does, by itself | The host must do |
| --- | --- |
| Create the **order** from the cart when the PaymentIntent succeeds — webhook-driven, asynchronous (`stripe-payment.service.ts:1275-1277`, `:1634`). It refuses to create the order unless the amount collected matches the cart's current total and currency, pinning the cart version (`stripe-payment.service.ts:1526-1543`, `:1598-1614`, `:1703-1716`; `business-rules/payment-confirmation.md`). The unit never refunds | Show a confirmation without an order number, or **find the order itself** — the unit never returns an order id. Do not let the shopper modify the cart between payment and order creation: an enlarged cart is refused, not charged |
| Copy the charge's address onto the cart only when the cart has no complete shipping address | Put the validated shipping address on the cart before payment (§2) |
| Settle `pending` payments and write their transactions from webhooks; keep the cart **frozen** while funds are in flight (bank transfer, ACH). An abandoned bank transfer stays frozen until the merchant cancels the PaymentIntent (`workflows/process-bank-transfer-payment.md`, Error Paths) | Not treat `isSuccess: false` as failure; not retry checkout. **Treat a `Frozen` cart as "payment in flight", never as unusable** |
| Subscriptions: on every `invoice.paid`, a new order per cycle under the default `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING=createOrder`, or a payment added to the first order under `addPaymentToOrder` (`stripe-subscription.service.ts:1648-1674`; `business-rules/recurring-billing.md`). Unfreeze the cart on `customer.subscription.deleted` (`stripe-subscription.service.ts:2202-2221`) | Nothing per renewal |
| On `DELETE /subscription-api/…`: cancel at the provider **only**; the call itself writes nothing to the platform (`stripe-subscription.service.ts:1257`). The cart is unfrozen later, asynchronously, by the `customer.subscription.deleted` webhook (`:2202-2221`) | Not read the cart's subscription field as the subscription's state after an API cancel; not expect the cart to be unfrozen when the call returns |
| Nothing on the return page | Read `payment_intent` / `redirect_status` from the URL and render the result |

---

## 6. Running a host locally against a deployed unit

- **The built bundle reads no environment variable**; `processorUrl` and `sessionId` are passed in.
  Production session creation belongs on the host backend (§3a).
- **Test mode is inferred from the key.** `environment` becomes `test` when the publishable key contains
  `_test_` (`payment-enabler-mock.ts:131-133`).
- **Apple Pay and Google Pay do not render on `localhost`.** Wallets and several redirect methods need a
  registered HTTPS domain, locally too; use a tunnel and register it in a sandbox.
- **Against a locally run processor, nothing completes on its own.** Orders, settlements and subscription
  renewals arrive by provider webhook to the URL that post-deploy registered (`README.md:317`). Against
  the deployed processor this does not apply.
- **JWT-protected routes** (`/operations/status`, `/operations/payment-components`, `operation.route.ts:45-75`)
  are for the platform; locally they need the mock in `jwt-server/server.js` (`docker-compose.yaml:4-15`).
  A P1 host never calls them.
- **Local ports** of the repository's compose file: processor 8080, enabler dev page 3000, JWT mock 9002
  (`docker-compose.yaml:47`, `:31`, `:15`). A locally run processor needs Node ≥ 24.22.1 (pinned for local
  dev by `.nvmrc` and the `processor`/`enabler` `docker-compose` images, both `node:24.22.1` — `jwt-server`
  stays on `node:alpine`).
