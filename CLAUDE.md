# CLAUDE.md

Guidelines for AI-assisted development on the Stripe Payment Connector for Composable Commerce.

## Project Overview

This is a **Commercetools Connect** payment connector that integrates Stripe with Commercetools. It consists of two packages:

- **processor** (`/processor`): Node.js backend service (Fastify v5, TypeScript) that handles payment operations, webhook events, and Stripe/CT translation
- **enabler** (`/enabler`): Frontend component library (Vite) wrapping Stripe Payment Element for merchant storefronts

The connector runs inside the Commercetools Connect managed runtime. Users install it via marketplace or import as a custom application. Users configure it through environment variables only -- they do not manage infrastructure.

## Architecture Invariants

These are non-negotiable design rules. Do not violate them.

### Authentication

- **Every route must have a `preHandler` auth hook.** No exceptions. Choose the correct one:
  - `sessionHeaderAuthHook.authenticate()` -- for frontend-facing endpoints (called by merchant storefront via enabler)
  - `oauth2AuthHook.authenticate()` + `authorizationHook.authorize(...)` -- for backend/service-to-service endpoints
  - `jwtAuthHook.authenticate()` -- for internal service endpoints (status, payment-components)
  - `stripeHeaderAuthHook.authenticate()` -- for webhook endpoint only (paired with `constructEvent()`)
- **`constructEvent()` is the sole cryptographic guard for webhooks.** The `StripeHeaderAuthHook` is a lightweight pre-filter only. This is Stripe's prescribed pattern. Do not attempt to "fix" the hook by adding signature verification there unless you also remove `constructEvent()` from the route (consolidation is acceptable, but both must not verify independently).
- **Raw body must be preserved for webhook routes.** The `fastify-raw-body` plugin is configured for `/stripe/webhooks` specifically. If adding new webhook routes, ensure they are included in the `routes` array.

### Data Flow

- **Stripe is the source of truth for payment state.** The connector translates Stripe events into Commercetools payment transactions -- never the reverse.
- **Commercetools is the source of truth for prices.** Subscription price sync reads prices from CT and updates Stripe, not the other way around.
- **Metadata is the bridge.** Stripe payment intents carry CT identifiers (cart_id, payment_id, customer_id, etc.) in their metadata. This metadata must always be set during creation and must never be modified after.
- **Webhook events drive state updates.** Payment/order state changes happen via webhook processing (eventual consistency), not via synchronous API responses.

### Payment Flow Integrity

- **This connector uses Stripe's deferred intent pattern.** Elements are mounted with `mode` + `amount` + `currency` but NO `clientSecret`. The PaymentIntent is created server-side at submit time (`POST /payments`), not at page load or component mount. This means no PI exists until the customer commits to paying.
- **Cart freeze is the integrity guarantee.** When a PI is created, the cart is frozen immediately after. A frozen cart cannot be modified (no item additions, quantity changes, or shipping updates). This guarantees that `PI amount === cart total` for the lifetime of the PI. Do not add code paths that break this invariant.
- **Amount validation is intentionally not hardcoded in the webhook handler.** In automatic capture, PI amount always equals the cart total (guaranteed by cart freeze). In manual capture, multi-capture, incremental auth, and extended auth, the captured amount legitimately differs from the original authorization. A hard amount check would break these flows. The existing warn on unfrozen cart at `payment_intent.succeeded` is the correct signal for anomalies.
- **Do not add amount validation that blocks order creation** unless it is scoped to `capture_method === 'automatic'` only.

### Subscription Billing Cycle Design

- **Every subscription billing cycle produces a CT order, including failed payments.** This is intentional. Each billing attempt — whether successful or declined — is recorded as a CT order for auditability and billing history. Do not treat order creation in `processSubscriptionEventFailed()` as a bug.
- **`charge.succeeded` → `Authorization:Success` is the canonical fulfillment signal**, consistent across both one-time payments and subscriptions. A merchant's fulfillment system must gate on this CT payment transaction state, not on `order.paymentState`. `charge.succeeded` never fires for a declined charge — Stripe fires `charge.failed` instead — so failed billing cycles never produce a success transaction on the CT payment.
- **`order.paymentState` must reflect actual payment outcome.** `createOrderFromCart()` accepts a `paymentState` parameter. Success handlers pass `'Paid'`; failure handlers must pass `'Failed'`. An order with `paymentState: 'Paid'` and only `Failure` transactions on the CT payment is a data quality bug, not an exploitable vulnerability — but it must be avoided to prevent merchant confusion.
- **The CT payment object is the authoritative record of payment state.** `order.paymentState` is a derived convenience field. When evaluating whether a payment succeeded, always check CT payment transactions (`Authorization:Success`, `Charge:Success`) rather than `order.paymentState`.

### Route Flow Separation

- **Shipping routes (`/shipping-methods/*`) are Express Checkout infrastructure only.** They exist to support the Apple Pay / Google Pay sheet's shipping address and rate selection lifecycle. The enabler wires them exclusively to `StripeExpressCheckoutElement` events (`shippingaddresschange`, `shippingratechange`, `cancel`). Payment Element flows never call these routes.
- **`GET /shipping-methods/remove` is the Express Checkout cancellation handler.** It unfreezes the cart because the Express Checkout flow was abandoned. In the deferred intent pattern, no PI has been created at the time of cancellation (PI creation only happens on `confirm`, which is mutually exclusive with `cancel`). The unfreeze is correct behavior -- it releases the cart for further shopping.
- **`getShippingMethods` and `updateShippingRate` temporarily unfreeze and re-freeze.** This handles the case where the cart may be frozen from a prior flow. These methods always restore the original frozen state after the shipping update.
- **Do not add general-purpose unfreeze endpoints.** Cart freeze/unfreeze is tied to specific payment lifecycle events, not exposed as a standalone operation.

### Configuration

- **Secrets go in `securedConfiguration` in `connect.yaml`.** Never in `standardConfiguration`.
- **All secrets must be listed as `required: true`** in connect.yaml. The runtime enforces this at deployment.
- **Config defaults in `config.ts` are for local development only.** The runtime enforces required fields. But do not use real-looking defaults (e.g., `'sk_test_...'`). Use empty strings or obviously fake values.

## Security Rules

### Never do these:

- **Never return raw error objects to clients.** No `JSON.stringify(error)`, no `error.message`, no `String(error)` in HTTP responses. Log the full error server-side, return a generic message to the client.
  ```typescript
  // BAD
  return reply.status(400).send({ error: JSON.stringify(error) });
  return reply.status(400).send(`Webhook Error: ${err.message}`);

  // GOOD
  log.error('Payment confirmation failed', { error: err.message, paymentId: id });
  return reply.status(400).send({ outcome: 'rejected', error: 'Payment processing failed.' });
  ```

- **Never use `console.log`, `console.error`, or `console.warn` in the processor.** Use the structured logger from `@commercetools-backend/loggers`. Console statements bypass log-level filtering, lack correlation IDs, and may expose sensitive data in log aggregation systems.
  ```typescript
  // BAD
  console.log('error', JSON.stringify(error, null, 2));

  // GOOD
  log.error('Operation failed', { error: error instanceof Error ? error.message : 'Unknown' });
  ```

- **Never trust or forward user input without validation.** All URL params, query params, and body fields must have Typebox schema validation with format constraints (minLength, maxLength, pattern) -- not just `Type.String()`.

- **Never hardcode secrets, API keys, or tokens.** Even in tests, use environment variables or mock values.

- **Never merge with `origin: '*'` removed from CORS without providing a `CORS_ALLOWED_ORIGINS` env var alternative.** The `origin: '*'` is intentional for composable commerce -- merchants embed the enabler on their own domains. If you need to restrict CORS, make it configurable.

### Always do these:

- **Validate webhook events with `constructEvent()` before processing.** Always use `request.rawBody` (not `request.body`) for signature verification.
- **Set metadata on Stripe objects during creation.** Cart ID, payment ID, customer ID, and project key must always be present in payment intent metadata.
- **Use the connect-payments-sdk auth hooks.** Do not build custom auth middleware. The SDK hooks handle JWT validation, OAuth2 token introspection, and session management.
- **Return appropriate HTTP status codes:** 200 for success, 400 for client errors, 401 for auth failures, 500 for unexpected errors. Never return 200 with an error body.

## Input Validation Requirements

When adding or modifying routes, follow this pattern:

```typescript
// Route schema with proper validation
{
  schema: {
    params: Type.Object({
      customerId: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' }),
    }),
    body: Type.Object({
      amount: Type.Integer({ minimum: 1 }),
      currency: Type.String({ minLength: 3, maxLength: 3, pattern: '^[a-z]{3}$' }),
    }),
    required: ['customerId'] as const,
  },
}
```

- String IDs: `minLength: 1, maxLength: 128`
- Enum-like strings: use `Type.Union([Type.Literal('a'), Type.Literal('b')])`
- Numeric fields: use `Type.Integer()` with `minimum`/`maximum`
- Optional fields: use `Type.Optional(...)` -- never rely on `undefined` checks in handler code

## Code Patterns

### Adding a new route

1. Define the route in the appropriate route file under `processor/src/routes/`
2. Add Typebox schema validation for all params, query, and body
3. Add the correct `preHandler` auth hook
4. Handle errors with try/catch, log server-side, return sanitized response
5. Add corresponding tests in `processor/test/`

### Adding a new webhook event handler

1. Add the event type to `StripeEvent` enum in constants
2. Add a case in the webhook switch in `stripe-payment.route.ts`
3. Determine if the event comes from a subscription invoice (`isFromSubscriptionInvoice()`) and route accordingly
4. Implement the handler in the appropriate service (`stripe-payment.service.ts` or `stripe-subscription.service.ts`)
5. Use `StripeEventConverter` to translate the event to CT payment update format
6. Test with Stripe CLI webhook forwarding locally

### Adding a new environment variable

1. Add it to `processor/src/config/config.ts` with a sensible default
2. Add it to `connect.yaml` under `standardConfiguration` or `securedConfiguration`
3. If it's a secret, it MUST go in `securedConfiguration` with `required: true`
4. Document it in the processor README with description, example value, and default
5. If it changes behavior, add it to the README features section

## Testing

- **Framework**: Jest v30+ with `ts-jest`
- **Mocking**: MSW (Mock Service Worker) for HTTP mocking
- **Location**: `processor/test/`
- **Run**: `cd processor && npm test`
- **Lint**: `cd processor && npm run lint`

### What to test

- Every route handler: happy path + error cases + auth failures
- Webhook event processing: each event type with valid and invalid payloads
- Service methods: business logic with mocked external dependencies
- Config validation: missing/invalid environment variables

### What NOT to test

- Stripe SDK internals (trust `constructEvent()`, `paymentIntents.create()`, etc.)
- Commercetools SDK internals
- The Connect runtime itself

## Payment Flows

### Drop-in (Payment Element) — One-Time Payment

**Initialization (page load):**
1. Merchant creates `Enabler` instance → constructor calls `_Setup(options)`
2. Enabler calls `GET /config-element/{paymentElementType}` (session auth) → processor fetches cart via context, returns `{ cartInfo: {amount, currency}, appearance, captureMethod, layout, collectBillingAddress, paymentMode }`
3. Enabler calls `GET /operations/config` (session auth) → processor returns `{ publishableKey, environment }`
4. Enabler calls `GET /customer/session` (session auth) → processor finds/creates Stripe customer, creates ephemeral key + customer session → returns `{ stripeCustomerId, ephemeralKey, sessionId }` (or 204 if no customer on cart)
5. Enabler calls `loadStripe(publishableKey)` to load Stripe SDK
6. Enabler merges backend config with frontend `stripeConfig` overrides (appearance, layout, collectBillingAddress)
7. Enabler calls `stripe.elements({ mode, amount, currency, appearance, captureMethod, customerOptions })` — **NO `clientSecret`** (deferred intent)
8. Enabler calls `elements.create('payment', elementsOptions)` to create the Payment Element
9. Merchant calls `dropin.mount('#selector')` → Payment Element renders in DOM, payment methods visible

**Submit (user clicks pay):**
1. `elements.submit()` — validates payment form client-side
2. Enabler calls `POST /payments` (or `GET /payments` if no paymentMethodOptions) (session auth) → processor:
   - a. Fetches cart from context
   - b. Gets payment amount from cart
   - c. Finds Stripe customer ID from CT customer custom fields
   - d. Merges payment method options (backend defaults + frontend overrides; card multicapture if enabled)
   - e. Calls `stripe.paymentIntents.create({ amount, currency, automatic_payment_methods: {enabled: true}, capture_method, metadata, payment_method_options })` with idempotency key
   - f. Creates CT Payment object with PI as `interfaceId`
   - g. Adds payment to cart
   - h. **Freezes cart** — guarantees `PI amount === cart total`
   - i. Returns `{ clientSecret, paymentReference, merchantReturnUrl, cartId, billingAddress? }`
3. Enabler calls `stripe.confirmPayment({ clientSecret, elements, confirmParams: {return_url}, redirect: 'if_required' })` — collects payment method from Element and confirms with Stripe
4. Enabler calls `POST /confirmPayments/{paymentReference}` with `{ paymentIntent: pi_xxx }` (session auth) → processor:
   - a. Validates PI ID matches CT Payment `interfaceId` (anti-corruption check)
   - b. Adds `Authorization:Success` transaction to CT Payment
5. Enabler calls `onComplete({ isSuccess: true, paymentReference, paymentIntent })`

**Webhook settlement (async, seconds to days later):**
1. Stripe sends `payment_intent.succeeded` → `POST /stripe/webhooks` (signature verified via `constructEvent`)
2. Processor checks `isFromSubscriptionInvoice()` — false for one-time payments
3. `StripeEventConverter.convert()` maps event → `Charge:Success` CT transaction
4. Processor updates CT Payment with `Charge:Success` transaction
5. Processor fetches cart by payment ID, updates cart address from charge billing/shipping details
6. Processor calls `createOrderFromCart()` → CT order created

**Failure/cancellation (async):**
1. Stripe sends `payment_intent.payment_failed` or `payment_intent.canceled`
2. Processor adds `Authorization:Failure` (+ `CancelAuthorization:Success` for canceled) transactions
3. Processor **unfreezes cart** — allows customer to retry or modify cart

### Express Checkout (Apple Pay / Google Pay)

**Initialization:** Steps 1–8 same as Drop-in, except step 8 creates `elements.create('expressCheckout', ...)` instead.

**Mount:**
1. Express Checkout Element mounted to DOM
2. Four event listeners registered: `shippingaddresschange`, `shippingratechange`, `cancel`, `confirm`

**Shipping address selection:**
1. `shippingaddresschange` fires → Enabler calls `POST /shipping-methods` with partial address
2. Processor: temporarily unfreezes cart → updates shipping address → gets shipping methods → re-freezes cart
3. Enabler calls `elements.update({ amount: newTotal })` and `event.resolve(shippingRates)`

**Shipping rate selection:**
1. `shippingratechange` fires → Enabler calls `POST /shipping-methods/update` with selected rate
2. Processor: temporarily unfreezes → updates shipping method → re-freezes
3. Enabler updates element amount and resolves event

**Cancellation:**
1. `cancel` fires → Enabler calls `GET /shipping-methods/remove`
2. Processor: **permanently unfreezes cart** (no re-freeze), removes shipping method
3. Enabler resets element amount to original total

**Confirm:** `confirm` fires → calls `submit()` → same submit flow as Drop-in steps 1–5 above

### Subscription Payment

**Submit (after `elements.submit()` validates):**
1. Enabler calls `POST /subscription` (session auth) → processor creates Stripe Subscription with PaymentIntent, returns `{ subscriptionId, clientSecret, paymentReference, merchantReturnUrl, cartId }`
2. Enabler calls `stripe.confirmPayment({ clientSecret, elements })` — same as one-time
3. Enabler calls `POST /subscription/confirm` with `{ subscriptionId, paymentReference, paymentIntentId }` → processor confirms CT payment
4. Enabler calls `onComplete()`

**Subscription billing webhooks (recurring):**
- `invoice.paid` → `Authorization:Success` + `Charge:Success` on CT Payment → order created with `paymentState: 'Paid'`
- `invoice.payment_failed` → `Authorization:Failure` + `Charge:Failure` → order still created with `paymentState: 'Failed'` (intentional — every billing cycle produces a CT order for auditability)
- `charge.succeeded` from subscription invoice (detected via `isFromSubscriptionInvoice()`) → routed to subscription handler, not one-time handler

### Setup Intent (Save Payment Method for Future Use)

**Submit (after `elements.submit()` validates):**
1. Enabler calls `POST /setupIntent` (session auth) → processor creates Stripe SetupIntent, returns `{ clientSecret, merchantReturnUrl }`
2. Enabler calls `stripe.confirmSetup({ clientSecret, elements })` — saves payment method without charging
3. Enabler calls `POST /subscription/withSetupIntent` with `setupIntentId` → processor creates subscription using saved payment method
4. Enabler calls `POST /subscription/confirm` → processor confirms CT payment
5. Enabler calls `onComplete()`

### Webhook Event → CT Transaction Mapping

| Stripe Event | CT Transaction Type | CT State | Amount Source |
|---|---|---|---|
| `payment_intent.canceled` | Authorization + CancelAuthorization | Failure + Success | PI `amount` |
| `payment_intent.succeeded` | Charge | Success | PI `amount_received` |
| `payment_intent.payment_failed` | Authorization | Failure | PI `amount` |
| `charge.succeeded` (not captured) | Authorization | Success | Charge `amount` |
| `charge.updated` (multicapture) | Charge | Success | Incremental `amount_captured` delta |
| `charge.refunded` | Refund + Chargeback | Success | Charge `amount_refunded` |
| `invoice.paid` | Authorization + Charge | Success | Invoice `amount_paid` |
| `invoice.payment_failed` | Authorization + Charge | Failure | Invoice `amount_due` |

Events route through `StripeEventConverter.convert()` (one-time) or `SubscriptionEventConverter.convert()` (subscription), which extract `ct_payment_id` from metadata.

### BNPL / Redirect-Based Payment Methods

For redirect-based methods (BNPL, iDEAL, etc.), `stripe.confirmPayment()` uses `redirect: 'if_required'`. If Stripe requires a redirect, the customer is sent to the provider's page. Stripe appends `payment_intent` and `payment_intent_client_secret` to `merchantReturnUrl`. The merchant storefront must handle the return and call `POST /confirmPayments/:id` to complete the CT payment update.

## File Structure Quick Reference

```
processor/src/
├── main.ts                          # Entry point
├── config/config.ts                 # Environment config
├── server/server.ts                 # Fastify setup
├── server/plugins/                  # Plugin autoloading
├── routes/
│   ├── stripe-payment.route.ts      # Payment + webhook routes
│   ├── stripe-subscription.route.ts # Subscription routes
│   ├── stripe-customer.route.ts     # Customer routes
│   ├── stripe-shipping.route.ts     # Shipping routes
│   └── operation.route.ts           # Capture/refund/cancel + status
├── services/
│   ├── stripe-payment.service.ts    # Payment business logic
│   ├── stripe-subscription.service.ts # Subscription business logic
│   ├── stripe-customer.service.ts   # Customer management
│   ├── stripe-shipping.service.ts   # Shipping integration
│   └── converters/                  # Stripe event → CT payment converters
├── clients/
│   └── stripe.client.ts             # Stripe SDK initialization
├── libs/fastify/
│   ├── hooks/                       # Auth hooks
│   ├── context/                     # Request context management
│   └── error-handler.ts             # Global error handler
├── dtos/                            # Typebox schema definitions
├── custom-types/                    # CT custom type definitions
├── connectors/                      # Pre/post deploy scripts
└── constants.ts                     # Metadata field names, enums
```

## Key Dependencies

| Package | Purpose | Version Policy |
|---|---|---|
| `stripe` | Stripe API client | Caret (`^`) -- allow minor updates |
| `fastify` | HTTP server framework | Caret (`^`) |
| `@commercetools/connect-payments-sdk` | Auth hooks, session management, request context | Caret (`^`) |
| `@sinclair/typebox` | Request/response schema validation | Caret (`^`) |
| `@commercetools-backend/loggers` | Structured logging | Caret (`^`) |

## Related Documentation

- [SECURITY.md](./SECURITY.md) -- Security policy, shared responsibility, threat model
- [Processor README](./processor/README.md) -- Detailed processor docs, subscription config, API reference
- [Enabler README](./enabler/README.md) -- Frontend component integration guide
- [Stripe Webhook Docs](https://docs.stripe.com/webhooks) -- Stripe's webhook verification reference
- [Commercetools Connect Docs](https://docs.commercetools.com/connect) -- Runtime platform documentation
