# Security Policy

## Overview

The Stripe Payment Connector for Composable Commerce is a **backend translation layer and frontend component wrapper** that integrates Stripe's payment platform with Commercetools' commerce platform. It runs inside the [Commercetools Connect](https://docs.commercetools.com/connect) managed runtime.

This document describes the connector's security model, shared responsibility boundaries, and how to report vulnerabilities.

## Deployment Model

This connector is designed to run in the **Commercetools Connect runtime**, a managed platform on Google Cloud Platform. It is NOT a standalone application.

```
Internet
    │
    ▼
┌──────────────────────────────────────┐
│  Commercetools Connect Runtime       │
│  (managed platform on GCP)           │
│                                      │
│  Provides:                           │
│  - TLS termination (min TLS 1.2)     │
│  - HTTPS enforcement (HTTP → 404)    │
│  - Container isolation               │
│  - Secrets encryption                │
│  - Required config enforcement       │
│  - Pre-deploy SAST/SCA scanning      │
│  - Autoscaling                       │
│  - Request timeout (5 min)           │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  This Connector                │  │
│  │  (processor service +          │  │
│  │   enabler static assets)       │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

Users install this connector via the Commercetools Connect marketplace and configure it through environment variables. Users do NOT manage infrastructure, networking, or TLS.

Users may also fork this repository and import it as a **custom** connect application. In that case, the same runtime protections apply, but code-level modifications are the user's responsibility.

## Shared Responsibility Model

### Commercetools Connect Runtime is responsible for:
- TLS termination and HTTPS enforcement
- Container isolation between applications
- Encrypting secrets stored in `securedConfiguration`
- Enforcing `required: true` configuration fields at deployment time
- Pre-deployment static analysis (SAST) and software composition analysis (SCA)
- Autoscaling and availability
- Request timeout enforcement (5 minutes)

### This connector is responsible for:
- Authenticating and authorizing every request via JWT, OAuth2, or Stripe webhook signature
- Validating all input (request bodies, URL parameters, query strings)
- Sanitizing error responses (not leaking internal details)
- Translating between Stripe and Commercetools payment schemas correctly
- Handling Stripe webhook events idempotently
- Managing Stripe customer, payment, and subscription lifecycle

### The merchant (user) is responsible for:
- Providing valid Stripe API keys and webhook signing secrets
- Configuring the Stripe webhook endpoint to point to the connector
- Building their storefront frontend and checkout flow
- Implementing business logic (fulfillment, refund policies, fraud rules)
- Restricting Stripe API key permissions to the minimum required scopes
- Monitoring payment operations and handling disputes

## Authentication Model

The connector uses different authentication mechanisms depending on the endpoint category:

### Frontend-facing endpoints (Session JWT)
Endpoints called by the merchant's storefront via the enabler component:
- `GET/POST /payments` -- Create payment intent
- `POST /confirmPayments/:id` -- Confirm payment
- `GET /config-element/:payment` -- Get UI configuration
- `POST /setupIntent` -- Create setup intent
- `POST /subscription` -- Create subscription
- `POST /shipping-methods` -- Get shipping methods
- `GET /customer/session` -- Get customer session

These are protected by `SessionHeaderAuthenticationHook` from the [connect-payments-sdk](https://github.com/commercetools/connect-payments-sdk), which validates a session JWT issued by Commercetools Checkout.

### Backend/service-to-service endpoints (OAuth2 + Authorization)
Endpoints called by merchant backend systems or Commercetools Checkout:
- `POST /payment-intents/:id` -- Capture, refund, or cancel payment
- `POST /subscription-api/:customerId` -- Update subscription
- `DELETE /subscription-api/:customerId/:subscriptionId` -- Cancel subscription

These are protected by `Oauth2AuthenticationHook` and `AuthorityAuthorizationHook`, which validate OAuth2 tokens and check required scopes (`manage_project`, `manage_checkout_payment_intents`).

### Webhook endpoint (Stripe HMAC signature)
- `POST /stripe/webhooks` -- Receive Stripe webhook events

This endpoint uses **Stripe's prescribed webhook verification pattern**:

1. **Pre-filter** (`StripeHeaderAuthHook`): Rejects requests that do not include a `stripe-signature` header. This is a lightweight gate that filters out obviously non-Stripe traffic before body processing.

2. **Cryptographic verification** (`stripe.webhooks.constructEvent()`): The sole security control for webhooks. It:
   - Recomputes HMAC-SHA256 over `timestamp + "." + rawBody` using the webhook signing secret (`whsec_...`)
   - Compares the computed signature against the one in the `stripe-signature` header
   - Validates the timestamp (300-second tolerance) to prevent replay attacks
   - Throws if any check fails, and the handler returns HTTP 400

   This is [Stripe's officially recommended approach](https://docs.stripe.com/webhooks#verify-official-libraries). The signing secret is a shared secret between Stripe and the merchant, established during webhook endpoint registration. Stripe does not use API keys or OAuth for webhooks -- the HMAC signature scheme is the entire trust model.

3. **Raw body preservation**: The `fastify-raw-body` plugin is configured specifically for the webhook route to preserve the exact bytes Stripe sent. This is required because `constructEvent()` validates against the original bytes -- if the body were parsed as JSON first and re-serialized, the signature would fail.

> **Note for security reviewers:** The `StripeHeaderAuthHook` is intentionally a presence check only. It is NOT the security control -- `constructEvent()` is. This is by design per Stripe's webhook verification documentation.

## Payment Flow Integrity

The connector uses [Stripe's deferred intent pattern](https://docs.stripe.com/payments/payment-element/deferred-intent) -- no PaymentIntent exists until the customer submits payment. Key integrity properties:

- **Cart freeze guarantees amount consistency.** When a PI is created, the cart is frozen immediately after. A frozen Commercetools cart rejects all modification actions. This ensures `PI amount === cart total` for the lifetime of the payment flow.
- **Express Checkout shipping routes are component-specific lifecycle handlers**, not general-purpose cart management APIs. `GET /shipping-methods/remove` handles Express Checkout cancellation (user dismisses Apple Pay / Google Pay sheet). In the deferred intent pattern, no PI exists at cancellation time -- PI creation only happens on the `confirm` event, which is mutually exclusive with `cancel`.
- **Amount validation is intentionally not hardcoded** in the webhook handler. In automatic capture, cart freeze guarantees the match. In manual capture, multi-capture, and incremental auth, amounts legitimately differ. The webhook handler warns on anomalies (unfrozen cart at `payment_intent.succeeded` time) rather than blocking.

For implementation details, see [CLAUDE.md](./CLAUDE.md#payment-flow-integrity).

## CORS Policy

The connector sets `origin: '*'` for CORS. This is intentional for the following reasons:

1. **Composable commerce model**: The enabler component is designed to be embedded in any merchant's storefront, on any domain. The connector cannot predict merchant domains at build time.

2. **CORS is not the security boundary**: Every endpoint is independently authenticated via session JWT, OAuth2, or Stripe webhook signature. CORS is a browser-level mechanism; server-to-server requests bypass it entirely. The authentication layer is the actual security control.

3. **No credentials in CORS**: The connector does not use cookies or browser-stored credentials for authentication. All auth is via explicit headers (`Authorization`, `X-Session-ID`), which requires the caller to already possess valid tokens.

Merchants who want to restrict CORS origins for defense-in-depth can fork the connector and modify the CORS configuration in `processor/src/server/server.ts`.

## Configuration Security

### Secret management

Secrets are declared as `securedConfiguration` in `connect.yaml` and are:
- Encrypted at rest by the Connect runtime
- Write-only (cannot be retrieved or viewed after being set)
- Injected as environment variables at container startup
- Enforced as `required: true` -- deployment fails if not provided

The following are stored as secured configuration:
| Variable | Purpose |
|---|---|
| `CTP_CLIENT_ID` | Commercetools API client ID |
| `CTP_CLIENT_SECRET` | Commercetools API client secret |
| `STRIPE_SECRET_KEY` | Stripe server-side secret key |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | Webhook HMAC signing secret |

### Stripe API key permissions

When using restricted Stripe API keys, the minimum required permissions are:
- PaymentIntents: Write
- Refunds: Write
- Customer: Write
- CustomerSession: Write
- Webhook Endpoints: Write
- Subscriptions: Write

We recommend using restricted keys scoped to only these permissions rather than using the full secret key.

## Data Flow Trust Boundaries

```
┌─────────────┐     Session JWT      ┌──────────────────┐    Stripe SDK     ┌─────────────┐
│  Merchant's  │ ──────────────────► │  This Connector   │ ───────────────► │   Stripe     │
│  Storefront  │ ◄────────────────── │  (processor)      │ ◄─────────────── │   API        │
│  (browser)   │   Payment config    │                   │   PaymentIntent  │              │
└─────────────┘                      │                   │                  └──────┬───────┘
                                     │                   │                         │
                                     │                   │   Webhook + HMAC sig    │
                                     │                   │ ◄───────────────────────┘
                                     │                   │
                                     │                   │    CT SDK          ┌─────────────┐
                                     │                   │ ───────────────► │ Commercetools │
                                     │                   │ ◄─────────────── │     API       │
                                     └──────────────────┘   Payment/Order   └──────────────┘
```

**Trust boundaries:**
1. **Browser → Connector**: Untrusted. Every request must carry a valid session JWT. Input is validated via Fastify schemas.
2. **Connector → Stripe**: Trusted. Uses Stripe SDK with the merchant's secret key over TLS.
3. **Stripe → Connector (webhooks)**: Semi-trusted. Every event is cryptographically verified via `constructEvent()`.
4. **Connector → Commercetools**: Trusted. Uses CT SDK with OAuth2 client credentials over TLS.

## Reporting Vulnerabilities

If you discover a security vulnerability in this connector, please report it responsibly:

1. **Do NOT open a public GitHub issue** for security vulnerabilities.
2. Email security reports to the repository maintainers with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact assessment
   - Suggested fix (if any)
3. Allow reasonable time for the issue to be addressed before public disclosure.

### Out of scope for vulnerability reports

The following are **by design** and will be triaged as informational:

**Infrastructure and runtime:**
- **`origin: '*'` CORS configuration**: Intentional for composable commerce. See [CORS Policy](#cors-policy).
- **`StripeHeaderAuthHook` being a presence-only check**: Intentional. `constructEvent()` is the cryptographic guard. See [Webhook endpoint](#webhook-endpoint-stripe-hmac-signature).
- **The connector accepting connections from any IP**: The Connect runtime handles network-level controls. The connector authenticates at the application layer.
- **Missing WAF or DDoS protection at the application level**: This is the responsibility of the Connect runtime infrastructure (GCP baseline).
- **Commercetools SDK or Stripe SDK vulnerabilities**: Report these to their respective maintainers.

**Payment flow design:**
- **Express Checkout cancellation unfreezing the cart**: This is the intended behavior. No PI exists at cancellation time in the deferred intent pattern. See [Payment Flow Integrity](#payment-flow-integrity).
- **No hard amount validation in the webhook handler**: Intentional. Cart freeze guarantees consistency for automatic capture. Manual/multi-capture flows require amount flexibility. See [Payment Flow Integrity](#payment-flow-integrity).
- **Exploits that chain routes from different checkout components** (e.g., Payment Element PI creation + Express Checkout cancellation): These routes serve different components with different lifecycles. The connector is a composable building block -- the merchant's storefront controls which routes are called and in what sequence.
- **CT orders created on failed subscription billing cycles**: This is intentional design. Every billing attempt (success or failure) produces a CT order for auditability. The fulfillment signal is `charge.succeeded` → `Authorization:Success` on the CT payment, which never fires for a declined charge. An order with `paymentState: 'Paid'` alongside `Failure` transactions on the CT payment is a data quality bug if present, but does not constitute a payment bypass — `charge.succeeded` is the canonical fulfillment signal and is unaffected by payment failure.

**PoC methodology:**
- **PoCs that require Stripe secret key (`sk_*`) or Commercetools admin credentials**: These are server-side secrets that customers do not possess. Exploits requiring them demonstrate Stripe/CT API access, not a connector vulnerability.
- **PoCs that bypass the connector by calling Stripe or Commercetools APIs directly** rather than through the connector's routes: The connector's security model applies to its own endpoints. Direct API calls to Stripe or Commercetools are outside the connector's control and are governed by those platforms' own access controls.
- **State manipulation that requires direct Commercetools cart/order API access** (e.g., modifying a frozen cart, creating orders, updating payments) outside the connector's routes: The connector does not own or secure the Commercetools API surface.

### In scope for vulnerability reports

- Authentication or authorization bypasses on the connector's own routes
- Business logic flaws **within the connector's own payment flows** (e.g., incorrect amount calculation from cart data, refund exceeding charged amount, transaction state corruption during webhook processing)
- Input validation bypasses on the connector's routes that lead to unauthorized actions
- Information disclosure (error messages, logs, or responses leaking sensitive data)
- Injection vulnerabilities in any form
- Cryptographic weaknesses in the connector's own code (not Stripe's SDK)

## Security-Related Configuration

| Variable | Security Relevance | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | Server-side API authentication | Use restricted keys with minimum scopes |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | Webhook HMAC verification | Unique per webhook endpoint |
| `CTP_CLIENT_ID` / `CTP_CLIENT_SECRET` | Commercetools API authentication | Scope to minimum required permissions |
| `CTP_JWKS_URL` | JWT signature verification | Must point to the correct Commercetools region |
| `CTP_JWT_ISSUER` | JWT issuer validation | Must match the Commercetools region |
| `STRIPE_CAPTURE_METHOD` | `manual` vs `automatic` capture | `manual` requires explicit capture call |
| `STRIPE_ENABLE_MULTI_OPERATIONS` | Multicapture/multirefund | Disabled by default; requires Stripe account support |

## Related Documentation

- [Stripe Webhook Verification](https://docs.stripe.com/webhooks#verify-official-libraries) -- Stripe's official verification documentation
- [Commercetools Connect Security](https://docs.commercetools.com/connect/concepts) -- Connect runtime security model
- [connect-payments-sdk](https://github.com/commercetools/connect-payments-sdk) -- Authentication hooks documentation
