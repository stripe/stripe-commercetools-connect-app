# ADR-013: Async ACH confirm writes Charge/Pending, not premature Success

**Status:** Accepted
**Date:** 2026-08-12

## Context

The subscription confirm flow was built for synchronous payment methods (cards): on
`POST /subscription/confirm` it wrote a `Charge/Success` transaction immediately. ACH Direct
Debit (`us_bank_account`) is asynchronous — at confirm time the PaymentIntent is `processing`
and the money settles ~2–4 business days later (and can still fail). Writing `Charge/Success`
at confirm therefore marked a subscription order as paid before any money had moved: a
premature "paid" that diverges from Stripe if the debit later fails. This was reproduced live.

## Decision

On confirm, retrieve the PaymentIntent status and branch: `succeeded`/`requires_capture` →
write the charge **Success** (synchronous, e.g. card); `processing` → set `isAsyncProcessing`
and write the charge **Pending**; any other status (e.g. `requires_action` micro-deposit
verification) → throw as out of scope. The Pending charge transitions to Success only when
`invoice.paid` confirms real settlement, and to Failure on `invoice.payment_failed`.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Keep writing Charge/Success at confirm | Marks orders paid before funds settle; diverges from Stripe on ACH failures. |
| Fulfill on Pending (create order during processing) | Risks shipping goods against money that never arrives; contradicts "wait for settlement". |
| Block ACH for subscriptions entirely | Removes a requested payment method; the async model is representable in CT with Pending. |

## Consequences

**Positive:** commercetools never claims a subscription payment is captured while funds are in
flight; the async lifecycle is honestly represented (Pending → Success/Failure).
**Negative:** A subscription can sit in `Charge/Pending` for days (the ACH settlement window)
with no order yet — expected, but consumers must handle the Pending state.
**Risks:** A status not covered by the branch (e.g. micro-deposits) throws; the micro-deposit
verification flow is out of scope and must be handled separately before it can be offered.
