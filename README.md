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
- **Subscription Shipping Fee Support**: The connector now supports recurring shipping fees as part of subscription billing, automatically creating and managing Stripe shipping prices that align with subscription billing intervals. [Learn more](./processor/README.md#subscription-shipping-fee-support).
- **Mixed Cart Support**: Enhanced subscription handling for carts containing both subscription items and one-time items. The system automatically creates separate invoices for one-time items while maintaining subscription billing for recurring items. [Learn more](./docs/mixed-cart-support.md).
- **Attribute Name Standardization**: All subscription-related product type attributes now use the `stripeConnector_` prefix for better organization and consistency. The system automatically handles the transformation between prefixed attribute names and internal field names. [Learn more](./docs/attribute-name-standardization.md).
- **Enhanced Payment Intent Error Handling**: Improved error management for payment intent statuses including `requires_action` and `payment_failed` with structured error objects for better debugging.
- Provides a subscription management API via the commercetools connector, enabling Stripe subscription operations directly through commercetools API endpoints.
- Customers can update their shipping and billing addresses directly within the Stripe Express Checkout. When an address is changed, the connector automatically fetches the latest shipping rates from commercetools and updates the cart to reflect the new information. [See Details](README.md#sequence-diagrams-for-the-payment-connector)

## Prerequisite

#### 1. commercetools composable commerce API client

Create an API client responsible for payment management in a composable commerce project. The API client details are input as environment variables/ configuration for connect, such as `CTP_PROJECT_KEY`, `CTP_CLIENT_ID`, and `CTP_CLIENT_SECRET`. Please read [Deployment Configuration](./README.md#deployment-configuration) for details.
In addition, please make sure the API client has enough scope to manage Payment. For details, please refer to [Running Application](./processor/README.md#running-application)

#### 2. Various URLs from commercetools composable commerce

Configure various URLs from the commercetools platform, so that the connect application can handle the session and authentication process for endpoints.
Their values are input for environment variables/configurations for connecting, with variable names `CTP_API_URL`, `CTP_AUTH_URL`, and `CTP_SESSION_URL`.

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

### Subscription Service Enhancements (Latest)

The subscription service has been significantly enhanced with the following improvements:

#### 🚀 New Features
- **Recurring Shipping Fee Support**: Added comprehensive support for recurring shipping fees in subscriptions
- **Automatic Shipping Price Management**: Automatic creation and management of Stripe shipping prices
- **Enhanced Metadata Tracking**: Improved metadata handling for shipping methods and prices
- **Comprehensive Test Coverage**: Added extensive test coverage for all subscription operations

#### 🔧 Technical Improvements
- **Method Signature Updates**: Updated method signatures to use proper object parameters for better type safety
- **Shipping Price Integration**: New methods for managing shipping prices within subscriptions:
  - `getSubscriptionShippingPriceId()`: Retrieves or creates shipping price IDs
  - `getStripeShippingPriceByMetadata()`: Searches for existing shipping prices
  - `createStripeShippingPrice()`: Creates new Stripe shipping prices
- **Enhanced Type Definitions**: Added new TypeScript interfaces for shipping price management
- **Improved Error Handling**: Better error handling and logging throughout the subscription service
- **Enabler Enhancements**: Improved payment mode handling and comprehensive debugging
- **Payment Service Improvements**: Enhanced payment intent configuration with conditional shipping and advanced payment method options

#### 🧪 Testing Enhancements
- **Comprehensive Test Suite**: Added tests for all subscription service methods
- **Mock Data Improvements**: Enhanced mock data for shipping information and Stripe API responses
- **Test Coverage**: Achieved comprehensive test coverage for subscription operations

#### 📚 Documentation Updates
- **API Documentation**: Updated API documentation to reflect Stripe API compliance
- **Feature Documentation**: Added detailed documentation for shipping fee functionality
- **Testing Documentation**: Added comprehensive testing documentation and examples

For detailed information about these improvements, see the [Processor Documentation](./processor/README.md#subscription-shipping-fee-support).

For technical implementation details, see the [Subscription Shipping Fee Integration Guide](./docs/subscription-shipping-fee.md).

For enabler and payment service improvements, see the [Enabler Improvements Guide](./docs/enabler-improvements.md).

# Webhooks

The following webhooks are currently supported, and the payment transactions in commercetools are:
- **payment_intent.canceled**: Modified the payment transaction Authorization to Failure and create a payment transaction CancelAuthorization: Success
- **payment_intent.succeeded**: Creates a payment transaction Charge: Success.
- **payment_intent.requires_action**: Logs the information in the connector app inside the Processor logs.
- **payment_intent.payment_failed**: Modify the payment transaction Authorization to Failure.
- **charge.refunded**: Create a payment transaction Refund to Success and a Chargeback to Success.
- **charge.succeeded**: Create the payment transaction to 'Authorization:Success' if charge is not captured, and update the payment method type that was used to pay.
- **charge.captured**: Logs the information in the connector app inside the Processor logs.
- **invoice.paid**: If payment charge is pending, we update the payment transaction to Charge:Success. If charge is not pending, we update the payment transaction to Authorization:Success and create a payment transaction Charge:Success.
- **invoice.payment_failed**: If payment charge is pending, we update the payment transaction to Charge:Failure. If charge is not pending, we update the payment transaction to Authorization:Failure and create a payment transaction Charge:Failure.


## Prerequisite


#### 1. Stripe account credentials and configurations

Before installing the connector, you must create a Stripe account and obtain the necessary credentials. The Stripe account is required to process payments and manage transactions. Sign up for a Stripe account at [Stripe](https://stripe.com/). Once you have an account, you must set up the following configurations in your environment variables or configuration files. Before installing the connector, a webhook endpoint in Stripe must be created (using a dummy URL). Retrieve the ID and Signing Secret from the Stripe Console. The Webhook Endpoint is update during the post-deploy script after the deployed connector. It's important to set the correct values in the variables so the events are sent to the connector and can be accepted. The following Stripe account credentials and configurations are required:

1. **STRIPE_SECRET_KEY**: Provided by Stripe. Secret and stored securely in your web or mobile app's server-side code (such as in an environment variable or credential management system) to call Stripe APIs.
2. **STRIPE_CAPTURE_METHOD**: Configuration that enables the capture method selected by the user. The capture method controls when Stripe will capture the funds from the customer's account. Possible enum values:
   - `automatic`: Stripe automatically captures funds when the customer authorizes the Payment.
   - `automatic_async`: (Default) Stripe asynchronously captures funds when the customer authorizes the Payment. Recommended over `capture_method=automatic` due to improved latency. Read the [integration guide](https://docs.stripe.com/elements/appearance-api) for more information.
   - `manual`: Places a hold on the funds when the customer authorizes the Payment but doesn't capture the funds until later. (Not all payment methods support this.)
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
17. **CTP_JWKS_URL**: JWKs URL for JWT validation
18. **CTP_JWT_ISSUER**: JWT issuer for validation
19. **CTP_CLIENT_SECRET**: Client secret for commercetools (in secured configuration)
20. **CTP_CLIENT_ID**: Client ID for commercetools with specific required scopes (in secured configuration)

These commercetools-specific variables are essential for the connector to properly authenticate and communicate with the commercetools platform.

#### 2. commercetools

We must create the connector on the commercetools connect marketplace, enable the checkout feature in the merchant center, and select the payment connector as the drop-in payment method on the checkout configuration page. Users create an API client responsible for payment management in a composable commerce project. The API client's details are input as environment variables/ configuration for connecting, such as `CTP_PROJECT_KEY,` `CTP_CLIENT_ID,` and `CTP_CLIENT_SECRET`.

1. **API client**: Various URLs from the commercetools platform must be configured so that the connect application can handle the session and authentication process for endpoints. Their values are taken as input as environment variables/ configuration for connect, with variable names `CTP_API_URL`, `CTP_AUTH_URL`, and `CTP_SESSION_URL`.
2. **payment connector**: Install the payment connector from the commercetools connector marketplace.

Note: To use the Stripe Composable Connector installed, you must call the enabler module from the installed connector URL. To find more information about how to use the enabler module, please refer to the [Enabler documentation](./enabler/README.md#creating-components-for-payment-elements-or-express-checkout).

## Creating Components for Payment Elements or Express Checkout

This section explains how to integrate the Stripe Composable connector with commercetools. First, load the Stripe Enabler using the URL provided by the connector information page. Then initialize a payment component by creating a new Enabler instance with parameters for processor URL, session ID, currency, callbacks, and payment component type (either 'paymentElement' or 'expressCheckout').

The integration requires a few steps: create the enabler instance with required configuration (including processor URL and callbacks), build a component using createDropinBuilder, and mount it to a DOM element. The component handles payment processing while maintaining security standards. You'll need to replace placeholder variables with your actual application configuration values to complete the integration.

For detailed implementation instructions and code examples, please refer to the [Enabler documentation](./enabler/README.md#creating-components-for-payment-elements-or-express-checkout).

## Considerations for Express Checkout

By default all Express Checkout components are created with 'shippingAddressRequired' and 'billingAddressRequired' set to true. This means that the Express Checkout component can update the shipping methods and the address information in the cart. You can find the information of the methods responsible for updating the shipping methods in the [Processor Documentation](./processor/README.md#express-checkout-methods).

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
