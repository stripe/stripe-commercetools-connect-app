# ADR-011: Bank transfer scope — one-time payments only, and what stays unconfigurable

**Status:** Accepted
**Date:** 2026-08-06

## Context

SB3-207 added bank transfer (`customer_balance`) to the composable connector. Three scope
questions came up during the build, each with a plausible "support it" answer that would have
grown the surface area:

1. **Subscriptions.** Stripe supports bank transfer for recurring payments and lists
   Subscriptions among the products that can enable it from the Dashboard, so the capability is
   there. But a renewal *debits the customer's Stripe cash balance*, which the shopper must have
   pre-funded — that is what Stripe's footnote means by "requires customer action to ensure there
   are always sufficient funds". Supporting it needs a top-up flow the storefront does not have,
   handling for a renewal that finds an empty balance, and reconciliation of
   `customer_cash_balance_transaction` events against commercetools, which today is log-only
   (KI-041, unreconciled clawbacks).
2. **Refund destination.** A bank-transfer refund can return to the shopper's bank account or to
   their Stripe cash balance. Stripe picks a default; the connector could expose a per-market
   override via `origin`.
3. **A per-market enable flag.** An earlier design paired `euBankTransferCountry` with a
   `bankTransfer` boolean, on the belief that the connector had to opt a market in.

The client (Stripe, PM) ruled on all three. Recording them here because the code enforces them
and, without this file, each one reads as an unfinished gap rather than a closed question.

## Decision

Bank transfer supports **one-time payments only**; refund destination stays at Stripe's default;
and there is **no connector-side enable flag** for the rail.

Concretely:

- **Subscriptions are out of scope by choice, not by limitation.** Stripe supports the
  capability; this connector chooses not to expose it, because positioning a pre-funded cash
  balance as a saved auto-charging payment method is the wrong fit. Enforced by the
  `isFromSubscriptionInvoice` skip in the `payment_intent.requires_action` /
  `partially_funded` branch (`processor/src/routes/stripe-payment.route.ts`) and by the
  `paymentMode` guard in `enabler/src/payment-enabler/payment-enabler-mock.ts`. Both are halves
  of the same decision — do not relax either to "add subscription support".
- **Refund destination is not configurable.** `origin` is not sent; Stripe's default applies.
  Parked as a backlog item, revisited only if a concrete opportunity asks for it. Adding the
  field without that demand would be config nobody sets and nobody tests.
- **No `bankTransfer` flag.** Whether the rail exists at all is a Stripe Dashboard setting for
  the whole account; whether the widget can render it is `flowType: 'pi_first'` (ADR-010). The
  only connector-side conflicts are `captureMethod: 'manual'` and a `setupFutureUsage` mandate,
  both of which exclude `customer_balance` at Stripe's end — and both of which the per-market
  rule can already set. The flag was redundant with fields that already existed.

Related: bank transfer additionally requires a registered-customer flow, because the Payment
Element will not render it without a Stripe Customer object.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Support bank transfer for subscriptions | Needs a balance top-up flow, empty-balance renewal handling, and cash-balance reconciliation that does not exist (KI-041). The pre-funded model is a poor fit for a "saved payment method". |
| Expose refund destination as a per-market rule | No concrete demand. Untested config is a liability, not a feature. |
| Keep the `bankTransfer` per-market boolean | Re-implements an on/off switch Stripe already owns in the Dashboard, and every job it did belonged to a field that already existed (`flowType`, `captureMethod`, `setupFutureUsage`). |

## Consequences

**Positive:** The configuration surface carries only what Stripe's Dashboard cannot decide. The
subscription guard is a documented product boundary rather than an apparent bug. No untested
refund-routing config ships.

**Negative:** A merchant wanting bank-transfer subscriptions has no path, and the answer is a
product conversation rather than a config change. Refund destination cannot be steered per market.

**Risks:** The subscription guard looks like an oversight to anyone reading the code without this
ADR — hence the pointers from both enforcement sites. If the cash-balance reconciliation gap
(KI-041) is ever closed, decision 1 is worth revisiting on its merits.
