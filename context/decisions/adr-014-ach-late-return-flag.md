# ADR-014: A post-settlement ACH reversal (late return) is flagged, not auto-reversed

**Status:** Accepted
**Date:** 2026-08-12

## Context

An ACH debit can be reversed by the customer's bank **after** it has already settled — up to
~60 days later. Stripe signals this with `payment_intent.payment_failed` / `charge.failed`, but
crucially does **not** re-fire `invoice.payment_failed`. The subscription handlers are driven by
`invoice.*` events, so a late return was completely invisible: the CT order stayed `Paid` while
Stripe had clawed back the funds — a silent divergence on real money.

This sits alongside the product decision that disputes/chargebacks and reversals stay with the
PSP (Stripe Dashboard) and are not modelled as connector-driven workflows.

## Decision

Route a subscription-invoice `payment_intent.payment_failed` to `processSubscriptionEventLateReturn()`,
which flags the CT Payment via the native `paymentStatus` interface
(`interfaceCode = ach_late_return`, plus a human-readable `interfaceText`) **without** changing
any transaction or the order state. The handler acts only when the payment already carries a
`Charge/Success` (`wasSettled`); a still-`Pending` charge is an ordinary failure handled by
`invoice.payment_failed`. It is best-effort and never throws.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Auto-reverse: write a Chargeback/refund transaction and flip the order | commercetools is the source of truth for order state; auto-reconciliation of a PSP reversal is explicitly out of scope (reversals stay with Stripe). |
| Do nothing | The divergence stays silent — the exact gap this closes. |
| Model it as a dispute (`charge.dispute.*`) | An ACH late return is not a dispute object; disputes are not modelled in any connector (product decision). |

## Consequences

**Positive:** A late reversal is surfaced for a human to act on, without corrupting the
financial/order record or overstepping the "reversals stay with the PSP" decision.
**Negative:** Resolution is manual (Stripe Dashboard); the flag is informational only.
**Risks:** The flag relies on `payment_intent.payment_failed` carrying the `ct_payment_id`
metadata; a reversal whose PaymentIntent lacks it cannot be routed and is skipped.
