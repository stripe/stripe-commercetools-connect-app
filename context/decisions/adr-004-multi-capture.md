# ADR-004 — Multi-Capture as Opt-In Feature

**Status:** Accepted  
**Date:** 2024

## Context

Same as [ct-connect-stripe-checkout ADR-004](../../ct-connect-stripe-checkout/context/decisions/adr-004-multi-capture.md).

In composable, multi-capture applies only to one-time payment items in a mixed cart. Subscription line items are not eligible for manual capture — they follow Stripe's invoice billing cycle.

## Decision

Multi-capture is **opt-in** via `STRIPE_ENABLE_MULTI_OPERATIONS=true`. Same behavior as checkout.

Subscription charges are excluded from multi-capture logic — they are handled by `invoice.*` webhook events regardless of this flag.

## Consequences

- See checkout ADR-004 for base consequences
- Mixed carts with subscription items: only the one-time portion is subject to capture method; subscription portion is always `charge_automatically`
