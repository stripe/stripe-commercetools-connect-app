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

## Consequences

- See checkout ADR-003 for base consequences
- A single CT Payment can accumulate many `CHARGE` transactions over the subscription lifetime
- The connector stores `stripeSubscriptionId` on CT line item custom fields to link CT order lines to Stripe subscription items
- Price sync events (`invoice.upcoming`) read from CT — Stripe is updated to match CT prices, not the reverse
