# ADR-012: An unusable payment-behavior value degrades; it never aborts startup

**Status:** Accepted
**Date:** 2026-08-05

## Context

`STRIPE_PAYMENT_BEHAVIOR_RULES` and `STRIPE_PAYMENT_FLOW` are operator-typed configuration. An
earlier version of the validator threw on any bad value, on the reasoning that a silent fallback
leaves a merchant believing `pi_first` is on when it is off — a real cost, and exactly the symptom
that took hours to diagnose during SB3-207.

But the two failure modes are not the same size. A single mistyped value took down *every payment
on the deployment*, while the mistake it was protecting against only ever cost one setting in one
market. A deploy that will not boot also removes the operator's only running service to fix
anything else from.

## Decision

An unusable **field value** is reported and dropped, so that one setting falls back to its flat env
var default while the rest of the rule, the rest of the map, and the deployment all survive.
**Structure** still aborts.

Where the line sits:

| Problem | Behavior | Why |
| --- | --- | --- |
| Invalid value for a known field | Report to the deploy log, drop the field, fall back to its env default | Costs one setting in one market |
| Unknown field name | Report, ignore | Same — the rest of the rule is usable |
| Malformed JSON, non-object map, non-object rule | Abort startup | No per-field fallback exists; the failure mode is losing *every* rule at once, silently changing capture timing in every configured market |

Implemented in `processor/src/config/config.ts` — per-field validation in the rule validator, and
the `STRIPE_PAYMENT_FLOW` fallback. The fallback path logs that it disables bank transfers and
BLIK, which cannot render in the deferred flow, so the operator learns the consequence and not
just the typo.

This is stricter than the reference implementation rather than a retreat to it:
`ct-connect-stripe-checkout` does not validate field values at all — it casts the parsed map — so
`{"MX":{"captureMethod":"Manual"}}` reaches the Stripe API there and fails at the till for every
MX shopper, with an error that looks like a Stripe fault. Here the same typo is named at startup
and MX simply uses `STRIPE_CAPTURE_METHOD`.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Abort on any invalid value (the previous behavior) | One typo bricks every payment on the deployment, and leaves no running service to fix it from. Disproportionate to a one-market, one-setting mistake. |
| Degrade on everything, including malformed JSON | Losing the whole map silently changes capture timing in every configured market — the operator gets no signal proportional to the blast radius. |
| Cast without validating, as the checkout connector does | Moves the failure from startup to the shopper's checkout, disguised as a Stripe error. |

## Consequences

**Positive:** A configuration typo costs one setting in one market instead of the whole
deployment. The operator keeps a running service to correct it from, and the log names both the
bad value and what it disables.

**Negative:** A merchant can run with a setting silently inactive if nobody reads the deploy log.
This is the accepted cost, and the log message is written to be legible when they do.

**Risks:** The `pi_first` fallback specifically is the one that hides a feature rather than a
tweak — a merchant expecting bank transfer sees no bank-transfer tab and no error at the till. The
log line calls that out by name for exactly this reason.
