# Stripe Payment for Composable Commerce

This repository provides a commercetools [connect](https://docs.commercetools.com/connect) integration for [Stripe payment](https://docs.stripe.com/payments/payment-element), enabling a drop-in experience through the Stripe Payment Element and supporting webhook handling, payment intents, and checkout configuration.

## Features
- Uses [commercetools SDK](https://docs.commercetools.com/sdk/js-sdk-getting-started) for the commercetools-specific communication.
- It uses [connect payment SDK](https://github.com/commercetools/connect-payments-sdk) to manage request context, sessions, and JWT authentication.
- Use [commercetools payment api](https://docs.commercetools.com/checkout/payment-intents-api) to manage payment transactions.
- Includes local development utilities in npm commands to build, start, test, lint & prettify code.
- Support for the [Stripe Payment Element](https://stripe.com/docs/payments/payment-element), including:
  - Customizable layout options
  - Appearance API for theming and branding
  - Manual or automatic payment capture modes
  - Enables saving and reusing customer payment methods directly within the Payment Element component for a seamless checkout experience. [See details](./processor/README.md#considerations-for-stripe-customer-session)
  - Flexible billing address collection
- Supports collecting payment details before creating a payment intent, enabling flexible checkout flows. The backend processor utilizes the [Stripe API](https://stripe.com/docs/api) to efficiently create and manage payment intents and subscriptions, handle webhooks, and process payments. [See Details](README.md#sequence-diagrams-for-the-payment-connector)
- Comprehensive Stripe customer session management: automatically creates or retrieves Stripe customers, synchronizes the logged-in commercetools customer with their corresponding Stripe account, and stores the Stripe customer ID in commercetools for seamless future transactions. [See Considerations](./processor/README.md#considerations-for-stripe-customer-session)
- Sync shipping information from commercetools to Stripe payment intent.
- Support for Buy Now Pay Later (BNPL) payment method.[Considerations](./processor/README.md#merchant-return-url)
- Support for a wide range of payment methods, including Apple Pay, Google Pay, Amazon Pay, and others. [See Considerations](./enabler/README.md#considerations-for-apple-pay-and-google-pay)
- Merchants can leverage the custom product type provided by the connector to create and manage subscriptions directly within commercetools. These subscriptions are automatically synchronized with Stripe for creation and updates. [Learn more](./processor/README.md#considerations-for-stripe-billing-subscription-management).
- **Subscription Management API**: The connector provides comprehensive subscription management capabilities through dedicated API endpoints. You can create, manage, and monitor Stripe subscriptions directly through the commercetools connector. [View Subscription API Documentation](./processor/README.md#stripe-subscription-management-api).
- **Subscription Price Synchronization**: The connector automatically synchronizes subscription prices with commercetools product prices, ensuring customers always pay the current price. This feature can be enabled via the `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED` environment variable. [Learn more](./docs/subscription-price-synchronization.md).
- **Subscription Shipping Fee Support**: The connector now supports recurring shipping fees as part of subscription billing, automatically creating and managing Stripe shipping prices that align with subscription billing intervals. [Learn more](./processor/README.md#subscription-shipping-fee-support).
- **Mixed Cart Support**: Enhanced subscription handling for carts containing both subscription items and one-time items. The system automatically adds one-time items to the first invoice of the subscription. [Learn more](./docs/mixed-cart-support.md).
- **Attribute Name Standardization**: All subscription-related product type attributes now use the `stripeConnector_` prefix for better organization and consistency. The system automatically handles the transformation between prefixed attribute names and internal field names. [Learn more](./docs/attribute-name-standardization.md).
- **Enhanced Subscription Management**: Comprehensive subscription update capabilities including product variant switching, price updates, and configuration changes. The new `updateSubscription` method provides seamless subscription management while maintaining data consistency. [Learn more](./docs/subscription-price-synchronization.md).
- **Enhanced Payment Intent Error Handling**: Improved error management for payment intent statuses including `requires_action` and `payment_failed` with structured error objects for better debugging.
- **Multiple Refunds and Multicapture Support (Opt-in)**: Advanced payment processing capabilities including multiple partial captures and accurate refund tracking using Stripe API integration. This feature is **disabled by default** and must be explicitly enabled via `STRIPE_ENABLE_MULTI_OPERATIONS=true`. Requires multicapture enabled in your Stripe account and manual capture mode. [Learn more](./docs/multiple-refunds-multicapture.md).
- **Frontend Configuration Override**: The Enabler supports `stripeConfig` option that allows frontend to override backend configuration for Stripe Elements (appearance, layout, billing address) and PaymentIntent (payment method options). This enables per-implementation customization without backend changes. [See Details](./README.md#creating-components-for-payment-elements-or-express-checkout)
- Provides a subscription management API via the commercetools connector, enabling Stripe subscription operations directly through commercetools API endpoints.
- Customers can update their shipping and billing addresses directly within the Stripe Express Checkout. When an address is changed, the connector automatically fetches the latest shipping rates from commercetools and updates the cart to reflect the new information. [See Details](README.md#sequence-diagrams-for-the-payment-connector)
- **Stripe Tax support in Express Checkout**: When Stripe Tax is active (`cart.taxedPrice` is present), the Express Checkout order summary displays a net subtotal, a tax line, and the shipping line — preventing duplicate tax display. The shipping line also shows the actual shipping method name instead of a generic label.

## Price Synchronization Architecture

The connector implements a sophisticated price synchronization system that maintains consistency between Stripe subscriptions and commercetools product prices. This system operates on the principle of **Stripe as the source of truth for products** and **commercetools as the source of truth for prices**.

### How Price Synchronization Works

#### Source of Truth Principles
- **Stripe**: Manages subscription lifecycle, billing cycles, and customer relationships
- **Commercetools**: Controls product pricing, variants, and business logic
- **Synchronization**: Automatically aligns Stripe subscription prices with commercetools product prices

#### Price Synchronization Modes

**Automatic Mode** (`STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true`):
- Prices are synchronized **before** each invoice creation via `invoice.upcoming` webhook
- Price changes take effect for the **current billing period**
- Real-time price updates without waiting for the next billing cycle

**Standard Mode** (`STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=false`):
- Prices are updated **after** payment via the `createOrder` method
- Price changes take effect for the **next billing cycle**
- Traditional subscription billing behavior

#### Benefits of Price Synchronization
- **Customer Satisfaction**: Customers always pay current, accurate prices
- **Business Agility**: Price changes take effect immediately when needed
- **Data Consistency**: Eliminates price discrepancies between systems
- **Automated Management**: No manual intervention required for price updates

For detailed configuration and implementation details, see [Subscription Price Synchronization](./processor/README.md#subscription-price-synchronization).

## Prerequisite

#### 1. commercetools composable commerce API client

Create an API client responsible for payment management in a composable commerce project. The API client details are input as environment variables/ configuration for connect, such as `CTP_PROJECT_KEY`, `CTP_CLIENT_ID`, and `CTP_CLIENT_SECRET`. Please read [Deployment Configuration](./README.md#deployment-configuration) for details.
In addition, please make sure the API client has enough scope to manage Payment. For details, please refer to [Running Application](./processor/README.md#running-application)

#### 2. Various URLs from commercetools composable commerce

Configure various URLs from the commercetools platform, so that the connect application can handle the session and authentication process for endpoints.
Their values are input for environment variables/configurations for connecting, with variable names `CTP_API_URL`, `CTP_AUTH_URL`, `CTP_SESSION_URL`, and `CTP_CHECKOUT_URL`.

#### 3. Stripe account and keys

Configure Stripe secret and public keys so the Connect application can handle endpoint session and authentication processes. Their values are taken as input as environment variables/ configuration for Connect, with variable names `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SIGNING_SECRET`.
If you want to create a Restricted key to add in the `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`, the minimum permissions needed are:
- Refunds: Write
- PaymentIntents: Write
- Customer: Write
- CustomerSession: Write
- Webhook Endpoints: Write
- Subscriptions: Write

## Getting started with the Payment Connector

The `connect-payment-integration-stripe` contains two modules:

- **Enabler**: This is a wrapper implementation where Stripe frontend [Payment Element](https://docs.stripe.com/payments/payment-element) components are embedded. It gives the merchant the control over when and how to load the connector frontend based on business configuration.
- **Processor**: This functions as a backend service and middleware for integration with the Stripe platform. It interacts with Stripe for transactions and updates the payment entity within Composable Commerce. Finding the Stripe customer that owns the commercetools cart, or creating the customer and adding the information to the custom field of the cart. Additionally, it supports a listener for triggers related to Stripe webhook events to update the payment entity with `connect-payment-sdk` based on webhook events.

Regarding the development of a processor or enabler module, please refer to the following documentation:

- [Development of Processor](./processor/README.md)
- [Development of Enabler](./enabler/README.md)

![overview.png](docs%2Foverview.png)
### Components

1. **Composable Commerce**
   Represents the website platform infrastructure provided by client.
2. **Stripe Composable Connector**
   - A [Payment connector integration](https://docs.commercetools.com/checkout/payment-connectors-applications) within the infrastructure of commercetools that facilitates communication between commercetools and Stripe.
3. **Processor**
   - Manages payment transactions and interacts with Stripe to:
      - Create payment intents.
      - Handle manual API payment transactions.
      - Listening to webhooks events triggered by Stripe and processing all related payment operations.
      - Create Stripe customer session
4. **Enabler**
   - Assists in the creation of the [Stripe Payment Element](https://docs.stripe.com/payments/payment-element) and [Express Checkout](https://docs.stripe.com/elements/express-checkout-element) components used as a payment method by client.
   - Connects to any sample site that wants to integrate the connector, providing the available payment components for seamless integration.
5. **Stripe**
   - The external payment service provider that handles various payment operations, sends webhooks for events such as authorization, capture, refund, and cancel.

### Sequence Diagrams for the Payment Connector

The Enabler component is tasked with rendering the Stripe Payment Element or Express Checkout, providing a seamless payment experience for users. The diagram below illustrates the workflow for initializing these payment components:

![Creation of the payment component](<docs/Creation of the Payment Component.png>)

Once the payment component is set up, the connector orchestrates various payment flows based on the user's context—such as logged-in customers, guest checkouts, and subscriptions (with or without a SetupIntent). The following sequence diagrams break down these scenarios:

- **Standard Payment Flow:**
  ![Payment](<docs/Submit Payment.png>)

- **Subscription with Invoice:**
  ![Subscription with invoices](<docs/Submit Payment with Invoice.png>)

- **Subscription without Invoice:**
  ![Subscription without invoices](<docs/Submit Payment without Invoice.png>)

Each diagram details the interactions and steps involved in processing the respective payment type.

## Recent Updates and Improvements

### Subscription Webhook Payment De-duplication and First-Cycle Order Fixes (Latest)

Subscription payment and order handling was corrected so that each recurring cycle produces exactly one commercetools payment/order, and the first cycle creates its order reliably.

- **`invoice.paid` is the single source of truth for subscription payments.** Stripe also emits `charge.succeeded` / `payment_intent.succeeded` for the same subscription invoice, but the webhook route now ignores those via `isFromSubscriptionInvoice()` to prevent duplicate CT payments/orders. `processSubscriptionEventCharged` is deprecated and no longer wired.
- **Transactions are keyed by the Stripe invoice id (`in_…`)** rather than the PaymentIntent id, and recurring mixed-cart order composition was fixed.
- **First-cycle order is created from the frozen cart** instead of cloning a non-existent order, and **first-cycle payment failure** is handled correctly (no spurious paid order).
- **Product sale prices are honored**: subscription line items charge `price.discounted ?? price.value`, not the list price. (Cart-level coupon `duration` mapping remains a known gap — see `context/known-issues.md` KI-016.)
- **Security**: processor and enabler dependency vulnerabilities resolved via `npm audit fix`.

See `docs/CHANGELOG.md` and `context/business-rules/recurring-billing.md` (Rule 4) for details.

### Multiple Refunds and Multicapture Implementation - OPT-IN FEATURE

The payment processing system has been significantly enhanced with advanced multicapture and refund capabilities. **These features are opt-in and disabled by default** to ensure backward compatibility.

#### ⚙️ Configuration Required
- **Environment Variable**: `STRIPE_ENABLE_MULTI_OPERATIONS=true` (default: `false`)
- **Prerequisites**:
  - Multicapture must be enabled in your Stripe account
  - Set `STRIPE_CAPTURE_METHOD=manual`
  - Webhook endpoint must include `charge.updated` and `charge.refunded` events. `charge.refunded` is registered by post-deploy; **`charge.updated` is not** — add it to the endpoint by hand in the Stripe Dashboard, or multicapture events never arrive
- **Default Behavior**: When disabled, webhook events are gracefully skipped with logging
- **Backward Compatible**: Existing merchants experience no disruption

#### 🚀 New Features (When Enabled)
- **Multicapture Support**: Enhanced payment capture functionality to support multiple partial captures on the same payment intent
- **Advanced Refund Processing**: New refund handling that fetches accurate refund details directly from Stripe API
- **Incremental Capture Tracking**: Sophisticated tracking of incremental captured amounts using Stripe's previous attributes
- **Conditional Webhook Routing**: Dedicated event handlers for `charge.updated` and `charge.refunded` events that only process when feature is enabled
- **Balance Transaction Tracking**: Improved PSP reference tracking using Stripe balance transaction IDs

#### 🔧 Technical Improvements
- **API-Based Refund Details**: Refund processing now fetches actual refund amounts and IDs from Stripe API for precise transaction records
- **Partial Capture Detection**: Automatic detection of partial captures with proper `final_capture` handling
- **Simplified Payment Updates**: Removed manual commercetools payment updates in favor of webhook-based processing
- **Enhanced Error Handling**: Comprehensive validation and error management for multicapture scenarios
- **Improved Event Converter**: Added support for `CHARGE__UPDATED` events and enhanced refund processing

#### 🧪 Testing Infrastructure Enhancements
- **Comprehensive Test Coverage**: Updated test suites to cover all new multicapture and refund functionality
- **Enhanced Webhook Testing**: Improved webhook routing tests for new event types
- **Converter Testing**: Added tests for new event converter functionality
- **Edge Case Coverage**: Enhanced testing for various multicapture and refund scenarios

#### 📚 Documentation and Architecture Updates
- **Enhanced Webhook Documentation**: Updated webhook event descriptions to reflect new capabilities
- **Improved Transaction Tracking**: Better PSP reference tracking for audit and debugging purposes
- **Comprehensive Logging**: Enhanced logging throughout the payment processing pipeline
- **Better Error Management**: Structured error handling with detailed transaction information

### Enhanced Subscription Service Architecture and Testing Infrastructure

The subscription service has undergone major architectural improvements with comprehensive testing enhancements:

#### 🚀 New Features
- **New Price Client Service**: Added dedicated `price-client.ts` service for enhanced product price management and retrieval
- **Modular Test Architecture**: Restructured subscription service tests into focused, maintainable modules:
  - Business logic and payment handling tests
  - Core subscription functionality tests  
  - Subscription lifecycle management tests
  - Payment processing and confirmation tests
  - Price management and calculation tests
  - Utility functions and helper method tests
- **Enhanced Configuration Management**: Added comprehensive configuration testing and validation
- **Advanced Payment Intent Handling**: Enhanced error handling for payment intents with additional status checks
- **Improved Subscription Metadata Management**: Enhanced metadata tracking with comprehensive field mapping

#### 🔧 Technical Improvements
- **Subscription Service Refactoring**: Major architectural improvements with better separation of concerns
- **Enhanced Test Coverage**: Achieved comprehensive test coverage across all subscription service methods and edge cases
- **Improved Mock Data Management**: Enhanced mock data structures for better test reliability and coverage
- **Better Error Handling**: Comprehensive error management throughout the subscription service with detailed logging
- **Payment Processing Enhancements**: Improved payment intent configuration with conditional shipping and advanced payment method options
- **New Price Management Methods**: 
  - `getProductById()`: Retrieves products with expanded price information
  - `getProductMasterPrice()`: Gets current price from product master variant

#### 🧪 Testing Infrastructure Enhancements
- **Modular Test Structure**: Tests organized by functionality for better maintainability and faster execution
- **Comprehensive Coverage**: All subscription service methods now have dedicated test coverage
- **Enhanced Mock Data**: Improved mock data for realistic testing scenarios
- **Better Test Organization**: Clear separation between unit tests and integration tests
- **Configuration Testing**: Added dedicated tests for configuration validation

#### 📚 Documentation and Architecture Updates
- **Enhanced Code Organization**: Better separation of concerns in subscription service architecture
- **Improved Type Safety**: Updated method signatures and type definitions for better development experience
- **Better Logging**: Enhanced logging throughout the service for improved debugging capabilities
- **Optimized Performance**: More efficient product price management and test execution

### Previous Enhancements

#### Subscription Service Core Features
- **Recurring Shipping Fee Support**: Added comprehensive support for recurring shipping fees in subscriptions
- **Automatic Shipping Price Management**: Automatic creation and management of Stripe shipping prices
- **Enhanced Metadata Tracking**: Improved metadata handling for shipping methods and prices
- **Shipping Price Integration**: New methods for managing shipping prices within subscriptions:
  - `getSubscriptionShippingPriceId()`: Retrieves or creates shipping price IDs
  - `getStripeShippingPriceByMetadata()`: Searches for existing shipping prices
  - `createStripeShippingPrice()`: Creates new Stripe shipping prices
- **Enhanced Type Definitions**: Added new TypeScript interfaces for shipping price management
- **Enabler Enhancements**: Improved payment mode handling and comprehensive debugging

For detailed information about these improvements, see the [Processor Documentation](./processor/README.md#subscription-shipping-fee-support).

For technical implementation details, see the [Subscription Shipping Fee Integration Guide](./docs/subscription-shipping-fee.md).

For enabler and payment service improvements, see the [Enabler Improvements Guide](./docs/enabler-improvements.md).

# Webhooks

The following webhooks are registered by the post-deploy script (`processor/src/connectors/actions.ts`,
`enabled_events`) and routed in `processor/src/routes/stripe-payment.route.ts`. This list must stay in
sync with `enabled_events` — a handler that exists without its event registered never fires.

**One-time payments**

- **payment_intent.succeeded**: Creates a payment transaction Charge: Success, and creates the commercetools order. Order creation is refused unless the PaymentIntent's `amount` matches the cart's *current* total, `amount_received` equals `amount`, and the currency matches — the backstop against a cart edited while an async payment settled (see ACH below). On a mismatch it logs an error and returns; the Charge: Success already written leaves a paid-without-order state for manual reconciliation. An already-`Ordered` cart is skipped idempotently.
- **payment_intent.canceled**: Modified the payment transaction Authorization to Failure and create a payment transaction CancelAuthorization: Success
- **payment_intent.payment_failed**: Modify the payment transaction Authorization to Failure. **Note (subscriptions):** on a subscription-invoice PaymentIntent that had *already* settled this is an ACH late return and is routed instead to `processSubscriptionEventLateReturn` — see below.
- **payment_intent.requires_action**: Behavior depends on the rail. Both a **bank transfer** (`next_action.type = display_bank_transfer_instructions`) and an **ACH micro-deposit** (`next_action.type = verify_with_microdeposits`) pass the gate, run `processStripeEvent`, and write **one Authorization: Pending for the full PaymentIntent amount** — the converter (`stripeEventConverter.ts`, case `PAYMENT_INTENT__REQUIRED_ACTION`) does not branch by `next_action.type`. The only difference between the two rails is the freeze predicate (`isBankTransferNextAction` vs `isMicrodepositNextAction`); both freeze the cart. For a bank transfer the order is created only when funds arrive; the micro-deposit freeze holds the cart during the multi-day verification window. Everything else — card 3DS, Boleto — keeps the log-only path (no transaction). A subscription-invoice event logs and stops.
- **payment_intent.processing**: Asynchronous settlement (crypto/stablecoin). Writes an Authorization: Pending while the payment settles, resolving to Success on `payment_intent.succeeded` and Failure on `payment_intent.payment_failed` / `payment_intent.canceled`. Guarded against out-of-order and duplicate events.
- **payment_intent.partially_funded**: The shopper wired part of a bank transfer amount. Deliberately writes **no** commercetools transaction — only the interface interaction — so the single Authorization: Pending for the full amount stays the truth.
- **charge.succeeded**: Create the payment transaction to 'Authorization:Success' if charge is not captured, and update the payment method type that was used to pay. **Note (subscriptions):** when the charge belongs to a subscription invoice it is ignored (`isFromSubscriptionInvoice`, keyed on the connector's own `subscription_id` metadata); recurring subscription payments are recorded solely from `invoice.paid` to avoid duplicate commercetools payments/orders.
- **charge.captured**: Logs the information in the connector app inside the Processor logs.
- **charge.updated**: **The route handler exists but the event is NOT in `enabled_events`**, so Stripe never delivers it and the handler does not currently run. When wired, it handles multicapture scenarios by creating Charge: Success transactions with incremental captured amounts, and only when `STRIPE_ENABLE_MULTI_OPERATIONS=true`. Registering it is an open item — see `context/known-issues.md`.

**Refunds**

- **charge.refunded**: Creates payment transactions Refund: Success and Chargeback: Success with accurate refund amounts fetched from Stripe API. **Note**: Only processed when `STRIPE_ENABLE_MULTI_OPERATIONS=true`; gracefully skipped when disabled.
- **refund.updated** / **refund.failed**: `charge.refunded` fires when the Refund object is *created*, which on a delayed rail is not the same as succeeded — a bank-transfer refund is created `pending`. These two events write a correcting Refund: Failure when Stripe later rejects the refund, which previously stayed recorded as successful forever.

**Bank transfer cash balance**

- **customer_cash_balance_transaction.created**: Observability only — never writes to commercetools. Logs a field-by-field payload, at `error` level for `funding_reversed` and `adjusted_for_overdraft` and at `info` otherwise. The raw event is never logged: it carries `sender_name`, `iban_last4`, `account_number_last4` and `sort_code`. This is the **only** signal for a bank-transfer clawback; wire it to an alerting channel.

**Subscriptions**

- **invoice.paid**: Single source of truth for subscription-cycle payments. If payment charge is pending, we update the payment transaction to Charge:Success. If charge is not pending, we update the payment transaction to Authorization:Success and create a payment transaction Charge:Success. Transactions are keyed by the Stripe invoice id (`in_…`). This is also what settles an ACH Charge: Pending written at confirm.
- **invoice.payment_failed**: If payment charge is pending, we update the payment transaction to Charge:Failure. If charge is not pending, we update the payment transaction to Authorization:Failure and create a payment transaction Charge:Failure.
- **invoice.upcoming**: Handles upcoming invoice events for subscription payments, supporting the new subscription payment handling strategy.
- **customer.subscription.deleted**: Terminal cancellation — unfreezes the subscription's cart, resolved from the subscription's `ct_payment_id` metadata. Idempotent, skips a cart that is not frozen, and changes no payment or order state (retrying with another method happens in Stripe). The cart stays frozen through the Smart Retry window; only this event releases it.

> On `invoice.paid` and `invoice.payment_failed`, a commercetools write that fails with a **transient**
> error (`ConcurrentModification`/409, 429, 502, 503, `ETIMEDOUT`, `ECONNRESET`) is rethrown so the webhook
> responds non-2xx and Stripe redelivers. Permanent errors are logged and swallowed, so a bad credential
> does not turn into a days-long retry storm.

## ACH Direct Debit (`us_bank_account`)

ACH is enabled from the **Stripe Dashboard**; there is no connector configuration for it. It is
**asynchronous** — the debit settles in ~2–4 business days and can still fail afterwards — which is what
drives the webhook behavior above.

- **On subscriptions**, `POST /subscription/confirm` reads the real PaymentIntent status rather than
  assuming a card: `succeeded`/`requires_capture` writes Charge: Success, and `processing` writes
  **Charge: Pending**, which `invoice.paid` later promotes to Success and `invoice.payment_failed` turns
  into Failure. A subscription can therefore sit in Charge: Pending for days with no order yet —
  consumers of the commercetools payment must handle that state. Micro-deposit verification
  (`requires_action`) is **not supported on subscriptions**: the confirm throws.
- **On one-time payments**, micro-deposit verification is supported. The cart is frozen when Stripe
  returns `requires_action`, and order creation is gated on the amount actually collected.
- **Late returns.** A settled ACH debit can be reversed by the shopper's bank for up to ~60 days. Stripe
  signals this with `payment_intent.payment_failed` but does **not** re-fire `invoice.payment_failed`, so
  the connector flags the commercetools payment with the native `paymentStatus.interfaceCode =
  'ach_late_return'` and leaves the financial correction to the Stripe Dashboard — no transaction, order
  or custom-field change. The flag is best-effort and never throws, so **it is the only in-connector
  signal that money was clawed back; wire it to an alerting channel.**


## Prerequisite


#### 1. Stripe account credentials and configurations

Before installing the connector, you must create a Stripe account and obtain the necessary credentials. The Stripe account is required to process payments and manage transactions. Sign up for a Stripe account at [Stripe](https://stripe.com/). Once you have an account, you must set up the following configurations in your environment variables or configuration files. Before installing the connector, a webhook endpoint in Stripe must be created (using a dummy URL). Retrieve the ID and Signing Secret from the Stripe Console. The Webhook Endpoint is update during the post-deploy script after the deployed connector. It's important to set the correct values in the variables so the events are sent to the connector and can be accepted. The following Stripe account credentials and configurations are required:

1. **STRIPE_SECRET_KEY**: Provided by Stripe. Secret and stored securely in your web or mobile app's server-side code (such as in an environment variable or credential management system) to call Stripe APIs.
2. **STRIPE_CAPTURE_METHOD**: Configuration that enables the capture method selected by the user. The capture method controls when Stripe will capture the funds from the customer's account. Possible enum values:
   - `automatic`: Stripe automatically captures funds when the customer authorizes the Payment.
   - `automatic_async`: (Default) Stripe asynchronously captures funds when the customer authorizes the Payment. Recommended over `capture_method=automatic` due to improved latency. Read the [integration guide](https://docs.stripe.com/elements/appearance-api) for more information.
   - `manual`: Places a hold on the funds when the customer authorizes the Payment but doesn't capture the funds until later. (Not all payment methods support this.) **Required for multicapture support** - must be set to `manual` when `STRIPE_ENABLE_MULTI_OPERATIONS=true`.
3. **STRIPE_APPEARANCE_PAYMENT_ELEMENT**: This configuration enables the theming for the payment element component. The value needs to be a valid stringified JSON. More information about the properties can be found [here](https://docs.stripe.com/elements/appearance-api).
```
//stringified, eg.
{"theme":"night","labels":"floating"}
```
4. **STRIPE_APPEARANCE_EXPRESS_CHECKOUT**: This configuration enables the theming for the express checkout component. The value needs to be a valid stringified JSON. More information about the properties can be found [here](https://docs.stripe.com/elements/appearance-api).
```
//stringified, eg.
{"theme":"night","labels":"floating"}
```
5. **STRIPE_WEBHOOK_ID**: Unique identifier of a Webhook Endpoint in Stripe.
6. **STRIPE_WEBHOOK_SIGNING_SECRET**: Signing secret of a Webhook Endpoint in Stripe.
7. **STRIPE_LAYOUT**: This configuration enables the Layout for the payment component. The value needs to be a valid stringified JSON. More information about the properties can be found [here](https://docs.stripe.com/payments/payment-element#layout).
```
//stringified eg.
{"type":"accordion","defaultCollapsed":false,"radios":true, "spacedAccordionItems":false}
```
8. **STRIPE_SAVED_PAYMENT_METHODS_CONFIG**: The configuration for the saved payment methods. The value needs to be a valid stringified JSON. More information about the properties can be found [here](https://docs.stripe.com/api/customer_sessions/object#customer_session_object-components-payment_element-features). This feature is disabled by default. To enable it, you need to add the expected customer session object.
```
//stringified, eg.
{"payment_method_save_usage":"off_session","payment_method_redisplay_limit":10}
```
9. **STRIPE_PUBLISHABLE_KEY**: Provided by Stripe. The key is to create the Payment Element component on the front end.
10. **STRIPE_APPLE_PAY_WELL_KNOWN**: This is the domain association file from Stripe. Use to verify the domain for Apple Pay. More information can be found [here](https://stripe.com/docs/apple-pay/web).
11. **MERCHANT_RETURN_URL**: This is the return URL used on the confirmPayment return_url parameter. The Buy Now Pay Later payment methods will send the Stripe payment_intent in the URL; the Merchant will need to retrieve the payment intent and look for the metadata ct_payment_id is added in the commercetools Checkout SDK paymentReference.
12. **STRIPE_COLLECT_BILLING_ADDRESS**: This is the configuration for the Stripe collect shipping address in the payment element. The default value is `auto`. More information can be found [here](https://docs.stripe.com/payments/payment-element/control-billing-details-collection).
13. **CTP_PROJECT_KEY**: The key to the commercetools project
14. **CTP_AUTH_URL**: Authentication URL for commercetools
15. **CTP_API_URL**: API URL for commercetools
16. **CTP_SESSION_URL**: Session API URL for commercetools
17. **CTP_CHECKOUT_URL**: Checkout API URL for commercetools (required for checkout operations)
18. **CTP_JWKS_URL**: JWKs URL for JWT validation
19. **CTP_JWT_ISSUER**: JWT issuer for validation
20. **CTP_CLIENT_SECRET**: Client secret for commercetools (in secured configuration)
21. **CTP_CLIENT_ID**: Client ID for commercetools with specific required scopes (in secured configuration)
22. **STRIPE_API_VERSION**: Optional Stripe API version to use (default: `2025-12-15.clover`). Allows merchants to pin to specific Stripe API versions.

These commercetools-specific variables are essential for the connector to properly authenticate and communicate with the commercetools platform.

#### 2. commercetools

We must create the connector on the commercetools connect marketplace, enable the checkout feature in the merchant center, and select the payment connector as the drop-in payment method on the checkout configuration page. Users create an API client responsible for payment management in a composable commerce project. The API client's details are input as environment variables/ configuration for connecting, such as `CTP_PROJECT_KEY,` `CTP_CLIENT_ID,` and `CTP_CLIENT_SECRET`.

1. **API client**: Various URLs from the commercetools platform must be configured so that the connect application can handle the session and authentication process for endpoints. Their values are taken as input as environment variables/ configuration for connect, with variable names `CTP_API_URL`, `CTP_AUTH_URL`, `CTP_SESSION_URL`, and `CTP_CHECKOUT_URL`.
2. **payment connector**: Install the payment connector from the commercetools connector marketplace.

Note: To use the Stripe Composable Connector installed, you must call the enabler module from the installed connector URL. To find more information about how to use the enabler module, please refer to the [Enabler documentation](./enabler/README.md#creating-components-for-payment-elements-or-express-checkout).

## Creating Components for Payment Elements or Express Checkout

This section explains how to integrate the Stripe Composable connector with commercetools. First, load the Stripe Enabler using the URL provided by the connector information page. Then initialize a payment component by creating a new Enabler instance.

### Enabler Options

The Enabler constructor accepts the following options:

```javascript
const enabler = new Enabler({
  processorUrl: string,                    // Backend processor URL (required)
  sessionId: string,                       // Commercetools session ID (required)
  locale?: string,                          // Optional locale for the payment
  onActionRequired?: () => Promise<void>,   // Optional callback when action is required
  onComplete?: (result) => void,           // Callback when payment is completed
  onError?: (error) => void,                // Callback for error handling
  paymentElementType?: string,              // Component type: 'paymentElement' or 'expressCheckout'
  stripeCustomerId?: string,                // Optional Stripe customer ID
  stripeConfig?: {                          // Optional frontend configuration override
    elements?: {
      appearance?: Appearance,              // Overrides STRIPE_APPEARANCE_PAYMENT_ELEMENT or STRIPE_APPEARANCE_EXPRESS_CHECKOUT
      layout?: LayoutObject,                // Overrides STRIPE_LAYOUT
      collectBillingAddress?: 'auto' | 'never' | 'if_required'  // Overrides STRIPE_COLLECT_BILLING_ADDRESS
    },
    paymentIntent?: {
      paymentMethodOptions?: Record<string, Record<string, unknown>>  // Payment method-specific options (e.g., PIX expiration)
    }
  }
});
```

### stripeConfig Option

The `stripeConfig` option allows you to override backend configuration from the frontend, providing per-implementation customization without requiring backend changes. This is particularly useful for:

- **Customizing Appearance**: Override the backend appearance configuration for specific implementations
- **Layout Customization**: Adjust the payment element layout (accordion, tabs) per use case
- **Payment Method Options**: Configure payment method-specific options such as PIX expiration times or Boleto settings
- **Billing Address Collection**: Control how billing addresses are collected per implementation

**Note**: Payment method options can also be specified via the `POST /payments` endpoint by including `paymentMethodOptions` in the request body. The `stripeConfig.paymentIntent.paymentMethodOptions` takes precedence when both are provided. For detailed API documentation, see [Processor Documentation](./processor/README.md#create-payment-intent-from-stripe).

**Example with stripeConfig:**

```javascript
const enabler = new Enabler({
  processorUrl: COMMERCETOOLS_PROCESSOR_URL,
  sessionId: SESSION_ID,
  paymentElementType: 'paymentElement',
  onComplete: ({ isSuccess, paymentReference, paymentIntent }) => {
    console.log('Payment completed', { isSuccess, paymentReference, paymentIntent });
  },
  onError: (err) => {
    console.error('Payment error', err);
  },
  stripeConfig: {
    elements: {
      appearance: {
        theme: 'night',
        variables: {
          colorPrimary: '#7c3aed',
        },
      },
      layout: {
        type: 'accordion',
        defaultCollapsed: false,
      },
      collectBillingAddress: 'never',
    },
    paymentIntent: {
      paymentMethodOptions: {
        pix: {
          expires_after_seconds: 3600,
        },
      },
    },
  },
});

const builder = await enabler.createDropinBuilder('embedded');
const component = await builder.build({
  showPayButton: !builder.componentHasSubmit,
});

component.mount('#payment');
```

### Integration Steps

The integration requires a few steps: create the enabler instance with required configuration (including processor URL and callbacks), build a component using `createDropinBuilder`, and mount it to a DOM element. The component handles payment processing while maintaining security standards. You'll need to replace placeholder variables with your actual application configuration values to complete the integration.

For detailed implementation instructions and additional code examples, please refer to the [Enabler documentation](./enabler/README.md#creating-components-for-payment-elements-or-express-checkout).

## Considerations for Express Checkout

By default all Express Checkout components are created with 'shippingAddressRequired' and 'billingAddressRequired' set to true. This means that the Express Checkout component can update the shipping methods and the address information in the cart. You can find the information of the methods responsible for updating the shipping methods in the [Processor Documentation](./processor/README.md#express-checkout-methods).

### Cart State Management

The connector implements cart freezing to protect cart integrity during payment flows. Carts are automatically frozen after PaymentIntent or Subscription creation to prevent modifications during payment processing. During Express Checkout operations, frozen carts are temporarily unfrozen to allow shipping information updates, then automatically re-frozen to maintain protection.

**Key Behaviors:**
- **After Payment/Subscription Creation**: Carts are frozen to prevent modifications (products, quantities, discounts, addresses, shipping)
- **During Express Checkout**: Frozen carts are temporarily unfrozen to allow Express Checkout to update shipping addresses and methods
- **After Shipping Updates**: Carts are automatically re-frozen after Express Checkout shipping updates complete
- **On Cancellation**: If Express Checkout is cancelled, the cart remains unfrozen to allow users to modify the cart

This ensures that Express Checkout can update shipping information even when the cart is protected during the payment flow, while maintaining cart integrity throughout the checkout process.

## Considerations for Apple Pay and Google Pay

### Apple Pay
Apple Pay integration requires three key elements:
1. **Domain verification**: Set up a `.well-known` directory that redirects to `{COMMERCETOOLS_PROCESSOR_URL}/applePayConfig` to satisfy Apple's domain verification requirements
2. **Compatible hardware/software**: Use iOS 11.3+/macOS 11.3+ devices with Safari and an active Apple Wallet card configured for sandbox testing
3. **Stripe configuration**: Enable Apple Pay in your Stripe dashboard settings and ensure proper domain registration

For detailed implementation instructions, see the [Apple Pay considerations in the Enabler documentation](./enabler/README.md#apple-pay-requirements).

### Google Pay
Google Pay implementation requires:
1. **Compatible browser/device**: Use Chrome browser on any compatible device with an active Google Pay account configured for sandbox testing
2. **Stripe configuration**: Enable Google Pay in your Stripe dashboard settings with domain validation handled automatically by Stripe

For complete implementation details, refer to the [Google Pay considerations in the Enabler documentation](./enabler/README.md#google-pay-requirements).


## Development Guide

## Deployment Configuration

It needs to be published to deploy your customized connector application on commercetools Connect. For details, please refer to [documentation about commercetools Connect](https://docs.commercetools.com/connect/concepts)
In addition, the tax integration connector template has a folder structure, as listed below, to support Connect.

```
├── enabler
│   ├── src
│   ├── test
│   └── package.json
├── processor
│   ├── src
│   ├── test
│   └── package.json
└── connect.yaml
```

The connect deployment configuration specifie in `connect.yaml`, the information needed to publish the application. Following is the deployment configuration used by the Enabler and Processor modules

```
deployAs:
  - name: enabler
    applicationType: assets
  - name: processor
    applicationType: service
    endpoint: /
    scripts:
      postDeploy: npm install && npm run connector:post-deploy
      preUndeploy: npm install && npm run connector:pre-undeploy
    configuration:
      standardConfiguration:
        - key: CTP_PROJECT_KEY
          description: commercetools project key
          required: true
        - key: CTP_AUTH_URL
          description: commercetools Auth URL (example - https://auth.europe-west1.gcp.commercetools.com).
          required: true
          default: https://auth.europe-west1.gcp.commercetools.com
        - key: CTP_API_URL
          description: commercetools API URL (example - https://api.europe-west1.gcp.commercetools.com).
          required: true
          default: https://api.europe-west1.gcp.commercetools.com
        - key: CTP_SESSION_URL
          description: Session API URL (example - https://session.europe-west1.gcp.commercetools.com).
          required: true
          default: https://session.europe-west1.gcp.commercetools.com
        - key: CTP_CHECKOUT_URL
          description: Checkout API URL (example - https://checkout.europe-west1.gcp.commercetools.com).
          required: true
        - key: CTP_JWKS_URL
          description: JWKs url (example - https://mc-api.europe-west1.gcp.commercetools.com/.well-known/jwks.json)
          required: true
          default: https://mc-api.europe-west1.gcp.commercetools.com/.well-known/jwks.json
        - key: CTP_JWT_ISSUER
          description: JWT Issuer for jwt validation (example - https://mc-api.europe-west1.gcp.commercetools.com)
          required: true
          default: https://mc-api.europe-west1.gcp.commercetools.com
        - key: STRIPE_CAPTURE_METHOD
          description: Stripe capture method (example - manual|automatic).
          default: automatic
        - key: STRIPE_PAYMENT_FLOW
          description: 'Optional. Stripe Elements initialization strategy - deferred|pi_first. Unset means deferred. pi_first creates the PaymentIntent before the Element mounts and initializes Elements with its clientSecret, which bank transfers (customer_balance) and BLIK need. STILL DO NOT SET pi_first - opening the payment page alone creates a PaymentIntent and a commercetools Payment with no deterministic idempotency key, so a remount orphans the previous pair, and an unfunded bank transfer makes the cart read as paid in full. An invalid value does not abort startup - it is reported to the deploy log and falls back to deferred, which also disables bank transfers and BLIK. Per-cart override - flowType in STRIPE_PAYMENT_BEHAVIOR_RULES.'
        - key: STRIPE_PAYMENT_BEHAVIOR_RULES
          description: 'Optional JSON map of cart country or commercetools store key to payment behavior overrides. Contains exceptions only - the flat variables are always the default and there is no wildcard key. Each rule may set flowType, captureMethod, setupFutureUsage and euBankTransferCountry (DE|FR|IE|NL). Malformed JSON or a rule that is not an object aborts startup; an unknown field or an invalid value does not - it is reported to the deploy log and ignored. Example - {"DE":{"captureMethod":"automatic","euBankTransferCountry":"DE"},"MX":{"captureMethod":"manual"}}'
        - key: STRIPE_WEBHOOK_ID
          description: Stripe unique identifier for the Webhook Endpoints (example - we_*****).
          required: true
        - key: STRIPE_APPEARANCE_PAYMENT_ELEMENT
          description: Stripe Appearance for Payment Element (example - {"theme":"stripe","variables":{"colorPrimary":"\#0570DE","colorBackground":"\#FFFFFF","colorText":"\#30313D","colorDanger":"\#DF1B41","fontFamily":"Ideal Sans,system-ui,sansserif","spacingUnit":"2px","borderRadius":"4px"}}).
        - key: STRIPE_APPEARANCE_EXPRESS_CHECKOUT
          description: Stripe Appearance for Express Checkout (example - {"theme":"stripe","variables":{"colorPrimary":"\#0570DE","colorBackground":"\#FFFFFF","colorText":"\#30313D","colorDanger":"\#DF1B41","fontFamily":"Ideal Sans,system-ui,sansserif","spacingUnit":"2px","borderRadius":"4px"}}).
        - key: STRIPE_LAYOUT
          description: Stripe Layout for Payment Element (example - {"type":"accordion","defaultCollapsed":false,"radios":true,"spacedAccordionItems":false} ).
          default: '{"type":"tabs","defaultCollapsed":false}'
        - key: STRIPE_PUBLISHABLE_KEY
          description: Stripe Publishable Key
          required: true
        - key: STRIPE_APPLE_PAY_WELL_KNOWN
          description: Domain association file from Stripe. (example - https://stripe.com/files/apple-pay/apple-developer-merchantid-domain-association)
        - key: STRIPE_SAVED_PAYMENT_METHODS_CONFIG
          description: Stripe configuration for saved payment methods (example - {"payment_method_save":"enabled","payment_method_save_usage":"off_session","payment_method_redisplay":"enabled","payment_method_redisplay_limit":10}).
          default: '{"payment_method_save":"disabled"}'
        - key: MERCHANT_RETURN_URL
          description: Merchant return URL
          required: true
        - key: STRIPE_COLLECT_BILLING_ADDRESS
          description: Stripe collect billing address information in Payment Element (example - 'auto' | 'never' | 'if_required').
          default: 'auto'
          required: true
        - key: STRIPE_SUBSCRIPTION_PAYMENT_HANDLING
          description: Subscription payment handling strategy (createOrder|addPaymentToOrder).
          default: createOrder
        - key: STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED
          description: Enable automatic price synchronization for subscriptions (true|false).
          default: false
        - key: STRIPE_ENABLE_MULTI_OPERATIONS
          description: Enable multicapture and multirefund support (true|false). When enabled, allows multiple partial captures and multiple refunds on payments. IMPORTANT - Requires multicapture to be enabled in your Stripe account.
          default: 'false'
        - key: STRIPE_API_VERSION
          description: Stripe API version to use (example - 2025-12-15.clover).
          default: '2025-12-15.clover'
        - key: CT_CUSTOM_TYPE_LAUNCHPAD_PURCHASE_ORDER_KEY
          description: Custom type key for launchpad purchase order number.
          required: true
          default: 'payment-launchpad-purchase-order'
        - key: CT_CUSTOM_TYPE_STRIPE_CUSTOMER_KEY
          description: Custom type key for Stripe customer ID.
          required: true
          default: 'payment-connector-stripe-customer-id'
        - key: CT_CUSTOM_TYPE_SUBSCRIPTION_LINE_ITEM_KEY
          description: Custom type key for subscription line item.
          required: true
          default: 'payment-connector-subscription-line-item-type'
        - key: CT_PRODUCT_TYPE_SUBSCRIPTION_KEY
          description: Product type key for subscription information.
          required: true
          default: 'payment-connector-subscription-information'
      securedConfiguration:
        - key: CTP_CLIENT_SECRET
          description: commercetools client secret.
          required: true
        - key: CTP_CLIENT_ID
          description: commercetools client ID with manage_payments, manage_orders, view_sessions, view_api_clients, manage_checkout_payment_intents, introspect_oauth_tokens, manage_types and view_types scopes
          required: true
        - key: STRIPE_SECRET_KEY
          description: Stripe secret key (example - sk_*****).
          required: true
        - key: STRIPE_WEBHOOK_SIGNING_SECRET
          description: Stripe Webhook signing secret  (example - whsec_*****).
          required: true

```

Here, you can see the details about various variables in the configuration
- `CTP_PROJECT_KEY`: The key to the commercetools composable commerce project.
- `CTP_SCOPE`: The scope constrains the endpoints to which the commercetools client has access and the read/write access right to an endpoint.
- `CTP_AUTH_URL`: The URL for authentication in the commercetools platform. Generate the OAuth 2.0 token required in every API call to commercetools composable commerce. The default value is `https://auth.europe-west1.gcp.commercetools.com`. For details, please refer to the documentation [here](https://docs.commercetools.com/tutorials/api-tutorial#authentication).
- `CTP_API_URL`: The URL for commercetools composable commerce API. The default value is `https://api.europe-west1.gcp.commercetools.com`.
- `CTP_SESSION_URL`: The URL for session creation in the commercetools platform. Connectors rely on the session created to share information between the enabler and processor. The default value is `https://session.europe-west1.gcp.commercetools.com`.
- `CTP_CHECKOUT_URL`: The URL for commercetools Checkout API. Required for checkout-related operations. Example: `https://checkout.europe-west1.gcp.commercetools.com`.
- `CTP_JWKS_URL`: The JSON Web Key Set URL. Default value is `https://mc-api.europe-west1.gcp.commercetools.com/.well-known/jwks.json`
- `CTP_JWT_ISSUER`: The issuer inside JSON Web Token, required in the JWT validation process. The default value is `https://mc-api.europe-west1.gcp.commercetools.com`
- `STRIPE_CAPTURE_METHOD`: Stripe capture method (manual or automatic), default value: automatic.
- `STRIPE_APPEARANCE_PAYMENT_ELEMENT`: Stripe Elements supports visual customization, which allows you to match the design of your site with the `appearance` option. This value has the specific appearance of the Payment Element component. The value needs to be a valid stringified JSON. More information about the properties can be found [here](https://docs.stripe.com/elements/appearance-api).
- `STRIPE_APPEARANCE_EXPRESS_CHECKOUT`: Stripe Elements supports visual customization, which allows you to match the design of your site with the `appearance` option. This value has the specific appearance of the Express Checkout component.
- `STRIPE_LAYOUT`: Stripe allows you to customize the Payment Element's Layout to fit your checkout flow (accordions or tabs). Default value is `{"type":"tabs","defaultCollapsed":false}`
- `STRIPE_APPLE_PAY_WELL_KNOWN`: Domain association file from Stripe. We can find more information in this [link](https://stripe.com/files/apple-pay/apple-developer-merchantid-domain-association).
- `CTP_CLIENT_SECRET`: The client secret of commercetools composable commerce user account. It is used in commercetools for clients to communicate with commercetools composable commerce via SDK.
- `CTP_CLIENT_ID`: The client ID of your commercetools composable commerce user account. It is used in commercetools for clients to communicate with commercetools composable commerce via SDK. Expected scopes are: `manage_payments` `manage_orders` `view_sessions` `view_api_clients` `manage_checkout_payment_intents` `introspect_oauth_tokens` `manage_types` `view_types`.
- `STRIPE_SECRET_KEY`: Stripe authenticates your API requests using your account's API keys
- `STRIPE_PUBLISHABLE_KEY`: Stripe authenticates your frontend requests using your account's Publishable keys
- `STRIPE_WEBHOOK_ID`: Stripe unique identifier for the [Webhook Endpoints](https://docs.stripe.com/api/webhook_endpoints)
- `STRIPE_WEBHOOK_SIGNING_SECRET`: Stripe Secret key to verify webhook signatures using the official libraries. This key is created in the [Stripe dashboard Webhook](https://docs.stripe.com/webhooks).
- `MERCHANT_RETURN_URL`: Merchant return URL used on the [confirmPayment](https://docs.stripe.com/js/payment_intents/confirm_payment) return_url parameter. The Buy Now Pay Later payment methods will send the Stripe payment_intent in the URL; the Merchant will need to retrieve the payment intent and look for the metadata `ct_payment_id` to be added in the commercetools Checkout SDK `paymentReference`.
- `STRIPE_SAVED_PAYMENT_METHODS_CONFIG`: Stripe allows you to configure the saved payment methods in the Payment Element, refer to [docs](https://docs.stripe.com/api/customer_sessions/object#customer_session_object-components-payment_element-features). This feature is disabled by default. To enable it, you need to add the expected customer session object. Default value is `{"payment_method_save":"disabled"}`
- `STRIPE_COLLECT_BILLING_ADDRESS`: Stripe allows you to collect the shipping address in the Payment Element. If you want to collect the shipping address, you need to set this value to `never`. The default value is `auto`. More information can be found [here](https://docs.stripe.com/payments/payment-element/control-billing-details-collection).
- `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING`: Defines the strategy for handling subscription payments. Options are:
  - `createOrder` (creates a new order for each subscription payment - default)
  - `addPaymentToOrder` (adds payment to existing order)
- `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED`: Enables automatic price synchronization for subscriptions.
  - `true`: Subscription prices are automatically synchronized with current commercetools product prices **before** each invoice is created via `invoice.upcoming` webhook events (price changes take effect in current billing cycle)
  - `false` (default): Price updates happen **after** invoice payment via `createOrder` method (price changes take effect in next billing cycle)
- `STRIPE_PAYMENT_FLOW`: Stripe Elements initialization strategy — `deferred` (default) or `pi_first`, case-sensitive. `deferred` creates Elements with `{ mode, amount, currency }` and the PaymentIntent at submit time. `pi_first` creates the PaymentIntent **before** the Element mounts and initializes Elements with its `clientSecret`, which bank transfers (`customer_balance`) and BLIK require — they cannot render in the deferred flow at all.
  - **Do not set `pi_first` yet.** Opening the payment page alone creates a PaymentIntent and a commercetools Payment, and creation has no deterministic idempotency key, so any remount orphans the previous pair. An unfunded bank transfer also makes the cart read as paid in full, so a shopper reloading the page gets an error instead of an "awaiting your transfer" state.
  - An invalid value does **not** abort startup — it is reported to the deploy log and falls back to `deferred`, which also silently disables bank transfers and BLIK. Check that log after changing it.
  - Under `pi_first` the Element shows and saves **no** saved payment methods: Stripe's `clientSecret`-based Elements options cannot carry `setupFutureUsage`, and `customerOptions` is deliberately omitted.
  - Per-cart override: `flowType` in `STRIPE_PAYMENT_BEHAVIOR_RULES`.
- `STRIPE_PAYMENT_BEHAVIOR_RULES`: Optional JSON map of per-market payment behavior overrides, keyed by cart country (`"DE"`) or commercetools store key (`"store-mx"`). Contains exceptions only — the flat variables above are always the default, and there is no wildcard key. Ported from `ct-connect-stripe-checkout` so one map can serve both connectors.
  - Rule fields: `flowType`, `captureMethod` (`automatic` | `automatic_async` | `manual`), `setupFutureUsage` (`off_session` | `on_session` | `""` | `none` | `null` | `undefined`) and `euBankTransferCountry` (`DE` | `FR` | `IE` | `NL`).
  - Example: `{"DE":{"captureMethod":"automatic","euBankTransferCountry":"DE"},"MX":{"captureMethod":"manual"}}`
  - **Bank transfers have no enable flag here, by design.** Whether the rail is offered at all is a Stripe Dashboard setting for the whole account; whether the widget can render it is `STRIPE_PAYMENT_FLOW`. This map resolves only the two conflicts the Dashboard cannot see: `captureMethod`, because manual capture and an `off_session`/`on_session` mandate each remove `customer_balance` from the methods Stripe resolves; and `euBankTransferCountry`, which only chooses which of your IBANs a EUR shopper is told to wire to. Omit the latter and Stripe shows an Irish IBAN, valid for every eurozone shopper since SEPA is a single payment area.
  - **Two failure modes.** Malformed JSON, a non-object map or a non-object rule **abort startup** — there is no per-field fallback, so the alternative is silently losing every rule at once. An unknown field or an invalid **value** does not abort: it is reported to the deploy log and ignored, so that one setting falls back to its default and the deployment survives a typo.
- `STRIPE_ENABLE_MULTI_OPERATIONS`: **Opt-in Feature** - Enables multicapture and multirefund support.
  - `true`: Enables multiple partial captures and multiple refunds on payments. Sets `request_multicapture: 'if_available'` on payment intents. Processes `charge.updated` and `charge.refunded` webhook events.
  - `false` (default): Standard single-capture payment processing. Webhook events are gracefully skipped with informative logging.
  - **Prerequisites**: Requires multicapture enabled in your Stripe account AND `STRIPE_CAPTURE_METHOD=manual`
  - **See**: [Multiple Refunds and Multicapture Documentation](./docs/multiple-refunds-multicapture.md) for detailed configuration
- `STRIPE_API_VERSION`: Stripe API version to use. Default value is `2025-12-15.clover`. Allows merchants to pin to specific Stripe API versions for stability.
- `CT_CUSTOM_TYPE_LAUNCHPAD_PURCHASE_ORDER_KEY`: Custom type key for launchpad purchase order number. Default: `payment-launchpad-purchase-order`.
- `CT_CUSTOM_TYPE_STRIPE_CUSTOMER_KEY`: Custom type key for Stripe customer ID. Default: `payment-connector-stripe-customer-id`.
- `CT_CUSTOM_TYPE_SUBSCRIPTION_LINE_ITEM_KEY`: Custom type key for subscription line item. Default: `payment-connector-subscription-line-item-type`.
- `CT_PRODUCT_TYPE_SUBSCRIPTION_KEY`: Product type key for subscription information. Default: `payment-connector-subscription-information`.

## Development

Certain configurations are necessary to get started developing this connector, most of which involve updating environment variables in both services (enabler, processor).
Creating a Webhook Endpoint in Stripe (using a dummy URL) is necessary. Once created, retrieve the ID and Signing Secret from the Stripe Console. The Webhook Endpoint configuration is update during the post-deploy script after the connector is deploy. It's important to set the correct values in the variables so the events are sent to the connector and can be accepted.

#### Configuration steps

#### 1. Environment Variable Setup

Navigate to each service directory and duplicate the .env.template file, renaming the copy to .env. Populate the newly created .env file with the appropriate values.

```bash
cp .env.template .env
```

#### 2. Spin Up Components via Docker Compose

With the help of docker compose, you can spin up all necessary components required for developing the connector by running the following command from the root directory;

```bash
docker compose up
```

This command would start three services that are required for development.

1. JWT Server
2. Enabler
3. Processor
