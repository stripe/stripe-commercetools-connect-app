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

# Webhooks

The following webhooks are currently supported, and the payment transactions in commercetools are:
- **payment_intent.canceled**: Modified the payment transaction Authorization to Failure and create a payment transaction CancelAuthorization: Success
- **payment_intent.succeeded**: Creates a payment transaction Charge: Success.
- **payment_intent.requires_action**: Logs the information in the connector app inside the Processor logs.
- **payment_intent.payment_failed**: Modify the payment transaction Authorization to Failure.
- **charge.refunded**: Creates payment transactions Refund: Success and Chargeback: Success with accurate refund amounts fetched from Stripe API. **Note**: Only processed when `STRIPE_ENABLE_MULTI_OPERATIONS=true`; gracefully skipped when disabled.
- **charge.succeeded**: Create the payment transaction to 'Authorization:Success' if charge is not captured, and update the payment method type that was used to pay.
- **charge.captured**: Logs the information in the connector app inside the Processor logs.
- **charge.updated**: Handles multicapture scenarios by creating Charge: Success transactions with incremental captured amounts. **Note**: Only processed when `STRIPE_ENABLE_MULTI_OPERATIONS=true`; gracefully skipped when disabled.
- **invoice.paid**: If payment charge is pending, we update the payment transaction to Charge:Success. If charge is not pending, we update the payment transaction to Authorization:Success and create a payment transaction Charge:Success.
- **invoice.payment_failed**: If payment charge is pending, we update the payment transaction to Charge:Failure. If charge is not pending, we update the payment transaction to Authorization:Failure and create a payment transaction Charge:Failure.
- **invoice.upcoming**: Handles upcoming invoice events for subscription payments, supporting the new subscription payment handling strategy.


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

It needs to be published to deploy your customized connector application on commercetools Connect. For details, please refer to [documentation about commercetools Connect](https://docs.commercetools.com/connect/concepts).
The connector follows this folder structure:

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


The deployment configuration is defined in [`connect.yaml`](./connect.yaml). This file declares the enabler and processor applications, their deployment scripts, and all configuration variables. Refer to `connect.yaml` as the source of truth.

### Configuration Reference

#### Commercetools Platform

| Variable | Required | Default | Description |
|---|---|---|---|
| `CTP_PROJECT_KEY` | Yes | - | Commercetools project key |
| `CTP_AUTH_URL` | Yes | `https://auth.europe-west1.gcp.commercetools.com` | OAuth 2.0 authentication URL. [Details](https://docs.commercetools.com/tutorials/api-tutorial#authentication) |
| `CTP_API_URL` | Yes | `https://api.europe-west1.gcp.commercetools.com` | Commercetools API URL |
| `CTP_SESSION_URL` | Yes | `https://session.europe-west1.gcp.commercetools.com` | Session API URL for enabler/processor communication |
| `CTP_CHECKOUT_URL` | Yes | - | Checkout API URL |
| `CTP_JWKS_URL` | Yes | `https://mc-api.europe-west1.gcp.commercetools.com/.well-known/jwks.json` | JSON Web Key Set URL for JWT validation |
| `CTP_JWT_ISSUER` | Yes | `https://mc-api.europe-west1.gcp.commercetools.com` | JWT issuer for token validation |
| `CTP_CLIENT_ID` | Yes | - | Client ID with required scopes (secured) |
| `CTP_CLIENT_SECRET` | Yes | - | Client secret (secured) |

Required API client scopes: `manage_payments`, `manage_orders`, `view_sessions`, `view_api_clients`, `manage_checkout_payment_intents`, `introspect_oauth_tokens`, `manage_types`, `view_types`.

#### Stripe

| Variable | Required | Default | Description |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Yes | - | Server-side secret key (secured). [Restricted key permissions](#3-stripe-account-and-keys) |
| `STRIPE_PUBLISHABLE_KEY` | Yes | - | Frontend publishable key |
| `STRIPE_WEBHOOK_ID` | Yes | - | Webhook endpoint identifier (`we_*****`) |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | Yes | - | Webhook signing secret for HMAC verification (secured) |
| `STRIPE_CAPTURE_METHOD` | No | `automatic` | `automatic`, `automatic_async`, or `manual`. Must be `manual` for multicapture. |
| `STRIPE_API_VERSION` | No | `2025-12-15.clover` | Pin to a specific Stripe API version |
| `MERCHANT_RETURN_URL` | Yes | - | Return URL for [confirmPayment](https://docs.stripe.com/js/payment_intents/confirm_payment). Required for BNPL methods. |

#### Stripe Payment Element Appearance

| Variable | Required | Default | Description |
|---|---|---|---|
| `STRIPE_APPEARANCE_PAYMENT_ELEMENT` | No | - | Stringified JSON for Payment Element theming. [Appearance API](https://docs.stripe.com/elements/appearance-api) |
| `STRIPE_APPEARANCE_EXPRESS_CHECKOUT` | No | - | Stringified JSON for Express Checkout theming. [Appearance API](https://docs.stripe.com/elements/appearance-api) |
| `STRIPE_LAYOUT` | No | `{"type":"tabs","defaultCollapsed":false}` | Payment Element layout. [Layout options](https://docs.stripe.com/payments/payment-element#layout) |
| `STRIPE_COLLECT_BILLING_ADDRESS` | Yes | `auto` | Billing address collection: `auto`, `never`, or `if_required`. [Details](https://docs.stripe.com/payments/payment-element/control-billing-details-collection) |
| `STRIPE_APPLE_PAY_WELL_KNOWN` | No | - | Domain association file URL for [Apple Pay](https://stripe.com/docs/apple-pay/web) |
| `STRIPE_SAVED_PAYMENT_METHODS_CONFIG` | No | `{"payment_method_save":"disabled"}` | Stringified JSON for saved payment methods. [Customer session features](https://docs.stripe.com/api/customer_sessions/object#customer_session_object-components-payment_element-features) |

#### Subscription Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING` | No | `createOrder` | `createOrder` (new order per payment) or `addPaymentToOrder` (add to existing order) |
| `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED` | No | `false` | When `true`, prices sync before invoice creation via `invoice.upcoming` webhook. When `false`, prices update after payment for next billing cycle. |

#### Advanced Features

| Variable | Required | Default | Description |
|---|---|---|---|
| `STRIPE_ENABLE_MULTI_OPERATIONS` | No | `false` | Enables multicapture and multirefund. Requires multicapture in your Stripe account AND `STRIPE_CAPTURE_METHOD=manual`. [Details](./docs/multiple-refunds-multicapture.md) |

#### Custom Type Keys

| Variable | Required | Default | Description |
|---|---|---|---|
| `CT_CUSTOM_TYPE_LAUNCHPAD_PURCHASE_ORDER_KEY` | Yes | `payment-launchpad-purchase-order` | Custom type key for purchase order number |
| `CT_CUSTOM_TYPE_STRIPE_CUSTOMER_KEY` | Yes | `payment-connector-stripe-customer-id` | Custom type key for Stripe customer ID |
| `CT_CUSTOM_TYPE_SUBSCRIPTION_LINE_ITEM_KEY` | Yes | `payment-connector-subscription-line-item-type` | Custom type key for subscription line item |
| `CT_PRODUCT_TYPE_SUBSCRIPTION_KEY` | Yes | `payment-connector-subscription-information` | Product type key for subscription information |

> **Note**: Variables marked "(secured)" are stored as `securedConfiguration` in `connect.yaml` -- encrypted at rest and write-only after deployment.

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

## Related Documentation

- [SECURITY.md](./SECURITY.md) -- Security policy, shared responsibility model, and vulnerability reporting
- [CLAUDE.md](./CLAUDE.md) -- Development guidelines and architecture invariants
- [Processor Documentation](./processor/README.md) -- Detailed processor docs, subscription config, API reference
- [Enabler Documentation](./enabler/README.md) -- Frontend component integration guide
- [Changelog](./docs/CHANGELOG.md) -- Release notes and recent updates
- [Subscription Price Synchronization](./docs/subscription-price-synchronization.md)
- [Mixed Cart Support](./docs/mixed-cart-support.md)
- [Multiple Refunds and Multicapture](./docs/multiple-refunds-multicapture.md)
- [Attribute Name Standardization](./docs/attribute-name-standardization.md)
