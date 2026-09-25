# ct-connect-stripe-composable

commercetools Connect connector integrating Stripe Payment Element with subscriptions, mixed cart support, price synchronization, and express checkout.

## Overview

**Stack:** Node.js/TypeScript + commercetools + Stripe v20
**Type:** Connector - Support
**Version:** 4.0.1

## Structure

```
ct-connect-stripe-composable/
  processor/          # Backend — Stripe API + CT payment + subscription management
  enabler/            # Frontend — Stripe Payment Element wrapper
  docs/               # Architecture diagrams and documentation
  context/
    ARCHITECTURE.md   # System overview: components, flows, boundaries
    business-rules/   # Invariants and documented rules
    workflows/        # Detailed process flows
    decisions/        # Key decisions and their rationale (ADRs)
    reference/        # External API/SDK reference docs
```

## Before Every Task

1. Read `context/ARCHITECTURE.md` — components, flows, and boundaries (subscriptions, mixed carts, price/coupon sync)
2. Read `context/known-issues.md` — known bugs and active restrictions, referenced as `KI-###` throughout this file
3. Read `context/failure-modes.md` — how the connector degrades when Stripe or commercetools misbehaves
4. Read the relevant `context/business-rules/` file for the domain being touched

## Commands

There is no root `package.json` — run these from `processor/` or `enabler/` individually.

```bash
# Install
npm install

# Build
npm run build

# Test (processor's `test` already runs with --collect-coverage; enabler's does not)
npm run test

# Lint
npm run lint

# Local dev (processor)
cd processor && npm run start:dev
```

## Stack

- **Runtime:** Node.js
- **Language:** TypeScript
- **CT SDK:** @commercetools/platform-sdk (transitive via connect-payments-sdk)
- **Stripe SDK:** stripe@^20.1.0
- **CT Connect SDK:** @commercetools/connect-payments-sdk
- **Test framework:** Jest

## Business Rules

| Rule | Context doc | Source |
|---|---|---|
| Payment Intent creation and capture | — | `processor/src/services/stripe-payment.service.ts` |
| Subscription creation and management | `context/business-rules/subscription-lifecycle.md` | `processor/src/services/stripe-subscription.service.ts` |
| Customer session management | `context/workflows/process-customer-session.md` | `processor/src/services/stripe-customer.service.ts` |
| Express Checkout shipping sync | `context/workflows/process-shipping.md` | `processor/src/services/stripe-shipping.service.ts` |
| Coupon and discount sync (CT → Stripe) | `context/business-rules/coupon-sync.md` | `processor/src/services/stripe-coupon.service.ts` |
| CT payment object creation | — | `processor/src/services/ct-payment-creation.service.ts` |
| Mixed cart handling (subscription + one-time) | `context/business-rules/mixed-carts.md` | `processor/src/services/stripe-subscription.service.ts` |
| Subscription price synchronization | `context/business-rules/price-sync.md` | `processor/src/services/stripe-subscription.service.ts` |
| Multicapture and multirefund | `context/business-rules/multi-operations.md` | `processor/src/services/stripe-payment.service.ts` |
| Launchpad purchase order integration | `context/business-rules/launchpad-integration.md` | `processor/src/custom-types/custom-types.ts` |
| Stripe Tax integration | `context/business-rules/tax-integration.md` | `processor/src/constants.ts` |

## Conventions

- Idempotency keys required on all Stripe write operations
- Amounts always in cents (integer)
- Webhook handlers respond 200 immediately, process async
- No card data stored — Payment Method IDs only
- CT payment version tracked for optimistic locking
- Subscription product attributes use `stripeConnector_` prefix
- Price sync source of truth: Stripe for subscription lifecycle, CT for prices
- Mixed carts: one-time items billed on first subscription invoice

## Decisions

- Stripe Payment Element for PCI compliance reduction
- Server-side Payment Intent confirmation for 3DS support
- CT payment object as source of truth for transaction state
- Multi-capture opt-in via `STRIPE_ENABLE_MULTI_OPERATIONS=true`
- Subscription price sync opt-in via `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true`
- Express Checkout address changes trigger CT shipping rate recalculation

## Coding Rules

- Idempotency keys for price/subscription creation must derive from stable CT identifiers (CT price ID + variant SKU) — never `Date.now()` or another timestamp (KI-013)
- Cart freeze/unfreeze failures on subscription creation must abort the operation, not continue silently — a failed freeze leaves the cart editable mid-subscription (KI-008)
- CT product type updates must use update-in-place (add missing fields, remove stale) — never delete-then-create, a failed create after delete permanently removes the type (KI-012)
- A cart may contain at most one subscription line item — reject additional ones at subscription creation, do not process them silently (KI-018, `business-rules/mixed-carts.md` Rule 4)
- Any reuse of an existing Stripe Price (line item or shipping) must verify the amount still matches the current CT price, not just that the price is `active` (KI-021)
- A CT discount code is translated to a Stripe coupon only when its `DiscountCodeInfo.state` is `MatchesCart` — commercetools is the authority on whether a code applies, and the connector never re-derives that from the code's own configuration (KI-055, `business-rules/coupon-sync.md` Rule 3)

## What Claude Must Never Do

- Catch a Stripe or CT error inside `processSubscriptionEventPaid/Charged/Failed` (or any webhook handler) and return HTTP 200 anyway (KI-002, KI-003)
- Register a new subscription webhook event without keeping `enabled_events` (`actions.ts`) and the route dispatcher case in sync — the two must always match. `charge.updated` is a live example of the mismatch (route handler exists, but it is **not** registered in `actions.ts`), a bug to fix, not a pattern to copy. (`customer.subscription.deleted` was the same kind of gap and is now **fixed** — registered + handled; see KI-009 RESOLVED / the KI-010 residual.)
- Resolve "the" refund from a list call (`refunds.list(limit: 2)[0]`) without correlating to the actual webhook event's own refund object — near-simultaneous refunds can misattribute amount/ID (KI-023)
- Add a new payment method to `createComponentBuilder` without fixing the hardcoded empty `supportedMethods` map first (KI-025)
- Delete and recreate a Stripe coupon because Stripe reports it unusable — the coupon id **is** the CT discount code id, and Stripe hands a recreated id a fresh redemption counter. Only configuration divergence from commercetools may trigger a re-sync (KI-055, `business-rules/coupon-sync.md` Rule 4)
- Write `max_redemptions` onto a Stripe coupon — the usage cap is enforced by commercetools, and mirroring it is what made Stripe mark coupons invalid on exhaustion in the first place (KI-055, ADR-018)
- Call `cancelSubscription()` and assume CT is updated afterward — today it only cancels in Stripe; CT stays frozen with a stale subscription ID until this is fixed (KI-010)

## Skills

See @../.claude/SKILLS-REFERENCE.md

## Context

- **Architecture:** `context/ARCHITECTURE.md`
- **Business rules:** `context/business-rules/`
- **Workflows:** `context/workflows/`
- **Decisions:** `context/decisions/`
- **Known issues:** `context/known-issues.md`
- **Failure modes:** `context/failure-modes.md`
