# Payment Integration Processor
This module provides an application based on [commercetools Connect](https://docs.commercetools.com/connect), which is triggered by HTTP requests from Checkout UI for payment operations.

The corresponding payment, cart or order details would be fetched from composable commerce platform, and then be sent to Stripe for various payment operations such as create/capture/cancel/refund payment.

The module also provides template scripts for post-deployment and pre-undeployment action. After deployment or before undeployment via connect service completed, customized actions can be performed based on users' needs.

## Considerations For Stripe Customer Session

The Stripe customer session allows you to create a session for a customer, which can be used to manage their payment methods and subscriptions. This feature is particularly useful for businesses that want to provide a seamless checkout experience for their customers.

The Stripe customer session is associated with the customer who owns the cart in the commercetools Checkout session. The cart must have the `customerId` associated to retrieve and verify if the customer has a Type with the custom field `stripeConnector_stripeCustomerId`. If the Type does not have this field, the connector will create the field to store the Stripe customer ID.

If the `stripeConnector_stripeCustomerId` is presented, the connector will try to retrieve the Stripe customer, if the customer does not exist on Stripe, the connector will create a new customer in Stripe using the customer who owns the cart in the session. The commercetools customer ID will be stored in the metadata of the Stripe customer and the `stripeConnector_stripeCustomerId` field in commercetools will be updated with the Stripe customer ID.

The environment variable `STRIPE_SAVED_PAYMENT_METHODS_CONFIG` configures the saved payment methods. The value needs to be a valid stringified JSON. More information about the properties can be found [here](https://docs.stripe.com/api/customer_sessions/object#customer_session_object-components-payment_element-features). This feature is disabled by default.

Diagram of the current workflow:
![Stripe Customer Workflow.png](../docs/StripeCustomerWorkflow.png)


## Considerations For Stripe Billing Subscription Management

The connector supports Stripe subscription management capabilities, enabling recurring billing solutions that integrate seamlessly with commercetools customers. Subscriptions allow merchants to charge customers on a recurring basis for products or services according to defined billing intervals and payment terms.

The connector will automatically create and use a Setup Intent when required for subscription payments. A Setup Intent confirms and securely stores payment method details without immediately creating a charge, which is essential for recurring billing scenarios where the initial payment might be delayed (such as with free trial periods) or when setting up automatic payments for future subscription cycles.

### Subscription Shipping Fee Support

The connector now supports recurring shipping fees as part of subscription billing. When a cart contains shipping information, the connector will:

1. **Automatically detect shipping methods** in the cart during subscription creation
2. **Create or retrieve Stripe shipping prices** that match the subscription's billing interval
3. **Include shipping fees** as separate line items in the subscription
4. **Handle shipping price management** with proper metadata tracking

#### Shipping Fee Integration Features

- **Automatic Shipping Price Creation**: Creates Stripe prices for shipping methods that don't already exist
- **Recurring Billing Alignment**: Ensures shipping fees follow the same billing interval as the main subscription
- **Metadata Tracking**: Tracks shipping method IDs and amounts for proper reconciliation
- **Existing Price Reuse**: Reuses existing Stripe shipping prices when they match the current configuration

#### Shipping Price Management

The connector manages shipping prices through several new methods:

- `getSubscriptionShippingPriceId()`: Retrieves or creates shipping price IDs for subscriptions
- `getStripeShippingPriceByMetadata()`: Searches for existing shipping prices by metadata
- `createStripeShippingPrice()`: Creates new Stripe prices for shipping methods

#### Metadata Fields for Shipping

The following metadata fields are used to track shipping information:

- `ct_variant_sku`: Stores the shipping method ID
- `ct_shipping_price_amount`: Stores the shipping price amount in cents

### Custom Types for Subscription Configuration

The connector creates and uses specific custom types to enable subscription management. Depending on the subscription information added in the custom type, three distinct payment flows are identified:

1. **payment**: When no subscription fields are present, the connector creates a normal payment intent.
2. **subscription**: When subscription information is present and immediate payment is required, a subscription is created directly.
3. **setupIntent**: When subscription information indicates a future payment (like with trial periods), a setup intent is created first to securely store payment details without immediate charge.

The payment flow is automatically determined based on the subscription information in the product's custom type. The endpoint `/config-element/:payment` returns the `paymentMode` attribute with the appropriate value ("payment", "subscription", or "setupIntent") indicating which flow the product will follow.

The configuration of subscription products is done through a custom product type called `payment-connector-subscription-information`.
This type is applied to product variants to define the parameters for subscription management. The following fields are used to configure the subscription:

1. **payment-connector-subscription-information**: This custom product type is applied to product variants to configure subscription parameters including:
   - `stripeConnector_description`: A description for the subscription
   - `stripeConnector_recurring_interval`: Defines the billing frequency ('day', 'week', 'month', 'year')
   - `stripeConnector_recurring_interval_count`: Specifies the number of intervals between billings
   - `stripeConnector_off_session`: Whether the subscription can be used off-session
   - `stripeConnector_collection_method`: Payment collection method ('charge_automatically' or 'send_invoice')
   - `stripeConnector_days_until_due`: Optional number of days before the invoice is due (only applies when collection method is 'send_invoice')
   - `stripeConnector_cancel_at_period_end`: Optional flag to cancel at the end of the current period
   - `stripeConnector_cancel_at`: Optional specific date and time to cancel the subscription
   - `stripeConnector_billing_cycle_anchor_day`: Optional day of the month for billing
   - `stripeConnector_billing_cycle_anchor_time`: Optional time of day for billing
   - `stripeConnector_billing_cycle_anchor_date`: Optional specific date and time for billing anchor
   - `stripeConnector_trial_period_days`: Optional trial period length in days
   - `stripeConnector_trial_end_date`: Optional specific date and time for trial end
   - `stripeConnector_missing_payment_method_at_trial_end`: Optional behavior when payment method is missing at trial end ('cancel', 'create_invoice', or 'pause')
   - `stripeConnector_proration_behavior`: Optional behavior for proration when making changes ('none', 'create_prorations', or 'always_invoice')

> **Note**: All subscription-related attributes now use the `stripeConnector_` prefix for better organization and consistency. The system automatically handles the mapping between these prefixed attribute names and the internal field names used by the subscription service.

Products marked with this type are automatically processed as subscription items during checkout, creating recurring billing arrangements in Stripe when purchased.

### Attribute Name Transformation

The connector automatically handles the transformation between the `stripeConnector_` prefixed attribute names used in the product type and the internal field names used by the subscription service. This transformation is handled by the `transformVariantAttributes` utility function.

#### How It Works

1. **Product Type Definition**: Attributes are defined with the `stripeConnector_` prefix in the custom product type
2. **Automatic Transformation**: When processing subscription data, the `transformVariantAttributes` function automatically strips the `stripeConnector_` prefix
3. **Internal Processing**: The subscription service receives the clean field names for processing
4. **Backward Compatibility**: The system supports both prefixed and non-prefixed attribute names

#### Example Transformation

```typescript
// Product type attributes (with prefix)
{
  stripeConnector_description: "Monthly subscription",
  stripeConnector_recurring_interval: "month",
  stripeConnector_off_session: true
}

// Transformed to internal format (prefix removed)
{
  description: "Monthly subscription",
  recurring_interval: "month", 
  off_session: true
}
```

This transformation ensures clean separation between the commercetools product type schema and the internal subscription processing logic while maintaining backward compatibility.

## Enhanced Error Handling with Payment Intent Status

The connector now provides comprehensive error handling for various payment intent statuses, ensuring better user experience and debugging capabilities.

### Payment Intent Status Handling

- **`requires_action` Status**: Properly handles payment intents that require additional authentication or action from the customer
- **`payment_failed` Status**: Enhanced error handling for failed payments with detailed error information
- **Structured Error Objects**: Error objects now include additional context such as `next_action` and `last_payment_error` for better debugging

### Error Management Features

- **Detailed Error Messages**: More informative error messages for different payment scenarios
- **Error Type Classification**: Errors are categorized by type (`requires_action`, `payment_failed`) for better handling
- **Enhanced Debugging**: Structured error objects provide additional context for troubleshooting

### Technical Implementation

The enhanced error handling is implemented in the enabler's `stripe-service.ts`:

```typescript
if (paymentIntent.status === "requires_action") {
  const error: any = new Error("Payment requires additional action");
  error.type = "requires_action";
  error.next_action = paymentIntent.next_action;
  throw error;
}

if(paymentIntent.last_payment_error) {
  const error: any = new Error(`${paymentIntent.last_payment_error.message}`);
  error.type = "payment_failed";
  error.last_payment_error = paymentIntent.last_payment_error;
  throw error;
}
```

## Mixed Cart Support

The connector now supports mixed carts containing both subscription items and one-time items. This feature allows customers to purchase subscription products alongside regular products in a single transaction, with automatic handling of different billing scenarios.

#### How Mixed Cart Support Works

1. **Cart Analysis**: The system automatically analyzes the cart to identify subscription items and one-time items
2. **Separate Processing**: Subscription items are processed as recurring billing, while one-time items are processed as immediate invoices
3. **Invoice Creation**: One-time items are automatically converted to separate Stripe invoices for immediate payment
4. **Subscription Creation**: Subscription items are processed normally with recurring billing setup
5. **Unified Experience**: Customers experience a seamless checkout process regardless of cart composition

#### Mixed Cart Processing Flow

```
Cart with Mixed Items
├── Subscription Items → Stripe Subscription (recurring billing)
└── One-Time Items → Stripe Invoice (immediate payment)
```

#### Key Features

- **Automatic Item Classification**: The system automatically identifies subscription vs. one-time items based on product type
- **Separate Invoice Creation**: One-time items are processed as separate invoices with proper metadata tracking
- **Quantity Support**: Proper handling of item quantities for both subscription and one-time items
- **Error Handling**: Enhanced error handling for scenarios where no subscription product is found
- **Metadata Tracking**: Comprehensive metadata tracking for both subscription and invoice items


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

Make sure commercetools client credentials have at least the following permissions:

* `manage_payments`
* `manage_checkout_payment_intents`
* `view_sessions`
* `introspect_oauth_tokens`
* 'view_api_clients'
* 'manage_orders'
* 'manage_types'

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
Payment connectors rely on session to be able to share information between `enabler` and `processor`.
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

Afterwards, session ID can be obtained from the response, which is necessary to be put as `x-session-id` inside the request header when sending requests to endpoints such as `/operations/config` and `/operations/payments`.

### JSON web token (JWT)

`jwt` needs some workaround to be able to test locally as it depends on the merchant center forward-to proxy.

In order to make it easy to run the application locally, the following commands help to build up a jwt mock server:

#### Set environment variable to point to the jwksUrl
```
export CTP_JWKS_URL="http://localhost:9000/jwt/.well-known/jwks.json"
```
#### Run the jwt server
```
docker compose up -d
```

#### Obtain JWT
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

### Merchant Return URL

The `MERCHANT_RETURN_URL` plays a key role during the payment confirmation process using [confirmPayment](https://docs.stripe.com/js/payment_intents/confirm_payment). This URL is used as the `return_url` parameter in the confirmation step.

For **Buy Now Pay Later (BNPL)** payment methods, Stripe appends the `payment_intent` to the return URL after the payment process is completed. Upon redirection to the merchant's site, the following steps are necessary to ensure proper integration with commercetools Checkout SDK:

1. Retrieve the `payment_intent` from the URL parameters.
2. Extract the `ct_payment_id` from the `payment_intent` metadata.
3. Use the `ct_payment_id` to update the `paymentReference` in the commercetools Checkout SDK to properly link the payment.

By implementing this workflow, seamless integration of BNPL payment methods with commercetools Checkout is achieved.

## APIs
The processor exposes the following endpoints to execute various operations with the Stripe platform:

### Configurations of collecting payment, appearance and future usage
This endpoint retrieves the payment information from the cart in session to use the prebuilt Stripe Payment Element UI component. This component simplifies the payment process for a variety of payment methods. The `paymentComponent` is requested in the query parameters to send the correct appearance from the environment variables configuration.

#### Endpoint
`GET /config-element/:payment`

#### Query Parameters
-**payment**: Used to retrieve the correct appearance of the selected payment method. The appearance can be modified in the environment variables `STRIPE_APPEARANCE_PAYMENT_ELEMENT` and should be in the form of a JSON string with escaped double quotes (e.g. {"theme":"night","labels":"floating"} ). The correct values will be retrieved by the exposed call ´operations/payment-components´, e.g., 'payment'.

#### Response Parameters
The response will provide the necessary information to populate the payment element:
- **cartInfo**: An object containing two attributes:
  - `amount`: Amount in cents for the cart in session.
  - `currency`: Currency selected for the cart in session.
- **appearance**: Optional. Used to customize or theme the payment element rendered by Stripe's prebuilt UI component. It must be a valid [Element Appearance](https://docs.stripe.com/elements/appearance-api).
- **captureMethod**: The current capture method configured in the payment connector.
- **setupFutureUsage**: The current setup future usage configured in the payment connector.[More information](https://docs.stripe.com/api/customer_sessions/object#customer_session_object-components-payment_element-features).
- **layout**: This configuration enables the Layout for the payment component. The value needs to be a valid stringified JSON. [More information](https://docs.stripe.com/payments/payment-element#layout).
- **collectBillingAddress**: This configuration enables the collection of billing address for the Stripe Payment Element component. The default value is 'auto'. [More information](https://docs.stripe.com/payments/payment-element#collecting-billing-address).
# add to the response the attribute: webElements that can be paymentElement or expressCheckout
- **webElements**: The web elements that can be used in the payment component. It can be `paymentElement` or `expressCheckout`. This is used to determine which payment element to render in the frontend.
- **paymentMode**: The payment mode used in the payment component. It can be `subscription`, `setup`, or `payment`. This is used to determine the flow that the payment needs to follow. [More information](https://docs.stripe.com/payments/payment-element#payment-mode).

### Create Payment Intent from Stripe
This endpoint creates a new [payment intent](https://docs.stripe.com/api/payment_intents) in Stripe. It is called after the user fills out all the payment information and submits the payment. 
#### Endpoint
`GET /payments`

#### Query Parameters
N/A

#### Response Parameters
- **clientSecret**: The client secret is used to complete the payment from your frontend. 
- **paymentReference**: The payment reference of the current process (optional).
- **merchantReturnUrl**: The URL used as the `return_url` parameter in Stripe's [confirmPayment](https://docs.stripe.com/js/payment_intents/confirm_payment) process. After the payment confirmation, Stripe appends the `paymentReference` and `cartId` as query parameters to this URL. For Buy Now, Pay Later (BNPL) payment methods, this URL can be used to reinitialize the commercetools Checkout SDK.
- **cartId**: The cartId of the current process.
- **billingAddress**: The billing address provided by the merchant, which will be sent to Stripe during the `confirmPayment` process (optional).

### Confirm the Payment Intent to commercetools

This endpoint creates a new [payment intent](https://docs.stripe.com/api/payment_intents) or [subscription](https://docs.stripe.com/api/subscriptions) in Stripe. It is called after the user fills out all the payment information and submits the payment. If the Cart contains a product that has a type of Subscription it will proceed with the subscription payment, if not it will create a normal payment intent.

#### Endpoint

`POST /confirmPayments/:id`

#### Query Parameters

- **id**: The payment reference of the current process.

#### Response Parameters

- **outcome:"approved|rejected"**: The response of the updated confirmation in commercetools payment transaction.

#### Diagram of the current Payment flow

![Stripe Customer Workflow.png](../docs/StripeSubscriptionWorkflow.png)

### Webhook Listener

The webhook listener receives events from your Stripe account as they occur, allowing your integration to automatically execute actions accordingly. By registering webhook endpoints in your Stripe account, you enable Stripe to send [Event objects](https://docs.stripe.com/api/events) as part of POST requests to the registered webhook endpoint hosted by your application.
The available webhooks are configured on the `post-deploy.ts` file, and more webhook event can be added in the method `updateWebhookEndpoint`.
The conversion of the Payment webhook event to a transaction is converted in the `/src/services/converters/stripeEventConverter.ts` file.
The conversion of the Subscription webhook event to a transaction is converted in the `/src/services/converters/subscriptionEventConverter.ts` file.

The following webhooks currently supported and transformed to different payment transactions in commercetools are:

- **payment_intent.canceled**: Modified the payment transaction Authorization to Failure and create a payment transaction CancelAuthorization: Success
- **payment_intent.succeeded**: Creates a payment transaction Charge: Success. Create the order from the cart that has the payment referenced.
- **payment_intent.requires_action**: Logs the information in the connector app inside the Processor logs.
- **payment_intent.payment_failed**: Modify the payment transaction Authorization to Failure.
- **charge.refunded**: Create a payment transaction Refund to Success, and a Chargeback to Success.
- **charge.succeeded**: If the charge is not captured, create the payment transaction to Authorization:Success and update the payment method type that was used to pay.
- **charge.captured**: Logs the information in the connector app inside the Processor logs.
- **invoice.paid**: Processes subscription payments when invoices are paid.
- **invoice.payment_failed**: Handles failed subscription payments.

Additionally, the webhook handler identifies subscription invoice-related events and processes them separately from regular payment events.


### Order Creation

The order is created during the processing of the `payment_intent.succeeded` webhook. Before creating the order, the cart must include shipment information.

Note: If the cart does not have shipment information, the order creation will fail. The connector does not handle the case where the cart is missing shipment information.

#### Endpoint
`POST /stripe/webhooks`

#### Request Parameters
The [Event object](https://docs.stripe.com/api/events) sent to your webhook endpoint provides a snapshot of the object that changed. These objects might include a `previous_attributes` property indicating the change, when applicable. This event is received as a raw string because Stripe requires the raw body of the request for signature verification.

#### Response Parameters
The endpoint returns a 200 response to indicate the successful processing of the webhook event.

### Apple pay well-known file
This endpoint returns the string of the .well-known call domain [file from Stripe](https://stripe.com/files/apple-pay/apple-developer-merchantid-domain-association).

#### Endpoint
`GET /applePayConfig`

#### Query Parameters
N/A

#### Response Parameters
- **string**: The string value of the well-know domain file.

### Stripe customer session
Stripe customer session is used to manage the payment methods and subscriptions of a customer. This endpoint creates a new customer session in Stripe. It is called after the user fills out all the payment information and submits the payment. [More information](#considerations-for-stripe-customer-session). 

#### Endpoint
`GET /customer/session`

#### Query Parameters
- **stripeCustomerId** (optional): The ID of the customer in Stripe. If provided, the system will use this ID to retrieve or create a session.

#### Response Parameters
- **stripeCustomerId**: The ID of the customer in Stripe used for the session.
- **ephemeralKey**: The ephemeral key used to access the Stripe customer session.
- **sessionId**: The ID of the customer session in Stripe.

The endpoint returns a 204 No Content status if no customer session data is available.

### Get supported payment components
Private endpoint protected by JSON Web Token that exposes the payment methods supported by the connector so that checkout application can retrieve the available payment components.

#### Endpoint
`GET /operations/payment-components`

#### Request Parameters
N/A

#### Response Parameters
The connector supports payment methods such as [Payment element](https://docs.stripe.com/payments/payment-element) embedded as a drop-in 

```
{
    dropins: [
        {
          type: 'embedded',
        },
    ],
    components: [],
}
```

### Get config
Exposes configuration to the frontend such as `publishableKey` and `environment`.

#### Endpoint
`GET /operations/config`

#### Request Parameters
N/A

#### Response Parameters
It returns an object with `publishableKey` and `environment` as key-value pair as below:
```
{
  environment: <environment>,
  publishableKey: <publishableKey>,
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
- message: Indicates the message.
- timestamp: The timestamp of the status request
- version: Current version of the payment connector.
- checks: List of health check result details. It contains health check result with various external system including commercetools composable commerce and Stripe payment services provider.
```
    [ 
        {
            name: <name of external system>,
            status: <status with indicator UP or DOWN>,
            message: <message>,
            details: <additional information for connection checking>,
        }
    ]
```
- metadata: It lists a collection of metadata including the name/description of the connector and the version of SDKs used to connect to external system.

### Modify payment
Private endpoint called by Checkout frontend to support various payment update requests such as cancel/refund/capture payment. It is protected by `manage_checkout_payment_intents` access right of composable commerce OAuth2 token. This endpoint implements the [commercetools Payment Intents API](https://docs.commercetools.com/checkout/payment-intents-api).

#### Endpoint
`POST /operations/payment-intents/{paymentsId}`

#### Request Parameters
- **paymentsId**: The ID of the payment to modify

#### Request Body
```
{
  "actions": [
    {
      "action": "capturePayment", // or "refundPayment" or "cancelPayment"
      "amount": { // required for capturePayment and refundPayment
        "centAmount": 1000,
        "currencyCode": "USD"
      }
    }
  ],
  "merchantReference": "optional-reference" // Optional
}
```
The actions array must contain exactly one action of the following types:
- **capturePayment**: Captures an authorized payment with the specified amount
- **refundPayment**: Issues a refund for a captured payment with the specified amount
- **cancelPayment**: Cancels an authorized payment

#### Response Parameters
- **outcome**: The result of the payment modification. Possible values:
   - `approved`: The modification was successful
   - `rejected`: The modification was rejected
   - `received`: The modification was received but is being processed
- **error**: Optional error message if the modification failed

### Stripe Subscription Management

The connector provides several API endpoints for managing Stripe subscriptions, which allow customers to subscribe to recurring billing products or services.

#### Create Setup Intent for Subscriptions
Sets up a payment method for future subscription use, without immediately charging the customer.

##### Endpoint
`POST /setupIntent`

##### Authentication
Session authentication required.

##### Response Parameters
- **clientSecret**: The client secret used to complete the setup from your frontend.
- **merchantReturnUrl**: The URL to return to after setup completion.
- **billingAddress**: Optional billing address information.

#### Create Subscription
Creates a new subscription in Stripe based on subscription products in the cart.

##### Endpoint
`POST /subscription`

##### Authentication
Session authentication required.

##### Response Parameters
- **subscriptionId**: The ID of the created subscription.
- **clientSecret**: The client secret used to confirm the subscription payment.
- **paymentReference**: The payment reference created in commercetools.
- **merchantReturnUrl**: The URL to return to after subscription confirmation.
- **cartId**: The ID of the associated cart.
- **billingAddress**: Optional billing address information.

#### Create Subscription with Setup Intent
Creates a subscription using a previously created Setup Intent.

##### Endpoint
`POST /subscription/withSetupIntent`

##### Authentication
Session authentication required.

##### Request Body
- **setupIntentId**: The ID of the previously created Setup Intent.

##### Response Parameters
- **subscriptionId**: The ID of the created subscription.
- **paymentReference**: The payment reference created in commercetools.

#### Confirm Subscription Payment
Confirms a subscription payment after all frontend steps are complete.

##### Endpoint
`POST /subscription/confirm`

##### Authentication
Session authentication required.

##### Request Body
- **subscriptionId**: The ID of the subscription to confirm.
- **paymentReference**: The payment reference in commercetools.
- **paymentIntentId**: Optional payment intent ID if applicable.

##### Response Parameters
- **outcome**: Either "approved" or "rejected" based on confirmation result.
- **error**: Error details if rejection occurred.

### Stripe Subscription Management API

This API provides endpoints for managing Stripe subscriptions within commercetools. To access these endpoints, you need a valid OAuth2 bearer token with the appropriate scopes (`manage_project` and `manage_subscriptions`). The API is accessible through the processor URL exposed by the commercetools installed connector, with the base path `/subscription-api/`. All requests must include the Authorization header with the format `Authorization: Bearer <your-oauth-token>`.

#### Get Customer Subscriptions
Retrieves all subscriptions associated with a specific customer.

##### Endpoint
`GET /subscription-api/:customerId`

##### Authentication
OAuth2 authentication with "manage_project" and "manage_subscriptions" scopes.

##### Path Parameters
- **customerId**: The commercetools customer ID.

##### Response Parameters
- **subscriptions**: Array of subscription objects.
- **error**: Optional error message if retrieval fails.

#### Cancel Customer Subscription
Cancels a specific subscription for a customer.

##### Endpoint
`DELETE /subscription-api/:customerId/:subscriptionId`

##### Authentication
OAuth2 authentication with "manage_project" and "manage_subscriptions" scopes.

##### Path Parameters
- **customerId**: The commercetools customer ID.
- **subscriptionId**: The ID of the subscription to cancel.

##### Response Parameters
- **id**: The subscription ID.
- **status**: Current status of the subscription.
- **outcome**: Result of the cancellation ("canceled" or "error").
- **message**: Optional message with details.

#### Update Customer Subscription
Updates a specific subscription with new parameters or options based on the [Stripe documentation](https://docs.stripe.com/api/subscriptions/update?lang=node).

##### Endpoint
`POST /subscription-api/:customerId`

##### Authentication
OAuth2 authentication with "manage_project" and "manage_subscriptions" scopes.

##### Path Parameters
- **customerId**: The commercetools customer ID.

##### Request Body
- **id**: The subscription ID to update.
- **params**: Optional parameters to update (Stripe.SubscriptionUpdateParams).
- **options**: Optional options to update (Stripe.RequestOptions).

##### Response Parameters
- **id**: The subscription ID.
- **status**: Current status of the subscription.
- **outcome**: Result of the update ("updated" or "error").
- **message**: Details about the update operation.

### Express Checkout methods

#### Get Shipping Methods for Cart
Retrieves the shipping methods available for a specific cart and updates the cart's shipping method by adding the new address and the first available shipping method to the cart.

##### Endpoint
`POST /shipping-methods`

##### Authentication
Cart session authentication required.

##### Request Body
- **country**: Optional country from the Express Checkout Component.
- **state**: Optional state from the Express Checkout Component.
- **city**: Optional city from the Express Checkout Component.
- **postalCode**: Optional postal code from the Express Checkout Component.

##### Response Parameters
- **shippingRates**: Array of shipping rates for the selected address.
- **lineItems**: Name and price of the selected line items and shipping cost.

#### Update Shipping Methods selected for the Cart
This endpoint updates the shipping methods selected in the Stripe Express Checkout Component and retrieves the line items and shipping cost for the selected shipping method.

##### Endpoint
`POST /shipping-methods/update`

##### Authentication
Cart session authentication required.

##### Request Body
- **id**: ID of the shipping method selected in the Express Checkout component.
- **amount**: Amount of the shipping method selected.
- **displayName**: Display name of the shipping method selected.

##### Response Parameters
- **shippingRates**: Array of shipping rates for the selected address.
- **lineItems**: Name and price of the selected line items and shipping cost.

#### Remove Shipping Methods Selected for the Cart
This endpoint is called when the user exits the Express Checkout component without completing payment. It removes the selected shipping method from the cart and returns the updated cart total amount to refresh the Stripe component.

##### Endpoint
`GET /shipping-methods/remove`

##### Authentication
Cart session authentication required.

##### Response Parameters
- **shippingRates**: Array of shipping rates for the selected address.
- **lineItems**: Name and price of the selected line items and shipping cost.
