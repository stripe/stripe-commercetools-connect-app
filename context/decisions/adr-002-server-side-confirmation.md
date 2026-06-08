# ADR-002 — Server-Side Payment Intent Confirmation for 3DS Support

**Status:** Accepted  
**Date:** 2024

## Context

Same as [ct-connect-stripe-checkout ADR-002](../../ct-connect-stripe-checkout/context/decisions/adr-002-server-side-confirmation.md).

For subscriptions, the first payment may trigger 3DS authentication. The connector must handle this within the subscription creation flow without losing the CT state.

## Decision

Server-side confirmation applies to both one-time PaymentIntents and the initial charge of a subscription. For subscriptions confirmed via `POST /subscription/confirm`:

1. Client passes the `clientSecret` returned from `POST /subscription`
2. Client calls `stripe.confirmPayment()` in-browser (Stripe handles 3DS)
3. On success, client calls `POST /subscription/confirm` to sync state to CT
4. Processor validates the subscription status and marks CT payment as `AUTHORIZED`

## Consequences

- See checkout ADR-002 for base consequences
- Subscription 3DS is handled by Stripe inline in the Payment Element — no external redirect required for card payments
- Redirect-based payment methods for subscriptions (SEPA, Bacs) still require `MERCHANT_RETURN_URL`
