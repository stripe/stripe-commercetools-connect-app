# ADR-003 — CT Payment Object as Source of Truth for Transaction State

**Status:** Accepted  
**Date:** 2024

## Context

Same as [ct-connect-stripe-checkout ADR-003](../../ct-connect-stripe-checkout/context/decisions/adr-003-ct-source-of-truth.md).

Composable adds complexity: recurring subscription invoices generate new Stripe charges that must also be reflected in CT. Each invoice payment creates a new CT Transaction on the same CT Payment object.

## Decision

CT Payment object is the source of truth for all transaction state — including recurring subscription invoice payments.

Stripe webhook events for subscriptions update CT:
- `invoice.paid` → adds `CHARGE` transaction
- `invoice.payment_failed` → adds `AUTHORIZATION` (Failure) transaction
- `customer.subscription.deleted` → **not yet implemented** (TODO); event is declared in `StripeSubscriptionEvent` enum (`services/types/stripe-payment.type.ts:49`) but is **not registered** in `actions.ts` enabled events and has no route handler — Stripe will not send this event to the connector

> **Update (2026-08-25):** the `customer.subscription.deleted` line above no longer describes the code. The
> event is registered and handled — `processSubscriptionEventDeleted` unfreezes the subscription's cart on
> terminal cancellation, without touching payment or order state (KI-009 resolved). The decision itself is
> unchanged; only that TODO went stale. Two later ADRs extend this one for asynchronous rails:
> ADR-013 (an unsettled ACH payment is `CHARGE/Pending`, not `Success`) and ADR-014 (a post-settlement ACH
> reversal is flagged on the CT payment, never auto-reconciled — which is this ADR's principle applied to a
> reversal: commercetools stays the source of truth for order state, so the connector does not rewrite it
> from a PSP event).

## Consequences

- See checkout ADR-003 for base consequences
- A single CT Payment can accumulate many `CHARGE` transactions over the subscription lifetime
- The connector stores `stripeSubscriptionId` on CT line item custom fields to link CT order lines to Stripe subscription items
- Price sync events (`invoice.upcoming`) read from CT — Stripe is updated to match CT prices, not the reverse
