# connect-payment-integration-template

This repository provides a [connect](https://docs.commercetools.com/connect)  to integrate commercetools payment transaction with the Stripe payment service provider (PSP). It features payment integration from Stripe to commercetools, including a listener for various webhooks responses from Stripe. These webhooks calls are converted into different payment status changes within commercetools.


## Features
- Typescript language supported.
- Uses Fastify as web server framework.
- Uses [commercetools SDK](https://docs.commercetools.com/sdk/js-sdk-getting-started) for the commercetools-specific communication.
- Uses [connect payment SDK](https://github.com/commercetools/connect-payments-sdk) to manage request context, sessions and JWT authentication.
- Includes local development utilities in npm commands to build, start, test, lint & prettify code.
- Integration of a webhooks listener that handles various scenarios triggered by Stripe events.

## Prerequisite

#### 1. commercetools composable commerce API client

Users are expected to create API client responsible for payment management in composable commerce project. Details of the API client are taken as input as environment variables/ configuration for connect such as `CTP_PROJECT_KEY` , `CTP_CLIENT_ID`, `CTP_CLIENT_SECRET`. For details, please read [Deployment Configuration](./README.md#deployment-configuration).
In addition, please make sure the API client should have enough scope to be able to manage payment. For details, please refer to [Running Application](./processor/README.md#running-application)

#### 2. various URLs from commercetools composable commerce

Various URLs from commercetools platform are required to be configured so that the connect application can handle session and authentication process for endpoints.
Their values are taken as input as environment variables/ configuration for connect with variable names `CTP_API_URL`, `CTP_AUTH_URL` and `CTP_SESSION_URL`.

## Getting started

The `connect-payment-integration-stripe` contains two modules:

- **Enabler**: This acts as a wrapper implementation where Stripe’s front-end [Payment Element](https://docs.stripe.com/payments/payment-element) and [Express Checkout](https://docs.stripe.com/elements/express-checkout-element) components can be created. It gives control to the client on when and how to load the payments in a frontend based on business configuration. The connector library can be loaded directly on frontend than the PSP one. 
- **Processor**: This functions as a backend service and middleware for integration with the Stripe platform. It interacts with Stripe for transactions and updates the payment entity within Composable Commerce. Additionally, it supports a listener for triggers related to Stripe webhook events to update with `connect-payment-sdk` the payment entity based on webhook events.
  
Regarding the development of processor module, please refer to the following documentations:

- [Development of Processor](./processor/README.md)

![overview.png](docs%2Foverview.png) 
### Components 

1. **Composable Commercer**
   Represents the website platform infrastructure provided by client.
2. **Stripe Composable Connector**
   - A [Payment connector integration](https://docs.commercetools.com/checkout/payment-connectors-applications) within the infrastructure of commercetools that facilitates communication between commercetools and Stripe.
3. **Processor**
   - Manages payment transactions and interacts with Stripe to:
      - Create payment intents.
      - Handle manual API payment transactions.
      - Listening to webhooks events triggered by Stripe and processing all related payment operations.
4. **Enabler**
   - Assists in the creation of the [Stripe Payment Element](https://docs.stripe.com/payments/payment-element) and [Express Checkout](https://docs.stripe.com/elements/express-checkout-element) components used as a payment method by client.
   - Connects to any sample site that wants to integrate the connector, providing the available payment components for seamless integration.
5. **Stripe**
   - The external payment service provider that handles various payment operations, sends webhooks for events such as authorization, capture, refund, and cancel.

# Webhooks

The following webhooks are currently supported and the payment transactions in commercetools are:
- **payment_intent.canceled**: Modified the payment transaction Authorization to Failure and create a payment transaction CancelAuthorization: Success
- **payment_intent.succeeded**: Creates a payment transaction Charge: Success.
- **payment_intent.requires_action**: Logs the information in the connector app inside the Processor logs.
- **payment_intent.payment_failed**: Modify the payment transaction Authorization to Failure.
- **charge.refunded**: Create a payment transaction Refund to Success, and a Chargeback to Success.
- **charge.succeeded**: If the charge is not captured, create the payment transaction to Authorization:Success.
- **charge.captured**: Logs the information in the connector app inside the Processor logs.


## Prerequisite

#### 1. commercetools

We will need to create the connector found on the commercetools connect marketplace.Users are expected to create API client responsible for payment management in composable commerce project. Details of the API client are taken as input as environment variables/ configuration for connect such as `CTP_PROJECT_KEY` , `CTP_CLIENT_ID`, `CTP_CLIENT_SECRET`.

1. **API client**:Various URLs from commercetools platform are required to be configured so that the connect application can handle session and authentication process for endpoints. Their values are taken as input as environment variables/ configuration for connect with variable names `CTP_API_URL`, `CTP_AUTH_URL` and `CTP_SESSION_URL`.
2. **payment connector**: Install the payment connector from the commercetools connector marketplace.
3. **composable integration**: Load the enabler from the Stripe Composable connector, create the respective Payment Element/Express Checkout components.

#### 2. Stripe account credentials and configurations

The following Stripe account credentials and configurations are required:

1. **STRIPE_SECRET_KEY**: Provided by Stripe. This must be kept secret and stored securely in your web or mobile app’s server-side code (such as in an environment variable or credential management system) to call Stripe APIs.
2. **STRIPE_CAPTURE_METHOD**: Configuration that enables the capture method selected by the user. The capture method controls when the funds will be captured from the customer’s account. Possible enum values:
   - `automatic`: Stripe automatically captures funds when the customer authorizes the payment.
   - `automatic_async`: (Default) Stripe asynchronously captures funds when the customer authorizes the payment. Recommended over `capture_method=automatic` due to improved latency. Read the [integration guide](https://docs.stripe.com/elements/appearance-api) for more information.
   - `manual`: Places a hold on the funds when the customer authorizes the payment but doesn’t capture the funds until later. (Not all payment methods support this.)
3. **STRIPE_APPEARANCE_PAYMENT_ELEMENT**: This configuration enables the theming for the payment element component. The value needs to be a valid stringified JSON. More information about the properties can be found [here](https://docs.stripe.com/elements/appearance-api).
```
//strigified eg.
"{\"theme\":\"stripe\",\"variables\":{\"colorPrimary\":\"#0570DE\",\"colorBackground\":\"#FFFFFF\",\"colorText\":\"#30313D\",\"colorDanger\":\"#DF1B41\",\"fontFamily\":\"Ideal Sans,system-ui,sansserif\",\"spacingUnit\":\"2px\",\"borderRadius\":\"4px\"}}".
```
4. **STRIPE_APPEARANCE_EXPRESS_CHECKOUT**: This configuration enables the theming for the express checkout component. The value needs to be a valid stringified JSON. More information about the properties can be found [here](https://docs.stripe.com/elements/appearance-api).
```
//strigified eg.
"{\"theme\":\"stripe\",\"variables\":{\"colorPrimary\":\"#0570DE\",\"colorBackground\":\"#FFFFFF\",\"colorText\":\"#30313D\",\"colorDanger\":\"#DF1B41\",\"fontFamily\":\"Ideal Sans,system-ui,sansserif\",\"spacingUnit\":\"2px\",\"borderRadius\":\"4px\"}}".
```
5. **STRIPE_WEBHOOK_ID**: Unique identifier of a Webhook Endpoint in Stripe.
6. **STRIPE_WEBHOOK_SIGNING_SECRET**: Signing secret of a Webhook Endpoint in Stripe.
7. **STRIPE_APPLE_PAY_WELL_KNOWN**: Domain association file from Stripe. (example - https://stripe.com/files/apple-pay/apple-developer-merchantid-domain-association)

#### Considerations about the Webhook Endpoint
Before installing the connector, it is necessary to create a Webhook Endpoint in Stripe (using a dummy URL). Once created, the ID and Signing Secret can be retrieved from the Stripe Console. This Webhook Endpoint will be updated during the post-deploy script after the connector has been deployed. It's important to set the correct values in the variables so the events are sent to the connector and can be accepted.

## Creating Components for Payment Elements or Express Checkout

To integrate the Stripe Composable connector with commercetools and utilize the Stripe payment elements or express checkout, follow these steps:

### 1. **Load the Stripe Enabler**
Use the provided enabler URL from the Stripe Composable Connector information page.
```javascript
const Enabler = await import(process.env.REACT_APP_ENABLER_BUILD_URL);
```
### 2. **Initialize the Payment Component**
Create a new Enabler instance and specify the `paymentElementType` parameter to configure the component type, either **Payment Element:'payment'** or **Express Checkout:'expressCheckout**.
```javascript
new Enabler({
    processorUrl: COMMERCETOOLS_PROCESSOR_URL, // Backend processor URL
    sessionId: SESSION_ID,                    // Commercetools session ID
    currency: "US",                           // Desired currency for the payment
    onComplete: ({ isSuccess, paymentReference, paymentIntent }) => {
        onComplete(paymentIntent);            // Callback for completion
    },
    onError: (err) => {
        onError(err);                          // Callback for error handling
    },
    paymentElementType: type,                 // Component type:(payment|expressCheckout) Payment Element or Express Checkout
});
```

Replace the placeholder variables (`COMMERCETOOLS_PROCESSOR_URL`, `SESSION_ID`, `onComplete`, `onError`, and `type`) with appropriate values based on your application configuration.

## Considerations for Apple Pay and Google Pay

### Apple Pay Requirements
To enable Apple Pay, you must ensure the following conditions are satisfied:

1. The website must include a `https://www.website.com/.well-known/apple-developer-merchantid-domain-association` file that redirects to:
   ```text
   {COMMERCETOOLS_PROCESSOR_URL}/applePayConfig
   ```
   This endpoint retrieves the required merchant ID domain association file. For more details, refer to Stripe’s official [Apple Pay domain association documentation](https://support.stripe.com/questions/enable-apple-pay-on-your-stripe-account).

2. The environment and devices must meet Apple Pay testing requirements:
    - You need an **iOS device** running iOS 11.3 or later, or a **Mac** running macOS 11.3 or later with Safari.
    - The browser must be configured with an active card in the Apple Wallet in sandbox mode.
    - A valid Stripe account must be linked with Apple Pay and properly configured.
    - All webpages hosting an Apple Pay button are HTTPS.

3. Make sure your Stripe account has Apple Pay enabled (this is configured via your Stripe dashboard).

### Google Pay Requirements
To enable Google Pay, you must ensure the following conditions are satisfied:

1. The device and browser requirements for testing Google Pay are met:
    - Use a **Chrome browser** on any device (mobile or desktop) supporting Google Pay.
    - Add a payment method (card) to your Google Pay account and ensure your testing environment is set up for sandbox mode.

2. Additional configuration for your Stripe account:
    - Ensure **Google Pay** is enabled via your Stripe dashboard.
    - Stripe automatically manages domain validation for Google Pay—manual setup is not required.


## Development Guide


## Deployment Configuration

In order to deploy your customized connector application on commercetools Connect, it needs to be published. For details, please refer to [documentation about commercetools Connect](https://docs.commercetools.com/connect/concepts)
In addition, in order to support connect, the tax integration connector template has a folder structure as listed below

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

Connect deployment configuration is specified in `connect.yaml` which is required information needed for publishing of the application. Following is the deployment configuration used by Enabler and Processor modules

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
          description: Stripe Appearance for Payment Element (example - "{\"theme\":\"stripe\",\"variables\":{\"colorPrimary\":\"#0570DE\",\"colorBackground\":\"#FFFFFF\",\"colorText\":\"#30313D\",\"colorDanger\":\"#DF1B41\",\"fontFamily\":\"Ideal Sans,system-ui,sansserif\",\"spacingUnit\":\"2px\",\"borderRadius\":\"4px\"}}").
        - key: STRIPE_APPEARANCE_EXPRESS_CHECKOUT
          description: Stripe Appearance for Express Checkout (example - "{\"theme\":\"stripe\",\"variables\":{\"colorPrimary\":\"#0570DE\",\"colorBackground\":\"#FFFFFF\",\"colorText\":\"#30313D\",\"colorDanger\":\"#DF1B41\",\"fontFamily\":\"Ideal Sans,system-ui,sansserif\",\"spacingUnit\":\"2px\",\"borderRadius\":\"4px\"}}").
        - key: STRIPE_PUBLISHABLE_KEY
          description: Stripe Publishable Key
        - key: STRIPE_APPLE_PAY_WELL_KNOWN
          description: Domain association file from Stripe. (example - https://stripe.com/files/apple-pay/apple-developer-merchantid-domain-association)
        - key: MERCHANT_RETURN_URL
          description: Merchant return URL
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

Here you can see the details about various variables in configuration
- `CTP_PROJECT_KEY`: The key of commercetools composable commerce project.
- `CTP_SCOPE`: The scope constrains the endpoints to which the commercetools client has access, as well as the read/write access right to an endpoint.
- `CTP_AUTH_URL`: The URL for authentication in commercetools platform. It is used to generate OAuth 2.0 token which is required in every API call to commercetools composable commerce. The default value is `https://auth.europe-west1.gcp.commercetools.com`. For details, please refer to documentation [here](https://docs.commercetools.com/tutorials/api-tutorial#authentication).
- `CTP_API_URL`: The URL for commercetools composable commerce API. Default value is `https://api.europe-west1.gcp.commercetools.com`.
- `CTP_SESSION_URL`: The URL for session creation in commercetools platform. Connectors relies on the session created to be able to share information between enabler and processor. The default value is `https://session.europe-west1.gcp.commercetools.com`.
- `CTP_JWKS_URL`: The URL which provides JSON Web Key Set. Default value is `https://mc-api.europe-west1.gcp.commercetools.com/.well-known/jwks.json`
- `CTP_JWT_ISSUER`: The issuer inside JSON Web Token which is required in JWT validation process. Default value is `https://mc-api.europe-west1.gcp.commercetools.com`
- `STRIPE_CAPTURE_METHOD`: Stripe capture method (manual or automatic), default value: automatic.
- `STRIPE_APPEARANCE_PAYMENT_ELEMENT`: Stripe Elements supports visual customization, which allows you to match the design of your site with the `appearance` option. This value has the specific appearance of the Payment Element component.
- `STRIPE_APPEARANCE_EXPRESS_CHECKOUT`: Stripe Elements supports visual customization, which allows you to match the design of your site with the `appearance` option. This value has the specific appearance of the Express Checkout component.
- `STRIPE_APPLE_PAY_WELL_KNOWN`: Domain association file from Stripe. (example - https://stripe.com/files/apple-pay/apple-developer-merchantid-domain-association)
- `CTP_CLIENT_SECRET`: The client secret of commercetools composable commerce user account. It is used in commercetools client to communicate with commercetools composable commerce via SDK.
- `CTP_CLIENT_ID`: The client ID of your commercetools composable commerce user account. It is used in commercetools client to communicate with commercetools composable commerce via SDK. Expected scopes are: `manage_payments` `manage_orders` `view_sessions` `view_api_clients` `manage_checkout_payment_intents` `introspect_oauth_tokens` `manage_types` `view_types`.
- `STRIPE_SECRET_KEY`: Stripe authenticates your API requests using your account’s API keys
- `STRIPE_PUBLISHABLE_KEY`: Stripe authenticates your front end requests using your account’s Publishable keys
- `STRIPE_WEBHOOK_ID`: Stripe unique identifier for the [Webhook Endpoints](https://docs.stripe.com/api/webhook_endpoints)
- `STRIPE_WEBHOOK_SIGNING_SECRET`: Stripe Secret key to verify webhook signatures using the official libraries. This key is created in the [Stripe dashboard Webhook](https://docs.stripe.com/webhooks).
- `MERCHANT_RETURN_URL` : Merchant return URL used on the [confirmPayment](https://docs.stripe.com/js/payment_intents/confirm_payment) return_url parameter.

## Development

In order to get started developing this connector certain configuration are necessary, most of which involve updating environment variables in both services (enabler, processor).
It is necessary to create a Webhook Endpoint in Stripe (using a dummy URL). Once created, the ID and Signing Secret can be retrieved from the Stripe Console. This Webhook Endpoint will be updated during the post-deploy script after the connector has been deployed. It's important to set the correct values in the variables so the events are sent to the connector and can be accepted.

#### Configuration steps

#### 1. Environment Variable Setup

Navigate to each service directory and duplicate the .env.template file, renaming the copy to .env. Populate the newly created .env file with the appropriate values.

```bash
cp .env.template .env
```

#### 2. Spin Up Components via Docker Compose

With the help of docker compose, you are able to spin up all necessary components required for developing the connector by running the following command from the root directory;

```bash
docker compose up
```

This command would start 3 required services, necessary for development

1. JWT Server
2. Enabler
3. Processor
