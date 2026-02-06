# Payment Integration Enabler
This module provides an application based on [commercetools Connect](https://docs.commercetools.com/connect), which acts a wrapper implementation to cover frontend components provided by Payment Service Providers (PSPs)

PSPs provide libraries that can be used on client side to load on browser or other user agent which securely load DOM elements for payment methods and/or payment fields inputs. These libraries take control on saving PAN data of customer and reduce PCI scopes of the seller implementation. Now, with the usage of `enabler`, it allows the control to checkout product on when and how to load the `enabler` as connector UI based on business configuration. In cases connector is used directly and not through Checkout product, this connector UI can be loaded directly on frontend than the libraries provided by PSPs.

## Creating Components for Payment Elements or Express Checkout

To integrate the Stripe Composable connector with commercetools and utilize the Stripe payment elements or express checkout, follow these steps:

### 1. **Load the Stripe Enabler**
Use the provided enabler URL from the Stripe Composable Connector information page.
```javascript
const Enabler = await import(process.env.REACT_APP_ENABLER_BUILD_URL);
```
### 2. **Initialize the Payment Component**
Create a new Enabler instance and specify the `paymentElementType` parameter to configure the component type, either **Payment Element:'paymentElement'** or **Express Checkout:'expressCheckout**.
```javascript

#### Basic Example
```javascript
const enabler = new Enabler({
    processorUrl: COMMERCETOOLS_PROCESSOR_URL, // Backend processor URL (required)
    sessionId: SESSION_ID,                    // Commercetools session ID (required)
    onComplete: ({ isSuccess, paymentReference, paymentIntent }) => {
        // Callback for completion
        // isSuccess: boolean indicating payment success
        // paymentReference: string with payment reference (when successful)
        // paymentIntent: string with payment intent ID (when successful)
        console.log('Payment completed', { isSuccess, paymentReference, paymentIntent });
    },
    onError: (err) => {
        // Callback for error handling
        console.error('Payment error', err);
    },
    paymentElementType: type,                 // Component type: 'paymentElement' or 'expressCheckout'
});

const builder = await enabler.createDropinBuilder('embedded');
const component = await builder.build({
   showPayButton: !builder.componentHasSubmit,
});

component.mount("#payment"); // Selector where the component will be mounted
```

#### Enabler Options

The Enabler constructor accepts the following options:

- **`processorUrl`** (required): The URL of the backend payment processor
- **`sessionId`** (required): The commercetools session ID for the payment
- **`locale`** (optional): The locale for the payment (e.g., 'en-US', 'es-ES')
- **`onActionRequired`** (optional): Callback function called when additional action is required during payment (e.g., 3D Secure authentication)
- **`onComplete`** (optional): Callback function called when payment is completed. Receives a `PaymentResult` object:
  - `isSuccess: true` - Payment succeeded: includes `paymentReference` and `paymentIntent`
  - `isSuccess: false` - Payment failed: no additional properties
- **`onError`** (optional): Callback function called when an error occurs during payment processing
- **`paymentElementType`** (optional): Type of payment component to create: `'paymentElement'` or `'expressCheckout'`
- **`stripeCustomerId`** (optional): The Stripe customer ID if you want to associate the payment with an existing Stripe customer
- **`stripeConfig`** (optional): Frontend configuration override for Stripe Elements and PaymentIntent (see [stripeConfig section](#stripeconfig-option) below)

#### Example with All Options
```javascript
const enabler = new Enabler({
    processorUrl: COMMERCETOOLS_PROCESSOR_URL,
    sessionId: SESSION_ID,
    locale: 'en-US',                          // Optional locale
    onActionRequired: async () => {
        // Optional callback when action is required (e.g., 3D Secure)
        console.log('Action required for payment');
    },
    onComplete: ({ isSuccess, paymentReference, paymentIntent }) => {
        if (isSuccess) {
            console.log('Payment succeeded', { paymentReference, paymentIntent });
        } else {
            console.log('Payment failed');
        }
    },
    onError: (err) => {
        console.error('Payment error', err);
    },
    paymentElementType: 'paymentElement',      // or 'expressCheckout'
    stripeCustomerId: 'cus_Example',          // Optional Stripe customer ID
    stripeConfig: {                            // Optional frontend configuration override
        elements: {
            appearance: {
                theme: 'night',
                variables: { colorPrimary: '#7c3aed' },
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
```

### 3. **Create and Mount the Component**

After creating the Enabler instance, you can create either a drop-in builder or a component builder:

#### Using createDropinBuilder (Recommended)
```javascript
const builder = await enabler.createDropinBuilder('embedded');
const component = await builder.build({
    showPayButton: !builder.componentHasSubmit,
});
component.mount("#payment");
```

The `createDropinBuilder` method accepts the following types:
- **`'embedded'`**: Renders the payment component within your page (recommended)
- **`'hpp'`**: Redirects to a hosted payment page

#### Using createComponentBuilder
```javascript
const builder = await enabler.createComponentBuilder('card');
const component = builder.build({
    showPayButton: false,
});
component.mount("#card-component");
```

### stripeConfig Option

The `stripeConfig` option allows you to override backend configuration from the frontend, providing per-implementation customization without requiring backend changes. This is particularly useful for:

- **Customizing Appearance**: Override the backend appearance configuration (`STRIPE_APPEARANCE_PAYMENT_ELEMENT` or `STRIPE_APPEARANCE_EXPRESS_CHECKOUT`) for specific implementations
- **Layout Customization**: Adjust the payment element layout (`STRIPE_LAYOUT`) per use case (accordion, tabs)
- **Payment Method Options**: Configure payment method-specific options such as PIX expiration times, Boleto settings, or multicapture configurations
- **Billing Address Collection**: Control how billing addresses are collected (`STRIPE_COLLECT_BILLING_ADDRESS`) per implementation

#### stripeConfig Structure

```javascript
stripeConfig: {
    elements?: {
        appearance?: Appearance,              // Overrides backend appearance config
        layout?: LayoutObject,                // Overrides STRIPE_LAYOUT
        collectBillingAddress?: 'auto' | 'never' | 'if_required'  // Overrides STRIPE_COLLECT_BILLING_ADDRESS
    },
    paymentIntent?: {
        paymentMethodOptions?: Record<string, Record<string, unknown>>  // Payment method-specific options
    }
}
```

#### Example: Payment Method Options
```javascript
const enabler = new Enabler({
    processorUrl: COMMERCETOOLS_PROCESSOR_URL,
    sessionId: SESSION_ID,
    paymentElementType: 'paymentElement',
    stripeConfig: {
        paymentIntent: {
            paymentMethodOptions: {
                pix: {
                    expires_after_seconds: 3600,  // PIX expiration in seconds
                },
                boleto: {
                    expires_after_days: 15,       // Boleto expiration in days
                },
            },
        },
    },
});
```

**Note**: When `stripeConfig` is provided, frontend configuration takes precedence over backend environment variables. If a property is not specified in `stripeConfig`, the backend configuration is used as fallback.

### PaymentResult Structure

The `onComplete` callback receives a `PaymentResult` object with the following structure:

**Success Case:**
```typescript
{
    isSuccess: true,
    paymentReference: string,    // Payment reference from commercetools
    paymentIntent: string       // Stripe payment intent ID
}
```

**Failure Case:**
```typescript
{
    isSuccess: false
}
```

Replace the placeholder variables (`COMMERCETOOLS_PROCESSOR_URL`, `SESSION_ID`, `onComplete`, `onError`, and `type`) with appropriate values based on your application configuration.

## Considerations for Apple Pay and Google Pay

### Apple Pay Requirements
To enable Apple Pay, you must ensure the following conditions are satisfied:

1. The website must include a `https://www.website.com/.well-known/apple-developer-merchantid-domain-association` call that redirects to:
   ```text
   {COMMERCETOOLS_PROCESSOR_URL}/applePayConfig
   ```
   This endpoint retrieves the required merchant ID domain association file declared in the installation configuration `STRIPE_APPLE_PAY_WELL_KNOWN`. For more details, refer to Stripe’s official [Apple Pay domain association documentation](https://support.stripe.com/questions/enable-apple-pay-on-your-stripe-account).

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


## Getting Started
Please run following npm commands under `enabler` folder for development work in local environment.

#### Install dependencies
```
$ npm install
```
#### Build the application in local environment. NodeJS source codes are then generated under public folder
```
$ npm run build
```
#### Build development site in local environment. The location of the site is http://127.0.0.1:3000/
```
$ npm run dev
```
