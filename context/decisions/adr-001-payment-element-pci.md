# ADR-001 — Stripe Payment Element for PCI Compliance Reduction

**Status:** Accepted  
**Date:** 2024

## Context

Same as [ct-connect-stripe-checkout ADR-001](../../ct-connect-stripe-checkout/context/decisions/adr-001-payment-element-pci.md).

Additionally, the composable connector uses the Payment Element for both one-time payments and subscription setup — the same iframe-based component collects the payment method regardless of whether the intent is a `PaymentIntent` or a `SetupIntent`.

## Decision

Use **Stripe Payment Element** for all payment method collection. This applies to both:
- Standard one-time payments (PaymentIntent flow)
- Subscription setup via SetupIntent (`POST /setupIntent`)

## Consequences

- See checkout ADR-001 for base consequences
- `SetupIntent` and `PaymentIntent` share the same UI — the Payment Element adapts based on which client secret it receives
- Saved payment methods from a SetupIntent can be reused for future subscription charges (`off_session: true`)
