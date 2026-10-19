# ADR-023: Webhook signature-failure logging must never serialize the error object

**Status:** Accepted
**Date:** 2026-10-15

## Context

The Stripe webhook route (`processor/src/routes/stripe-payment.route.ts`) verifies
each delivery with `stripeApi().webhooks.constructEvent(request.rawBody, …)`. On a
signature-verification failure the catch logged the error with
`log.error(JSON.stringify(err))`.

`stripe-node@20.4.1` constructs `StripeSignatureVerificationError` with the raw
request body assigned as an **own-enumerable `payload`** property (and the signature
header as `header`) — see `node_modules/stripe/cjs/Error.js:157-162`. `JSON.stringify`
therefore serialized the entire unredacted webhook body into the commercetools Connect
application logs: a live `client_secret` on any PaymentIntent/SetupIntent event, and
the merchant's IBAN/BIC + `hosted_instructions_url` on `customer_balance` bank-transfer
events.

This bypassed the connector's own redaction choke point,
`StripeEventConverter.buildPspInteractionResponse`, which nulls `client_secret`, strips
`financial_addresses`, and nulls `hosted_instructions_url` — but only on the persistence
path, not on the error-logging path. A signature-verification failure is a routine
operational state (signing-secret rotation, clock skew > 5 min, body mangled in transit,
or Stripe's retries), so the leak fired on genuine deliveries, not just attacker probes.

Reported via HackerOne #4062079 (CWE-532). The sibling `ct-connect-stripe-checkout`
connector had already fixed the identical line.

## Decision

The webhook signature-failure catch (and the `confirmPayments` catch) log **only the
error type and message** — `log.error('…', { errorType, errorMessage })` — and **never**
serialize the error object, `err.payload`, or `err.header`. For a
`StripeSignatureVerificationError`, `err.message` is a static diagnostic string (e.g.
"No signatures found matching the expected signature for payload.") with no body, so it
is safe. The 400 reply (`Webhook Error: ${err.message}`) is likewise body-free.

This discipline is **enforced** on the webhook catch, the `confirmPayments` catch, and
`stripe-subscription.service.ts` — an ESLint `no-restricted-syntax` rule scoped to those
files forbids a raw `error` log field or `JSON.stringify(<caught error>)`. It **should**
apply to any catch that may receive a Stripe error, because Stripe errors expose `raw`,
`payment_intent`, `setup_intent`, `source`, `charge`, `payload`, and `header` as
own-enumerable properties — so a card error on a PaymentIntent request can carry a
`client_secret` even when there is no webhook body. The remaining processor-wide sinks
(e.g. `stripe-payment.service.ts`, `stripe-customer.service.ts`) are tracked for a
separate sweep rather than enforced here.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Promote the converter's redaction to a shared helper and call it on the error path | The error path has no constructed `Event` object — `constructEvent` threw — so there is nothing for the converter to redact; it operates on a valid event, not a raw body. |
| Redact the body string before logging | Reinvents Stripe's field semantics and is fragile; logging only `type`+`message` removes the sensitive data entirely instead of trying to scrub it. |
| Keep `JSON.stringify(err)` but strip `payload`/`header` first | Brittle allow/deny-listing of SDK-internal fields; a future SDK change could add another own-enumerable sensitive field. |

## Consequences

**Positive:** The live `client_secret` and merchant bank coordinates can no longer reach
the Connect logs on a verification failure. Upholds the connector rule "Never log
sensitive data: Stripe payloads" and reaches parity with the checkout sibling. Guarded by
a directed test that reproduces the real error shape and fails on regression to
`JSON.stringify(err)`.

**Negative:** Slightly less raw detail in the failure log line — mitigated because
`errorType`+`errorMessage` carry the full diagnostic value for this error class.

**Risks:** The `stripe-subscription.service.ts` sinks fixed here carried Stripe *API*
errors on Subscription / Price / Cart requests, which generally do not involve a
PaymentIntent and so generally carry no `client_secret` or IBAN. That "generally" is
load-bearing: a Stripe error *can* carry `payment_intent`/`setup_intent` (and therefore a
`client_secret`) on any request that involves one, which is exactly why the field-scoped
discipline is the correct default and not merely cosmetic parity. Other processor-wide
sinks still serialize raw errors and are tracked for a separate sweep.
