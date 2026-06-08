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
  workspace/
    journal/          # Session logs (auto-generated)
    research/         # Research documents
    tasks/            # Task plans, prd.json, progress
    changes/          # Change traceability
```

## Commands

```bash
# Install
npm install

# Build
npm run build

# Test
npm run test
npm run test:coverage

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

## Skills

See @../.claude/SKILLS-REFERENCE.md

## Context

- **Architecture:** `context/ARCHITECTURE.md`
- **Business rules:** `context/business-rules/`
- **Workflows:** `context/workflows/`
- **Decisions:** `context/decisions/`
- **Workspace:** `workspace/` (journal, research, tasks, changes)
