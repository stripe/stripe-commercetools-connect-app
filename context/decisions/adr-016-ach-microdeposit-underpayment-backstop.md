# ADR-016: Underpayment backstop on `payment_intent.succeeded` + freeze on ACH micro-deposits

**Status:** Accepted
**Date:** 2026-08-21

## Context

ACH `us_bank_account` verified by micro-deposits confirms to `requires_action`
(`next_action.type = verify_with_microdeposits`) and settles days later. Three protections that
guard against a mutated-cart underpayment on the instant and bank-transfer rails all miss this rail:

1. The synchronous confirm gate (`updatePaymentIntentStripeSuccessful`) validates the amount only for
   statuses `['succeeded','requires_capture','processing']`, so it never sees a micro-deposit
   `requires_action`.
2. The `requires_action` cart freeze covered only bank transfer (`display_bank_transfer_instructions`),
   so a micro-deposit cart stayed editable.
3. `handlePaymentIntentSucceededFlow` logged an `amountMismatch` warning and created the order anyway,
   from the cart's current total.

Reproduced live on 2026-08-21: pay $6.99 by ACH micro-deposits, return to the site and add $4000 of
items, and on settlement the order was created at $4000 while $6.99 was collected. This is the residual
of KI-044 (freeze moved to each rail's commitment point — micro-deposits had none) and KI-047 (confirm
gate compares against the current total — but not for `requires_action`). The same third gap exists on
every delayed-notification rail (boleto, OXXO, konbini, multibanco).

Hub rule constrains the remedy: *"Divergence is logged and surfaced — never auto-corrected."*

## Decision

Add two layers:

- **Layer 1 (backstop, universal):** in `handlePaymentIntentSucceededFlow`, before creating the order,
  require `pi.amount === currentCartTotal.centAmount` **and** `pi.amount_received === pi.amount` **and**
  matching currency, where `currentCartTotal = ctCart.taxedPrice?.totalGross ?? ctCart.totalPrice`
  (integer comparison in the currency minor unit — no division, so correct for zero-decimal
  currencies). On mismatch, log `error` and return without creating the order. Also skip cleanly when
  the cart is already `Ordered` (idempotency, mirroring the subscription path).
- **Layer 2 (freeze, ACH micro-deposit rail):** add `isMicrodepositNextAction` (kept **separate** from
  `isBankTransferNextAction`) and freeze the cart on a micro-deposit `requires_action`, reusing the
  existing bank-transfer freeze path.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Only freeze on micro-deposits (no succeeded backstop) | Doesn't cover boleto/OXXO/etc.; a swallowed freeze failure would still create an over-order. Correctness must not depend on the freeze succeeding. |
| Only the succeeded backstop (no freeze) | Correct, but leaves the shopper editing a cart whose extra items silently won't be honoured; the freeze fails fast at the source. Layer 1 is the safety net, Layer 2 the UX/hygiene guard. |
| Broaden `isBankTransferNextAction` to also match micro-deposits | Risks relaxing the predicate that the 3DS/Boleto release-gate tests protect. Two narrow predicates keep those gates green. |
| Generalise the freeze to every deferred `next_action` (boleto, OXXO, …) | Broader blast radius than the validated rail; Layer 1 already guarantees correctness for them. Deferred as a follow-up. |
| Auto-refund / cancel the PaymentIntent when the backstop blocks the order | Violates the hub's no-auto-correction rule. The paid-without-order state is logged for manual reconciliation instead. |

## Consequences

**Positive:** an order can never be created for more than was actually paid, on any rail; ACH
micro-deposit carts become immutable once the debit is in flight; redelivered `succeeded` events are a
clean no-op.

**Negative:** when the backstop blocks an order the money is already captured, leaving a
paid-without-order state that a human must reconcile (no auto-refund). Layer 2 inherits KI-044 — an
abandoned micro-deposit cart stays `Frozen` with no unfreeze-on-abandonment.

**Risks:** boleto/OXXO/konbini/multibanco are covered only by Layer 1 (no freeze) until the freeze is
generalised; their carts stay editable and rely on the backstop to reject an over-order at settlement.
