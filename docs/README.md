# Documentation Index

This directory contains comprehensive documentation for the Stripe-Commercetools payment connector.

## Core Documentation

### [CHANGELOG.md](./CHANGELOG.md)
Complete changelog documenting all updates, improvements, and breaking changes across versions.

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
1. [Main README](../README.md) - Overview and getting started
2. [Processor README](../processor/README.md) - Backend implementation details
3. [Enabler README](../enabler/README.md) - Frontend implementation details

For specific features, refer to the relevant documentation files listed above.
