# Payment Integration Processor
This module provides an application based on [commercetools Connect](https://docs.commercetools.com/connect), which is triggered by HTTP requests from Checkout UI for payment operations.

The corresponding payment, cart or order details would be fetched from composable commerce platform, and then be sent to Stripe for various payment operations such as create/capture/cancel/refund payment.

The module also provides template scripts for ==post-deployment== and pre-undeployment action. After deployment or before undeployment via connect service completed, customized actions can be performed based on users' needs.

## Getting Started

These instructions will get you up and running on your local machine for development and testing purposes.
Please run following npm commands under `processor` folder.

#### Install PSP Stripe SDK
In case SDK is provided by payment service provider for communication purpose, you can import the SDK by following commands
```
$ npm install stripe
```
#### Install dependencies
```
$ npm install
```
#### Build the application in local environment. NodeJS source codes are then generated under dist folder
```
$ npm run build
```
#### Run automation test
```
$ npm run test
```
#### Run the application in local environment. Remind that the application has been built before it runs
```
$ npm run start
```
#### Fix the code style
```
$ npm run lint:fix
```
#### Verify the code style
```
$ npm run lint
```
#### ==Run post-deploy script in local environment==
```
$ npm run connector:post-deploy
```
#### Run pre-undeploy script in local environment
```
$ npm run connector:pre-undeploy
```

## Running application

Setup correct environment variables: check `processor/src/config/config.ts` for default values.

Make sure commercetools client credential have at least the following permissions:

* `manage_payments`
* `manage_checkout_payment_intents`
* `view_sessions`
* `introspect_oauth_tokens`

```
npm run dev
```

## Authentication

Some of the services have authentication mechanism.

* `oauth2`: Relies on commercetools OAuth2 server
* `session`: Relies on commercetools session service
* `jwt`: Relies on the jwt token injected by the merchant center via the forward-to proxy

### OAuth2
OAuth2 token can be obtained from commercetools OAuth2 server. It requires API Client created beforehand. For details, please refer to [Requesting an access token using the Composable Commerce OAuth 2.0 service](https://docs.commercetools.com/api/authorization#requesting-an-access-token-using-the-composable-commerce-oauth-20-service).

### Session
Payment connectors relies on session to be able to share information between `enabler` and `processor`.
To create session before sharing information between these two modules, please execute following request to commercetools session service
```
POST https://session.<region>.commercetools.com/<commercetools-project-key>/sessions
Authorization: Bearer <oauth token with manage_sessions scope>

{
  "cart": {
    "cartRef": {
      "id": "<cart-id>" 
    }
  },
  "metadata": {
    "allowedPaymentMethods": ["card", "ideal", ...],
    "paymentInterface"?: "<payment interface that will be set on payment method info https://docs.commercetools.com/api/projects/payments#ctp:api:type:PaymentMethodInfo>"
  }
}
```

Afterwards, session ID can be obtained from response, which is necessary to be put as `x-session-id` inside request header when sending request to endpoints such as `/operations/config` and `/operations/payments`.

### JSON web token (JWT)

`jwt` needs some workaround to be able to test locally as it depends on the merchant center forward-to proxy.

In order to make easy running the application locally, following commands help to build up a jwt mock server:

####Set environment variable to point to the jwksUrl
```
export CTP_JWKS_URL="http://localhost:9000/jwt/.well-known/jwks.json"
```
####Run the jwt server
```
docker compose up -d
```

####Obtain JWT
```
# Request token
curl --location 'http://localhost:9000/jwt/token' \
--header 'Content-Type: application/json' \
--data '{
    "iss": "https://mc-api.europe-west1.gcp.commercetools.com",
    "sub": "subject",
    "https://mc-api.europe-west1.gcp.commercetools.com/claims/project_key": "<commercetools-project-key>"
}'
```
Token can be found in response
```
{"token":"<token>"}
```

Use the token to authenticate requests protected by JWT: `Authorization: Bearer <token>`.

## APIs
The processor exposes the following endpoints to execute various operations with the Stripe platform:

### Collect Payment and Appearance Details
This endpoint retrieves the payment information from the cart in session to use the prebuilt Stripe Payment Element UI component. This component simplifies the payment process for a variety of payment methods. The `paymentComponent` is requested in the query parameters to send the correct appearance from the environment variables configuration.

#### Endpoint
`GET /get-config-element/:paymentComponent`

#### Query Parameters
-**paymentComponent**: Used to retrieve the correct appearance of the selected payment method. The appearance can be modified in the environment variables `STRIPE_APPEARANCE_PAYMENT_ELEMENT` or `STRIPE_APPEARANCE_EXPRESS_CHECKOUT`and should be in the form of a JSON string with escaped double quotes (e.g. "{\"theme\":\"stripe\",\"variables\":{\"colorPrimary\":\"#0570DE\",\"colorBackground\":\"#FFFFFF\",\"colorText\":\"#30313D\",\"colorDanger\":\"#DF1B41\",\"fontFamily\":\"Ideal Sans,system-ui,sansserif\",\"spacingUnit\":\"2px\",\"borderRadius\":\"4px\"}}"). The correct values will be retrieved by the exposed call ´operations/payment-components´, e.g., 'payment' or 'expressCheckout'.

#### Response Parameters
The response will provide the necessary information to populate the payment element:
- **cartInfo**: An object containing two attributes:
    - `amount`: Amount in cents for the cart in session.
    - `currency`: Currency selected for the cart in session.
- **appearance**: Optional. Used to customize or theme the payment element rendered by Stripe's prebuilt UI component. It must be a valid [Element Appearance](https://docs.stripe.com/elements/appearance-api).

### Create Payment Intent from Stripe
This endpoint creates a new [payment intent](https://docs.stripe.com/api/payment_intents) in Stripe. It is called after the user fills out all the payment information and submits the payment. This is an example of a Website rendering the payment component selected from the enabler and when is the payment intent created on Stripe.
![sequence_diagram.png](..%2Fdocs%2Fsequence_diagram.png)
#### Endpoint
`POST /payments`

#### Request Parameters
There are no request parameters for this endpoint.

#### Response Parameters
- **clientSecret**: The client secret can be used to complete the payment from your frontend. This value is essential for handling the payment on the client side, especially for confirming the payment intent and managing any required authentication steps.

### Webhook Listener
The webhook listener receives events from your Stripe account as they occur, allowing your integration to automatically execute actions accordingly. By registering webhook endpoints in your Stripe account, you enable Stripe to send [Event objects](https://docs.stripe.com/api/events) as part of POST requests to the registered webhook endpoint hosted by your application. More details about this configuration can be found in the configuration section.

#### Endpoint
`POST /stripe/webhooks`

#### Request Parameters
The [Event object](https://docs.stripe.com/api/events) sent to your webhook endpoint provides a snapshot of the object that changed. These objects might include a `previous_attributes` property indicating the change, when applicable. This event is received as a raw string because Stripe requires the raw body of the request for signature verification.

#### Response Parameters
The endpoint returns a 200 response to indicate the successful processing of the webhook event.


### Get supported payment components
Private endpoint protected by JSON Web Token that exposes the payment methods supported by the connector so that checkout application can retrieve the available payment components.
#### Endpoint
`GET /operations/payment-components`

#### Request Parameters
N/A

#### Response Parameters
Now the connector supports payment methods such as [Payment element](https://docs.stripe.com/payments/payment-element) and [Express Checkout Element](https://docs.stripe.com/elements/express-checkout-element)
```
{
    components: [
        {
          type: 'payment',
        },
        {
          type: 'expressCheckout',
        },
    ],
}
```

### Get config
Exposes configuration to the frontend such as `clientKey` and `environment`.
#### Endpoint
`GET /operations/config`

#### Request Parameters
N/A

#### Response Parameters
It returns an object with `clientKey` and `environment` as key-value pair as below:
```
{
  clientKey: <clientKey>,
  environment: <environment>,
}
```


### Get status
It provides health check feature for checkout front-end so that the correctness of configurations can be verified.
#### Endpoint
`GET /operations/status`

#### Request Parameters
N/A

#### Response Parameters
It returns following attributes in response:
- status: It indicates the health check status. It can be `OK`, `Partially Available` or `Unavailable`
- timestamp: The timestamp of the status request
- version: Current version of the payment connector.
- checks: List of health check result details. It contains health check result with various external system including commercetools composable commerce and Stripe payment services provider.
```
    [ 
        {
            name: <name of external system>
            status: <status with indicator UP or DOWN>
            details: <additional information for connection checking>
        }
    ]
```
- metadata: It lists a collection of metadata including the name/description of the connector and the version of SDKs used to connect to external system.
### Modify payment
Private endpoint called by Checkout frontend to support various payment update requests such as cancel/refund/capture payment. It is protected by `manage_checkout_payment_intents` access right of composable commerce OAuth2 token.
#### Endpoint
`POST /operations/payment-intents/{paymentsId}`

#### Request Parameters
The request payload is different based on different update operations:
- Cancel Payment

```
{
    actions: [{
        action: "cancelPayment",
    }]
}
```

- Capture Payment
    - centAmount: Amount in the smallest indivisible unit of a currency. For example, 5 EUR is specified as 500 while 5 JPY is specified as 5.
    - currencyCode: Currency code compliant to [ISO 4217](https://en.wikipedia.org/wiki/ISO_4217)

    ```
    {
        actions: [{
            action: "capturePayment",
            amount: {
                centAmount: <amount>,
                currencyCode: <currecy code>
            }
        }]
    } 
    ```

- Refund Payment
    - centAmount: Amount in the smallest indivisible unit of a currency. For example, 5 EUR is specified as 500 while 5 JPY is specified as 5.
    - currencyCode: Currency code compliant to [ISO 4217](https://en.wikipedia.org/wiki/ISO_4217)

    ```
    {
        actions: [{
            action: "refundPayment",
            amount: {
                centAmount: <amount>,
                currencyCode: <currecy code>
            }
        }]
    } 
    ```

#### Response Parameters
```
{
    outcome: "approved|rejected|received"
}

```
