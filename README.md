# connect-payment-integration-stripe
This repository provides a [connect](https://docs.commercetools.com/connect)  to integrate commercetools with the Stripe payment service provider (PSP). It features payment integration from Stripe to commercetools, including a listener for various webhooks responses from Stripe. These webhooks calls are converted into different payment status changes within commercetools.

## Features
- Typescript language supported.
- Uses Fastify as web server framework.
- Uses [commercetools SDK](https://docs.commercetools.com/sdk/js-sdk-getting-started) for the commercetools-specific communication.
- Uses [connect payment SDK](https://github.com/commercetools/connect-payments-sdk) to manage request context, sessions and JWT authentication.
- Includes local development utilities in npm commands to build, start, test, lint & prettify code.
- Integration of a webhooks listener that handles various scenarios triggered by Stripe events.

## Overview

The `connect-payment-integration-stripe` project presents a Stripe integration connector, encompassing two main modules.

- **Enabler**: This acts as a wrapper implementation where Stripe’s front-end components are embedded. The two main components of web elements that are embedded are the payment element and the express checkout component. The connector library can be loaded directly on the frontend.
- **Processor**: This functions as a backend service and middleware for integration with the Stripe platform. It interacts with Stripe for transactions and updates the payment entity within Composable Commerce. Additionally, it supports a listener for triggers related to Stripe webhook events to update the payment entity based on webhook events.


![overview.png](docs%2Foverview.png)
### Components

1. **commercetools Infrastructure**
   Represents the e-commerce platform infrastructure provided by commercetools.
2. **Stripe Connector**
    - A connect integration within the infrastructure that facilitates communication between commercetools and Stripe.
3. **Processor**
    - Manages payment transactions and interacts with Stripe to:
        - Create payment intents.
        - Handle manual API payment transactions.
        - Listening to webhooks events triggered by Stripe and processing all related payment operations.
4. **Enabler**
    - Assists in the creation of payment intents and handling of payment element and express checkout components.
    - Connects to any sample site that wants to integrate the connector, providing the available payment components for seamless integration.
5. **Stripe**
    - The external payment service provider that handles various payment operations, sends webhooks for events such as authorization, capture, refund, and cancel.
6. **Integration Showcase for Connector**
    - A sample site that demonstrates the integration and implementation of the Stripe connector components.

### Flow of Interactions

1. **Payment Transaction Initiation**
    - The payment transaction starts when the Integration Showcase for Connector renders the payment support components provided by the Enabler, and is then sent to the Processor within the Stripe Connector.

2. **Processor Actions**
    - The Processor within the Stripe Connector is responsible for:
        - Creating payment intents.
        - Handling manual API payment transactions.
        - Listen to webhooks events triggered by Stripe and process all related payment operations.

3. **Communication with Stripe**
    - The Processor sends a payment intent creation request to Stripe and awaits a valid response.
    - Stripe processes the request and may trigger various webhooks for events such as:
        - `charge.succeeded`
        - `payment_intent.succeeded`
        - `charge.refunded`
        - `payment_intent.canceled`
        - `payment_intent.payment_failed`
        - `payment_intent.requires_action`

4. **Enabler Role**
    - The Enabler within the Stripe Connector assists in managing the payment intents and express checkout components.

5. **Stripe Sample Site**
    - The Integration Showcase for Connector site is used to show how the Stripe connector can be implemented and work in a real-world scenario.

# Webhooks

The following webhooks are supported:
- **charge.succeeded**: Creates a payment if the `paymentIntent.capture_method` is manual and creates a payment with transaction Authorization: Success.
- **payment_intent.succeeded**: Creates a payment if the `paymentIntent.capture_method` is not manual and creates a payment with transaction Charge: Success. If the `paymentIntent.capture_method` is manual, it creates the payment transaction Charge: Success.
- **charge.refunded**: Creates transaction Refund: Success if the `paymentIntent.captured` value is true.
- **payment_intent.canceled**: Creates transaction CancelAuthorization: Success if the `paymentIntent.captured` value is true.
- **payment_intent.payment_failed**: Logs the information in the connector app inside the Processor logs.
- **payment_intent.requires_action**: Logs the information in the connector app inside the Processor logs.

## Prerequisite
#### 1. commercetools composable commerce API client
Users are expected to create API client responsible for payment management in composable commerce project. Details of the API client are taken as input as environment variables/ configuration for connect such as `CTP_PROJECT_KEY` , `CTP_CLIENT_ID`, `CTP_CLIENT_SECRET`, `CTP_SCOPE`, `CTP_REGION`. For details, please read [Deployment Configuration](#deployment-configuration).
In addition, please make sure the API client should have enough scope to be able to manage payment. For details, please refer to [Running Application](processor%2FREADME.md#running-application)

#### 2. Various URLs from commercetools composable commerce
Various URLs from commercetools platform are required to be configured so that the connect application can handle session and authentication process for endpoints.
Their values are taken as input as environment variables/ configuration for connect with variable names `CTP_API_URL`, `CTP_AUTH_URL` and `CTP_SESSION_URL`.

#### 3. Stripe account credentials and configurations

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
1. **STRIPE_APPEARANCE_EXPRESS_CHECKOUT**: This configuration enables the theming for the express checkout component. The value needs to be a valid stringified JSON. More information about the properties can be found [here](https://docs.stripe.com/elements/appearance-api)
```
//strigified eg.
"{\"theme\":\"stripe\",\"variables\":{\"colorPrimary\":\"#0570DE\",\"colorBackground\":\"#FFFFFF\",\"colorText\":\"#30313D\",\"colorDanger\":\"#DF1B41\",\"fontFamily\":\"Ideal Sans,system-ui,sansserif\",\"spacingUnit\":\"2px\",\"borderRadius\":\"4px\"}}".
```

1. **STRIPE_WEBHOOK_ID**: Unique identifier of a Webhook Endpoint in Stripe.

2. **STRIPE_WEBHOOK_SIGNING_SECRET**: Signing secret of a Webhook Endpoint in Stripe.

### Considerations about Apple Pay

To enable the Apple Pay button in the payment element component, your website must have the correct domain association file hosted. This file is crucial for Apple to verify that you control the domain where Apple Pay will be used.

1. **Domain Association File**: Stripe generates a domain association file named `apple-developer-merchantid-domain-association`. You need to host this file at the following URL on your website:
   - `https://yourwebsite.com/.well-known/apple-developer-merchantid-domain-association`
   - Replace `https://yourwebsite.com` with your actual domain.

2. **Verification Process**: Once the file is correctly hosted, Stripe will automatically attempt to verify your domain with Apple. This verification is necessary for Apple Pay to function correctly on your site.

3. **Updating the File**: Keep in mind that this file has an expiration date. If you receive an error about an outdated file, you'll need to download the latest version from Stripe and replace the old file on your server.

These steps ensure that the Apple Pay button is displayed and functional when using the payment element on your site.

#### Considerations about the Webhook Endpoint
Before installing the connector, it is necessary to create a Webhook Endpoint in Stripe (using a dummy URL). Once created, the ID and Signing Secret can be retrieved from the Stripe Console. This Webhook Endpoint will be updated during the post-deploy script after the connector has been deployed. It's important to set the correct values in the variables so the events are sent to the connector and can be accepted.

## Development Guide

Regarding the development of enabler module, please refer to the following documentations:
- [Development of Enabler](enabler%2FREADME.md#payment-integration-enabler)

Regarding the development of processor module, please refer to the following documentations:
- [Development of Processor](processor%2FREADME.md#payment-integration-processor)

#### Connector in commercetools Connect
Use public connector listed in connect marketplace. If any customization done, follow guidelines [here](https://docs.commercetools.com/connect/getting-started) to register the connector for private use.

#### Deployment Configuration

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

Connect deployment configuration is specified in `connect.yaml` which is required information needed for publishing of the application. Following is the deployment configuration used by full ingestion and incremental updater modules
```
deployAs:  
  - name: processor  
    applicationType: service  
    endpoint: /  
    scripts:  
      postDeploy: npm run connector:post-deploy  
    configuration:  
      standardConfiguration:  
        - key: CTP_PROJECT_KEY  
          description: commercetools project key  
          required: true  
        - key: CTP_AUTH_URL  
          description: commercetools Auth URL  
          required: true  
        - key: CTP_API_URL  
          description: commercetools API URL  
          required: true  
        - key: CTP_SESSION_URL  
          description: Session API URL  
          required: true  
        - key: CTP_JWKS_URL  
          description: JWKs url  
          required: true  
        - key: CTP_JWT_ISSUER  
          description: JWT Issuer for jwt validation  
          required: true  
        - key: STRIPE_CAPTURE_METHOD  
          description: Stripe capture method (manual or automatic)  
        - key: STRIPE_WEBHOOK_ID  
          description: Stripe Webhook ID  
          required: true  
        - key: STRIPE_APPEARANCE_PAYMENT_ELEMENT  
          description: Stripe Appearance for Payment Element.  
        - key: STRIPE_APPEARANCE_EXPRESS_CHECKOUT  
          description: Stripe Appearance for Express Checkout Element.  
      securedConfiguration:  
        - key: CTP_CLIENT_SECRET  
          description: commercetools client secret  
          required: true  
        - key: CTP_CLIENT_ID  
          description: commercetools client ID  
          required: true  
        - key: STRIPE_SECRET_KEY  
          description: Stripe secret key  
          required: true  
        - key: STRIPE_WEBHOOK_SIGNING_SECRET  
          description: Stripe Webhook signing secret  
          required: true  
  - name: enabler  
    applicationType: assets
```

Here you can see the details about various variables in configuration
- CTP_PROJECT_KEY: The key of commercetools composable commerce project.
- CTP_SCOPE: The scope constrains the endpoints to which the commercetools client has access, as well as the read/write access right to an endpoint.
- CTP_AUTH_URL: The URL for authentication in commercetools platform. It is used to generate OAuth 2.0 token which is required in every API call to commercetools composable commerce. The default value is `https://auth.europe-west1.gcp.commercetools.com`. For details, please refer to documentation [here](https://docs.commercetools.com/tutorials/api-tutorial#authentication).
- CTP_API_URL: The URL for commercetools composable commerce API. Default value is `https://api.europe-west1.gcp.commercetools.com`.
- CTP_SESSION_URL: The URL for session creation in commercetools platform. Connectors relies on the session created to be able to share information between enabler and processor. The default value is `https://session.europe-west1.gcp.commercetools.com`.
- CTP_JWKS_URL: The URL which provides JSON Web Key Set (set the region of your project): https://mc-api.{region}.commercetools.com/.well-known/jwks.json
- CTP_JWT_ISSUER: The issuer inside JSON Web Token which is required in JWT validation process (set the region of your project): https://mc-api.{region}.commercetools.com
- STRIPE_CAPTURE_METHOD: Stripe capture method (manual or automatic), default value: automatic.
- STRIPE_APPEARANCE_PAYMENT_ELEMENT: Stripe Elements supports visual customization, which allows you to match the design of your site with the `appearance` option. This value has the specific appearance of the Payment Element component.
- STRIPE_APPEARANCE_EXPRESS_CHECKOUT: Stripe Elements supports visual customization, which allows you to match the design of your site with the `appearance` option. This value has the specific appearance of the Express Checkout Element component.
- CTP_CLIENT_SECRET: The client secret of commercetools composable commerce user account. It is used in commercetools client to communicate with commercetools composable commerce via SDK.
- CTP_CLIENT_ID: The client ID of your commercetools composable commerce user account. It is used in commercetools client to communicate with commercetools composable commerce via SDK.
- STRIPE_SECRET_KEY: Stripe authenticates your API requests using your account’s API keys
- STRIPE_WEBHOOK_ID: Stripe unique identifier for the [Webhook Endpoints](https://docs.stripe.com/api/webhook_endpoints)
- STRIPE_WEBHOOK_SIGNING_SECRET: Stripe Secret key to verify webhook signatures using the official libraries. This key is created in the [Stripe dashboard Webhook](https://docs.stripe.com/webhooks).
