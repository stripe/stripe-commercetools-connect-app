# ADR-009: Synchronous confirmation identity binding via interfaceId only

**Status:** Accepted
**Date:** 2026-07-23

## Context

The one-time synchronous payment-confirmation gate (`updatePaymentIntentStripeSuccessful`,
`processor/src/services/stripe-payment.service.ts`) was hardened to retrieve the PaymentIntent
from Stripe and validate its status and amount/currency before writing the commercetools
Authorization transaction (see the async-settlement / crypto work).

The validated sibling connector `ct-connect-stripe-checkout` binds the retrieved PaymentIntent to
the commercetools payment with **two** checks: `ctPayment.interfaceId === paymentIntentId` **and**
`stripePaymentIntent.metadata.ct_payment_id === paymentReference` (a reverse check that the PI
points back at the CT payment).

In `ct-connect-stripe-composable`, `metadata.ct_payment_id` is not set when the PaymentIntent is
created — it is added afterwards via a separate `updatePaymentMetadata` call
(`ct-payment-creation.service.ts`). The composable connector already binds identity through the
existing `interfaceId` check.

## Decision

The composable synchronous confirmation gate binds identity using **`ctPayment.interfaceId ===
paymentIntentId` only**, and does **not** use `metadata.ct_payment_id` as a gate (decision D3).

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Port the sibling's `metadata.ct_payment_id` reverse check as a second gate | `metadata.ct_payment_id` is not guaranteed to be set at confirmation time in composable (added post-creation); using it as a hard gate could reject legitimate confirmations. |
| Set `metadata.ct_payment_id` at PI creation, then gate on it | Larger change touching PI creation and metadata lifecycle; out of scope for this bug fix and offers only defense-in-depth over an already-sufficient binding. |

## Consequences

**Positive:** `interfaceId` is server-persisted at PaymentIntent creation and cannot be forged
through the client request, so it is a sufficient primary binding. Keeps the fix additive for
cards and avoids touching PI-creation/metadata flows.

**Negative:** Drops one defense-in-depth layer (the reverse `metadata.ct_payment_id` check) that
the validated sibling has, so the two connectors diverge in their identity-binding strategy.

**Risks:** If a future change made `interfaceId` client-influenced or removed it, the single
binding would become insufficient. Security review (Phase 3, Low finding) rated the current
binding sufficient; a future hardening could align composable with checkout by setting
`metadata.ct_payment_id` at creation and adding the reverse check.
