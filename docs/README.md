# Documentation Index

This directory contains comprehensive documentation for the Stripe-Commercetools payment connector.

> **Where to look first.** `CHANGELOG.md` below is kept current. The **feature guides** in this directory
> are point-in-time write-ups from the release that introduced each feature (2025 – early 2026) and are not
> revised afterwards — they are accurate about the feature they describe and silent about everything added
> since. The living, maintained description of how the connector behaves today is `../context/`:
> `ARCHITECTURE.md` for the system and its webhooks, `feature-scope.md` for what is and is not supported,
> `known-issues.md` for active defects, `business-rules/` for the invariants and `decisions/` for the ADRs.
> Nothing about **bank transfers** or **ACH Direct Debit** is in the feature guides here; see the changelog
> below, `../README.md`, `../processor/README.md`, and `../context/adopter-guide.md`.

## Core Documentation

### [CHANGELOG.md](./CHANGELOG.md)
Complete changelog documenting all updates, improvements, and breaking changes across versions. **Current** —
mirrors the root `CHANGELOG.md`, including ACH Direct Debit (SB3-206) and bank transfers (SB3-207).

### [recent-improvements-summary.md](./recent-improvements-summary.md)
Summary of recent architectural improvements and enhancements to the connector.

### [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)
Overview of the connector's implementation architecture and design decisions.

## Feature Documentation

### [multiple-refunds-multicapture.md](./multiple-refunds-multicapture.md)
**OPT-IN FEATURE**: Comprehensive guide to multiple refunds and multicapture support. Covers:
- **Opt-in configuration**: Disabled by default via `STRIPE_ENABLE_MULTI_OPERATIONS` feature flag
- Multicapture implementation and partial capture handling
- Enhanced refund processing with Stripe API integration
- Webhook event routing and conditional processing
- Configuration prerequisites and requirements
- Testing, troubleshooting, and backward compatibility
- **Prerequisites**: Requires multicapture enabled in Stripe account + manual capture mode

### [subscription-price-synchronization.md](./subscription-price-synchronization.md)
**NEW**: Comprehensive guide to subscription price synchronization and the enhanced `updateSubscription` method. Covers:
- Price synchronization architecture and configuration
- Source of truth principles (Stripe for products, commercetools for prices)
- Enhanced subscription management capabilities
- Best practices and troubleshooting

### [subscription-shipping-fee.md](./subscription-shipping-fee.md)
Documentation for subscription shipping fee support and recurring shipping billing.

### [mixed-cart-support.md](./mixed-cart-support.md)
Guide to handling mixed carts with both subscription and one-time items.

### [attribute-name-standardization.md](./attribute-name-standardization.md)
Information about the `stripeConnector_` prefix system for product type attributes.

### [enabler-improvements.md](./enabler-improvements.md)
Comprehensive guide to frontend enabler improvements and payment service enhancements. Covers:
- **Frontend Configuration Override**: `stripeConfig` option for overriding backend configurations from the frontend
- **Payment Mode Handling**: Improved handling of setup intents and subscription flows
- **POST /payments Endpoint**: New endpoint with dynamic payment method options support
- **Payment Method Options Merging**: Logic for merging backend defaults, `stripeConfig`, and request body options
- **Enhanced Debugging**: Comprehensive logging and error tracking capabilities
- **Shipping Address Integration**: Conditional shipping address handling
- Technical implementation details, configuration, testing, and troubleshooting

## Workflow Diagrams

### [StripeSubscriptionWorkflow.png](./StripeSubscriptionWorkflow.png)
Visual representation of the Stripe subscription workflow.

### [StripeCustomerWorkflow.png](./StripeCustomerWorkflow.png)
Visual representation of the Stripe customer management workflow.

### [Creation of the Payment Component.png](./Creation%20of%20the%20Payment%20Component.png)
Diagram showing the creation of payment components.

### [Submit Payment.png](./Submit%20Payment.png)
Standard payment flow sequence diagram.

### [Submit Payment with Invoice.png](./Submit%20Payment%20with%20Invoice.png)
Payment flow with invoice creation sequence diagram.

### [Submit Payment without Invoice.png](./Submit%20Payment%20without%20Invoice.png)
Payment flow without invoice creation sequence diagram.

## Context7 Libraries

### [context7-libraries/](./context7-libraries/)
Documentation for Context7 library integrations and examples.

## Getting Started

For new users, start with:
1. [Main README](../README.md) - Overview, configuration and the full webhook list
2. [Processor README](../processor/README.md) - Backend implementation details, including the crypto and ACH async rails
3. [Enabler README](../enabler/README.md) - Frontend implementation details
4. [context/index.md](../context/index.md) - Knowledge base index: routes a question to the document that answers it

For specific features, refer to the relevant documentation files listed above — bearing in mind the note at
the top of this page about which of them are point-in-time.

## Asynchronous Payment Rails

Bank transfer, ACH and crypto all settle after the shopper has left. None of them is covered by the
feature guides above — these are the documents that describe them.

### [CHANGELOG.md](./CHANGELOG.md)
What changed and why, for both work streams: ACH Direct Debit (SB3-206) and bank transfers (SB3-207).

### [../README.md → Webhooks](../README.md)
Every registered Stripe event and the commercetools transaction it writes.

### [../processor/README.md → ACH Direct Debit](../processor/README.md)
Pending charges on subscriptions, micro-deposit verification, the underpayment backstop, and late returns.

### [../processor/README.md → Stablecoin / Crypto Payments](../processor/README.md)
Crypto settlement and the `payment_intent.processing` pending state.

### [../context/adopter-guide.md](../context/adopter-guide.md) and [../context/deployment.md](../context/deployment.md)
What a merchant must configure and watch before enabling any of these rails.

### [../context/decisions/](../context/decisions/)
ADR-010 through ADR-016 — the decisions behind the behavior described above.
