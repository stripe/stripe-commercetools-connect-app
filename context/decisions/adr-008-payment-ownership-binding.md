# ADR-008 — Two-Layer Ownership Binding for Caller-Supplied Payment References

**Status:** Accepted
**Date:** 2026-07-28

## Context

`POST /subscription/confirm` accepted a caller-supplied `paymentReference` and wrote
`Authorization:Success`/`Charge:Success` transactions to that CT payment without verifying it
belonged to the caller's own cart — CWE-639 (IDOR), reported via bug bounty through Stripe
VulnMgmt. A structurally identical guard already existed for the PaymentIntent-confirm path
(`updatePaymentIntentStripeSuccessful`, `stripe-payment.service.ts:521`, local commit `639cee2`),
but that fix was never generalized into a documented rule, so the subscription-confirm path was
never brought into the same fix wave. See `business-rules/payment-ownership-binding.md`.

## Decision

Every endpoint that accepts a caller-supplied payment/PaymentIntent reference must apply ownership
binding in two layers before writing a transaction:

1. **Layer 1 — cart ownership (primary).** The reference must be a member of the caller's own
   `cart.paymentInfo.payments[]`. This is what actually closes the IDOR: it ties the reference to
   the session's own cart, independent of what the reference's value looks like.
2. **Layer 2 — server-derived reference matching (defense-in-depth).** The CT payment's
   `interfaceId` must match one of the reference values the server itself derived for this
   operation (PaymentIntent id / invoice id / subscription id, as applicable to the mode). This
   catches the case where a cart carries more than one payment reference and the wrong one was
   supplied for the specific operation being confirmed.

Layer 2 never runs in place of Layer 1 — a reference that fails Layer 1 is rejected before Layer 2
is evaluated.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Rely on session/JWT scoping alone | A valid session proves the caller has *a* cart, not that a caller-supplied reference belongs to it — the underlying IDOR is precisely that gap. |
| Layer 2 (`interfaceId` matching) only, no cart-ownership check | `interfaceId` values are not secrets and are visible to the caller from their own successful checkouts in some modes; matching alone does not prove the payment is attached to *this* caller's cart. |
| Single-value `interfaceId` equality (reusing the PaymentIntent-confirm implementation directly) | Subscription modes without an immediate charge (`setup-intent`, `trial`, `send-invoice`) carry `in_`/`sub_` prefixes rather than `pi_` in `interfaceId`; single-value equality against `paymentIntentId` alone would false-reject legitimate confirmations in those modes. |

## Consequences

**Positive:** Closes the reported IDOR without weakening any legitimate confirmation path (PI,
setup-intent, trial, send-invoice, no-invoice all remain reachable). The pattern is now documented
once, so a future third caller-facing confirmation/refund endpoint can apply it directly instead of
re-discovering the need for it.

**Negative:** Two checks per confirmation call instead of one; negligible latency cost (in-memory
comparisons against an already-fetched cart/payment, no extra network calls).

**Risks:** If a future endpoint copies only Layer 2 without Layer 1 (e.g. because Layer 2 looks like
"the real check" from reading the code in isolation), the IDOR reopens. Mitigated by
`business-rules/payment-ownership-binding.md` stating Layer 1 as the primary closure, not Layer 2.
