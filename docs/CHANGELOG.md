# Changelog

## Latest

### Cart Freezing and Unfreezing for Express Checkout

**Added:**
- **Cart Protection During Payment Flow**: Carts are automatically frozen after PaymentIntent or Subscription creation to prevent modifications during the payment process
- **Temporary Cart Unfreezing for Express Checkout**: Carts are temporarily unfrozen during Express Checkout shipping operations to allow address and shipping method updates
- **Automatic Cart Re-freezing**: Carts are automatically re-frozen after Express Checkout shipping updates complete
- **Cancellation Handling**: When Express Checkout is cancelled, the cart remains unfrozen to allow users to modify the cart

**Changed:**
- **Express Checkout Shipping Methods**: `getShippingMethods()` now temporarily unfreezes frozen carts to update shipping addresses and methods
- **Express Checkout Shipping Updates**: `updateShippingRate()` now temporarily unfreezes frozen carts to update selected shipping methods
- **Express Checkout Cancellation**: `removeShippingRate()` unfreezes carts when users cancel Express Checkout, allowing cart modifications

**Technical Details:**

#### Cart Freezing Behavior
The connector implements cart freezing to protect cart integrity during payment flows:

1. **After Payment Creation**: When a PaymentIntent is created, the cart is frozen to prevent modifications (products, quantities, discounts, addresses, shipping)
2. **After Subscription Creation**: When a subscription is created, the cart is frozen to maintain consistency between commercetools and Stripe
3. **During Express Checkout**: Frozen carts are temporarily unfrozen to allow Express Checkout components to update shipping information
4. **After Express Checkout Updates**: Carts are automatically re-frozen after shipping updates complete
5. **On Cancellation**: If Express Checkout is cancelled, the cart remains unfrozen to allow user modifications

#### Express Checkout Flow
The Express Checkout shipping service handles cart state management:

```typescript
// Example: getShippingMethods flow
const wasFrozen = isCartFrozen(ctCart);
if (wasFrozen) {
  cartToUpdate = await unfreezeCart(ctCart);
  // Update shipping address and methods
  updatedCart = await updateShippingAddress(cartToUpdate, address);
  // Re-freeze after updates
  updatedCart = await freezeCart(updatedCart);
}
```

#### Benefits
- **Cart Integrity**: Prevents unauthorized or accidental cart modifications during payment processing
- **Express Checkout Compatibility**: Allows Express Checkout to update shipping information even when cart is frozen
- **User Experience**: Maintains cart state appropriately based on payment flow stage
- **Error Resilience**: Continues payment flow even if re-freezing fails, with proper error logging

#### Files Modified
- `processor/src/services/stripe-shipping.service.ts`: Added cart freezing/unfreezing logic for Express Checkout operations
- `processor/src/services/stripe-payment.service.ts`: Added cart freezing after PaymentIntent creation
- `processor/src/services/stripe-subscription.service.ts`: Added cart freezing after subscription creation
- `processor/src/services/commerce-tools/cart-client.ts`: Contains `freezeCart()`, `unfreezeCart()`, and `isCartFrozen()` utility functions

---

### Boleto Payment Handling Enhancement

**Added:**
- **Special Boleto Flow Handling**: Added special handling for Boleto payments when `paymentIntent.status === "requires_action"` with `next_action.type === "boleto_display_details"`
- **Correct Payment Completion**: Boleto payments now complete successfully when vouchers are generated, as this is the expected completion flow for Boleto payments
- **Improved Error Handling**: Other payment methods with `requires_action` status continue to follow the original error handling flow

**Technical Details:**

#### Boleto Payment Flow
For Boleto payments, when Stripe returns a payment intent with `status === "requires_action"` and `next_action.type === "boleto_display_details"`, this indicates that the voucher has been successfully generated. This is the normal completion state for Boleto payments, not an error condition.

The implementation in `enabler/src/services/stripe-service.ts`:
```typescript
if (paymentIntent.status === "requires_action") {
  // Boleto: voucher was generated successfully - this is the expected flow
  if (paymentIntent.next_action?.type === "boleto_display_details") {
    return paymentIntent;
  }

  // For all other requires_action types, follow the original flow
  const error: any = new Error("Payment requires additional action");
  error.type = "requires_action";
  error.next_action = paymentIntent.next_action;
  throw error;
}
```

#### Benefits
- **Correct Boleto Flow**: Boleto payments complete successfully when vouchers are generated
- **Better User Experience**: Users can see their Boleto vouchers without encountering errors
- **Proper Error Handling**: Other payment methods that require action still trigger appropriate error handling
- **Stripe API Compliance**: Aligns with Stripe's Boleto payment flow expectations

#### Files Modified
- `enabler/src/services/stripe-service.ts`: Added special handling for Boleto `boleto_display_details` action type

---

### Enhanced Enabler Configuration with stripeConfig Support

**Added:**
- **Frontend Configuration Override**: New `stripeConfig` option in Enabler allows frontend to override backend configuration for Stripe Elements and PaymentIntent
- **Stripe Elements Configuration**: Support for overriding `appearance`, `layout`, and `collectBillingAddress` from frontend
- **Payment Method Options**: Support for configuring payment method-specific options (e.g., PIX expiration, Boleto settings) via `paymentIntent.paymentMethodOptions`
- **Type-Safe Configuration**: Uses native Stripe types (`Appearance`, `LayoutObject`) for better type safety and autocompletion

**Technical Details:**

#### stripeConfig Structure
The new `stripeConfig` option in `EnablerOptions` provides:
- **`elements`**: Configuration for Stripe Elements
  - `appearance`: Overrides `STRIPE_APPEARANCE_PAYMENT_ELEMENT` or `STRIPE_APPEARANCE_EXPRESS_CHECKOUT`
  - `layout`: Overrides `STRIPE_LAYOUT` configuration
  - `collectBillingAddress`: Overrides `STRIPE_COLLECT_BILLING_ADDRESS` setting
- **`paymentIntent`**: Configuration for PaymentIntent creation
  - `paymentMethodOptions`: Payment method-specific options (e.g., `pix.expires_after_seconds`, `boleto.expires_after_days`)

#### Usage Example
```typescript
const enabler = new Enabler({
  processorUrl: PROCESSOR_URL,
  sessionId: sessionId,
  paymentElementType: 'paymentElement',
  stripeConfig: {
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
        pix: { expires_after_seconds: 3600 },
      },
    },
  },
});
```

#### Benefits
- **Frontend Control**: Merchants can customize Stripe Elements appearance per implementation without backend changes
- **Payment Method Customization**: Configure payment method-specific options (PIX, Boleto, etc.) from frontend
- **Type Safety**: Native Stripe types ensure correct configuration
- **Backward Compatible**: All `stripeConfig` properties are optional

#### Files Modified
- `enabler/src/payment-enabler/payment-enabler.ts`: Added `stripeConfig` to `EnablerOptions` interface
- `enabler/src/payment-enabler/payment-enabler-mock.ts`: Implemented `stripeConfig` handling
- `enabler/src/dropin/dropin-embedded.ts`: Integrated `stripeConfig` for payment intent creation
- `enabler/index.html`: Added example usage of `stripeConfig`

---

### New POST /payments Endpoint with Payment Method Options

**Added:**
- **New Endpoint**: `POST /payments` endpoint that accepts payment method options in request body
- **Payment Method Options Support**: Allows frontend to specify payment method-specific options (e.g., PIX expiration, multicapture settings) when creating payment intents
- **Backward Compatibility**: Existing `GET /payments` endpoint remains unchanged for backward compatibility

**Technical Details:**

#### Endpoint Details
- **Route**: `POST /payments`
- **Authentication**: Session authentication required
- **Request Body**: 
  ```typescript
  {
    paymentMethodOptions?: Record<string, Record<string, unknown>>
  }
  ```
- **Response**: Same as `GET /payments` (PaymentResponseSchemaDTO)

#### Use Cases
- Configure PIX payment expiration times
- Set Boleto expiration dates
- Configure multicapture settings per payment
- Customize payment method behavior on a per-payment basis

#### Files Modified
- `processor/src/routes/stripe-payment.route.ts`: Added new POST endpoint
- `processor/src/services/stripe-payment.service.ts`: Enhanced `createPaymentIntent` to accept payment method options
- `processor/src/services/types/stripe-payment.type.ts`: Added request schema types

#### Benefits
- **Flexible Configuration**: Per-payment customization of payment method options
- **Frontend Control**: Frontend can specify payment options without backend changes
- **Backward Compatible**: Existing GET endpoint continues to work

---

### New Environment Variables and Configuration Options

**Added:**
- **`CTP_CHECKOUT_URL`**: New required environment variable for commercetools Checkout API URL
- **`STRIPE_API_VERSION`**: Optional environment variable for Stripe API version (default: `2025-12-15.clover`)
- **`HEALTH_CHECK_TIMEOUT`**: Optional environment variable for health check timeout in milliseconds (default: `5000`)
- **`LOGGER_LEVEL`**: Optional environment variable for logging level (default: `info`)
- **Custom Type Configuration Variables**: New environment variables for customizing commercetools custom type keys:
  - `CT_CUSTOM_TYPE_LAUNCHPAD_PURCHASE_ORDER_KEY` (default: `payment-launchpad-purchase-order`)
  - `CT_CUSTOM_TYPE_STRIPE_CUSTOMER_KEY` (default: `payment-connector-stripe-customer-id`)
  - `CT_CUSTOM_TYPE_SUBSCRIPTION_LINE_ITEM_KEY` (default: `payment-connector-subscription-line-item-type`)
  - `CT_PRODUCT_TYPE_SUBSCRIPTION_KEY` (default: `payment-connector-subscription-information`)

**Technical Details:**

#### New Required Variables
- **`CTP_CHECKOUT_URL`**: Required for commercetools Checkout API integration
  - Example: `https://checkout.europe-west1.gcp.commercetools.com`
  - Used for checkout-related operations

#### New Optional Variables
- **`STRIPE_API_VERSION`**: Controls which Stripe API version to use
  - Default: `2025-12-15.clover`
  - Allows merchants to pin to specific Stripe API versions

- **`HEALTH_CHECK_TIMEOUT`**: Configures health check timeout
  - Default: `5000` milliseconds
  - Used in `/operations/status` endpoint

- **`LOGGER_LEVEL`**: Sets logging verbosity
  - Default: `info`
  - Values: `error`, `warn`, `info`, `debug`

#### Custom Type Variables
These variables allow customization of commercetools custom type keys used by the connector:
- Used during post-deploy script execution
- Allows merchants to use custom naming conventions
- All have sensible defaults matching the connector's standard naming

#### Files Modified
- `processor/src/config/config.ts`: Added new configuration variables
- `connect.yaml`: Added new environment variables to deployment configuration
- `processor/src/services/stripe-payment.service.ts`: Integrated `CTP_CHECKOUT_URL` usage

#### Migration Guide
- **For New Deployments**: Set `CTP_CHECKOUT_URL` as required variable
- **For Existing Deployments**: Add `CTP_CHECKOUT_URL` to your environment variables
- **Optional Variables**: Can be added as needed for customization

---

### Current Project Dependencies

**Dependencies (Processor):**
- `@commercetools/connect-payments-sdk`: 0.27.2
- `stripe`: ^20.1.0
- `fastify`: ^5.7.4
- `@commercetools-backend/loggers`: ^25.2.0
- `@fastify/type-provider-typebox`: 5.2.0
- `@fastify/autoload`: 6.3.1
- `@fastify/cors`: 11.2.0
- `@fastify/formbody`: 8.0.2
- `@fastify/http-proxy`: 11.4.1
- `@fastify/request-context`: 6.2.1
- `@fastify/static`: 8.3.0
- `@sinclair/typebox`: 0.34.41
- `dotenv`: 17.2.3
- `fastify-plugin`: 5.1.0
- `fastify-raw-body`: ^5.0.0
- `fluent-schema`: ^1.1.0

**Dev Dependencies (Processor):**
- `typescript`: 5.9.3
- `jest`: 30.2.0
- `eslint`: 9.39.1
- `prettier`: 3.7.4
- `@typescript-eslint/eslint-plugin`: 8.49.0
- `@typescript-eslint/parser`: 8.49.0
- `ts-jest`: 29.4.6
- `ts-node`: 10.9.2

**Dependencies (Enabler):**
- `@stripe/stripe-js`: ^8.0.0
- `@babel/preset-typescript`: ^7.28.5
- `serve`: 14.2.5
- `ts-node`: ^10.9.2

**Dev Dependencies (Enabler):**
- `typescript`: 5.9.3
- `vite`: 7.2.7
- `jest`: 30.2.0
- `sass`: 1.96.0
- `ts-jest`: ^29.4.6
- `vite-plugin-css-injected-by-js`: 3.5.2

---

### Multiple Refunds and Multicapture Implementation

**Added:**
- **Multicapture Support**: Enhanced `capturePayment()` method to support multiple partial captures with proper `final_capture` handling
- **Advanced Refund Processing**: New `processStripeEventRefunded()` method that fetches refund details from Stripe API for accurate refund amounts and IDs
- **Multicapture Event Handling**: New `processStripeEventMultipleCaptured()` method for handling incremental capture amounts using previous attributes
- **Enhanced Webhook Routing**: Added dedicated handlers for `charge.updated` and `charge.refunded` events with proper routing logic
- **New Event Type Support**: Added `CHARGE__UPDATED` event type to StripeEvent enum for multicapture support
- **Comprehensive Test Coverage**: Updated test suites to cover new multicapture and refund functionality

**Changed:**
- **Simplified Payment Updates**: Removed manual commercetools payment updates from capture/cancel methods (now handled automatically by webhooks)
- **Enhanced Event Converter**: Updated `StripeEventConverter` to handle `CHARGE__UPDATED` events and removed captured-only restriction for refunds
- **Improved Webhook Logic**: Enhanced webhook routing to properly handle subscription vs. non-subscription events for refunds and multicapture
- **Better Error Handling**: Added comprehensive validation and error handling for multicapture scenarios

**Technical Details:**

#### Multicapture Implementation
- **Partial Capture Detection**: Automatically detects partial captures by comparing `amount_received` with `amountPlanned`
- **Final Capture Handling**: Sets `final_capture: false` for partial captures to allow future captures
- **Incremental Amount Calculation**: Calculates incremental captured amounts by comparing current and previous `amount_captured` values
- **Balance Transaction Tracking**: Uses Stripe balance transaction ID as PSP reference for better tracking

#### Enhanced Refund Processing
- **API-Based Refund Details**: Fetches actual refund details from Stripe API instead of relying on event data
- **Accurate Amount Tracking**: Uses actual refund amounts and IDs from Stripe API for precise transaction records
- **Multiple Refund Support**: Handles scenarios with multiple refunds on the same charge
- **Comprehensive Logging**: Enhanced logging for refund processing with detailed transaction information

#### Webhook Event Routing
- **Dedicated Handlers**: Separate processing methods for different event types (refunds vs. multicapture)
- **Subscription Awareness**: Proper routing between subscription and non-subscription event handling
- **Event Type Support**: Added support for `charge.updated` events for multicapture scenarios

#### Files Modified
- `processor/src/services/stripe-payment.service.ts`: Added multicapture and refund processing methods
- `processor/src/routes/stripe-payment.route.ts`: Enhanced webhook routing for new event types
- `processor/src/services/converters/stripeEventConverter.ts`: Added CHARGE__UPDATED support
- `processor/src/services/types/stripe-payment.type.ts`: Added CHARGE__UPDATED event type
- `processor/test/services/stripe-payment.service.spec.ts`: Updated tests for new functionality
- `processor/test/routes.test/stripe-payment.spec.ts`: Enhanced webhook routing tests
- `processor/test/services/converters/stripeEvent.converter.spec.ts`: Added converter tests for new events

#### Benefits
- **Flexible Payment Capture**: Support for multiple partial captures on the same payment intent
- **Accurate Refund Tracking**: Precise refund amount and ID tracking using Stripe API
- **Better Transaction Management**: Improved transaction handling with proper PSP reference tracking
- **Enhanced Webhook Processing**: More robust webhook event handling with dedicated processors
- **Improved Error Handling**: Better validation and error management for edge cases

#### Breaking Changes
None - all changes are backward compatible and enhance existing functionality.

#### Migration Guide
No migration required - existing functionality remains unchanged with enhanced capabilities.

#### Performance Impact
- **Improved Efficiency**: Reduced manual payment updates through webhook-based processing
- **Better API Utilization**: More efficient use of Stripe API for refund and capture operations
- **Enhanced Logging**: Better debugging capabilities with comprehensive transaction logging

#### Security
- **Enhanced Validation**: Improved validation for multicapture and refund scenarios
- **Better Error Handling**: Prevents information leakage through structured error handling
- **Accurate Transaction Records**: More precise transaction tracking improves audit capabilities

---

### Refactored Price Synchronization Configuration (Breaking Change)

**Breaking Change:**
- **Removed `upcomingInvoice` option** from `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING` environment variable
- **Added new environment variable**: `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED` for price synchronization control
- **Added comprehensive documentation**: New `docs/subscription-price-synchronization.md` file covering price synchronization and enhanced subscription management

**Rationale:**
The `upcomingInvoice` option was confusing because it mixed payment handling strategy with price synchronization functionality. Price synchronization is independent of how payments are handled and should be controlled separately.

**Migration Guide:**
- **Old Configuration**: `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING=upcomingInvoice`
- **New Configuration**: 
  ```bash
  STRIPE_SUBSCRIPTION_PAYMENT_HANDLING=createOrder  # or addPaymentToOrder
  STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true
  ```

**Updated Configuration Options:**
- **`STRIPE_SUBSCRIPTION_PAYMENT_HANDLING`**: Now only handles payment strategy:
  - `createOrder` (default): Creates a new order for each subscription payment
  - `addPaymentToOrder`: Adds payment to existing order
- **`STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED`**: New boolean flag for price synchronization:
  - `true`: Enables automatic price synchronization via `invoice.upcoming` webhook (price changes take effect in **current** billing cycle)
  - `false` (default): Price updates happen via `createOrder` method after payment (price changes take effect in **next** billing cycle)

**Benefits:**
- **Clearer separation of concerns**: Payment handling vs price synchronization
- **More flexible configuration**: Can enable price sync with any payment handling strategy
- **Better naming**: `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED` clearly indicates its purpose
- **Easier to understand**: No confusion about what `upcomingInvoice` actually does

---

### Enhanced Subscription Service Architecture and Testing Infrastructure

**Added:**
- **New Price Client Service**: Added `price-client.ts` service for enhanced product price management and retrieval
- **Comprehensive Test Suite Restructuring**: Split subscription service tests into focused modules:
  - `stripe-subscription.service.business-logic.spec.ts`: Business logic and payment handling tests
  - `stripe-subscription.service.core.spec.ts`: Core subscription functionality tests
  - `stripe-subscription.service.lifecycle.spec.ts`: Subscription lifecycle management tests
  - `stripe-subscription.service.payment.spec.ts`: Payment processing and confirmation tests
  - `stripe-subscription.service.price.spec.ts`: Price management and calculation tests
  - `stripe-subscription.service.utils.spec.ts`: Utility functions and helper method tests
- **Enhanced Configuration Testing**: Added `config.spec.ts` for comprehensive configuration validation
- **Improved Mock Data Management**: Enhanced mock data structures for better test coverage and reliability
- **Advanced Payment Intent Handling**: Enhanced error handling for payment intents with additional status checks
- **Enhanced Subscription Metadata Management**: Improved metadata tracking for subscriptions with comprehensive field mapping

**Changed:**
- **Subscription Service Refactoring**: Major architectural improvements to the subscription service with better separation of concerns
- **Test Coverage Enhancement**: Achieved comprehensive test coverage across all subscription service methods and edge cases
- **Mock Data Improvements**: Enhanced mock data structures for shipping information, Stripe API responses, and subscription scenarios
- **Error Handling Improvements**: Better error management throughout the subscription service with detailed logging
- **Payment Processing Enhancements**: Improved payment intent configuration with conditional shipping and advanced payment method options

**Technical Details:**

#### New Price Client Service Features
- **`getProductById()`**: Retrieves products with expanded price information
- **`getProductMasterPrice()`**: Gets current price from product master variant
- **Enhanced Price Management**: Comprehensive price retrieval with error handling and logging

#### Test Architecture Improvements
- **Modular Test Structure**: Tests organized by functionality for better maintainability
- **Comprehensive Coverage**: All subscription service methods now have dedicated test coverage
- **Enhanced Mock Data**: Improved mock data for realistic testing scenarios
- **Better Test Organization**: Clear separation between unit tests and integration tests

#### Subscription Service Enhancements
- **Improved Method Signatures**: Updated method signatures for better type safety
- **Enhanced Error Handling**: Comprehensive error handling with detailed error messages
- **Better Logging**: Enhanced logging throughout the service for better debugging
- **Metadata Management**: Improved metadata handling for subscriptions and payments

#### Files Added
- `processor/src/services/commerce-tools/price-client.ts`: New price management service
- `processor/test/config/config.spec.ts`: Configuration testing
- `processor/test/services/commerce-tools/price-client.spec.ts`: Price client tests
- `processor/test/services/stripe-subscription.service.business-logic.spec.ts`: Business logic tests
- `processor/test/services/stripe-subscription.service.core.spec.ts`: Core functionality tests
- `processor/test/services/stripe-subscription.service.lifecycle.spec.ts`: Lifecycle tests
- `processor/test/services/stripe-subscription.service.payment.spec.ts`: Payment tests
- `processor/test/services/stripe-subscription.service.price.spec.ts`: Price management tests
- `processor/test/services/stripe-subscription.service.utils.spec.ts`: Utility tests

#### Files Modified
- `processor/src/services/stripe-subscription.service.ts`: Major refactoring and enhancements
- `processor/src/config/config.ts`: Added new configuration options
- `processor/src/services/types/stripe-subscription.type.ts`: Enhanced type definitions
- `processor/test/services/stripe-subscription.service.spec.ts`: Restructured main test file
- Multiple test utility files: Enhanced mock data and test helpers

### Performance Impact
- **Improved Test Performance**: Modular test structure allows for faster, focused testing
- **Better Error Handling**: Reduced failed operations through improved error management
- **Enhanced Logging**: Better debugging capabilities with comprehensive logging
- **Optimized Price Retrieval**: More efficient product price management

### Security
- **Enhanced Validation**: Improved validation for subscription operations
- **Better Error Handling**: Prevents information leakage through structured error handling
- **Comprehensive Testing**: Enhanced security through comprehensive test coverage

---

### Added invoice.upcoming Webhook Event Support and Subscription Configuration

**Added:**
- **New Webhook Event**: Added support for `invoice.upcoming` webhook event to handle upcoming subscription invoice notifications
- **Enhanced Webhook Configuration**: Updated webhook endpoint configuration to include the new event type
- **New Configuration Options**: Added environment variables to control subscription payment handling and price synchronization
- **Comprehensive Documentation**: Updated documentation in both processor README and main project README
- **Improved Test Coverage**: Added comprehensive test coverage to verify webhook configuration includes the new event

**Configuration Options:**
- **`STRIPE_SUBSCRIPTION_PAYMENT_HANDLING`**: Controls payment handling strategy:
  - `createOrder` (default): Creates a new order for each subscription payment
  - `addPaymentToOrder`: Adds payment to existing order
- **`STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED`**: Controls automatic price synchronization:
  - `true`: Enables automatic price synchronization via `invoice.upcoming` webhook
  - `false` (default): Disables price synchronization

**Technical Details:**
- Added `invoice.upcoming` to the webhook endpoint configuration in `processor/src/connectors/actions.ts`
- Enhanced test coverage in `processor/test/connectors/actions.spec.ts` to verify webhook configuration
- Updated `processor/README.md` to document the new configuration options and deprecate old environment variable
- Added subscription configuration variables to main project README environment variables section
- Replaced deprecated `CREATE_NEW_ORDER_FOR_SUBSCRIPTION_PAYMENTS` with new configuration system

---

### Enhanced Payment Amount Handling and Error Management

**Added:**
- **Extended PaymentAmount Type**: Created `ExtendedPaymentAmount` interface that extends the base `PaymentAmount` type to include `totalCentAmount` property for quantity calculations
- **Enhanced Payment Intent Error Handling**: Added comprehensive error handling for additional payment intent statuses including `requires_action` and `payment_failed`

**Changed:**
- **`getLineItemPriceId()` Method**: Now uses `ExtendedPaymentAmount` type for better type safety and quantity support
- **`getSubscriptionPaymentAmount()` Method**: Returns `ExtendedPaymentAmount` with proper quantity calculations
- **Payment Intent Status Handling**: Enhanced error management for payment intents that require additional action or have failed payments

**Technical Details:**
- Added `ExtendedPaymentAmount` interface in `processor/src/services/types/stripe-subscription.type.ts`
- Updated subscription service methods to use the new extended type
- Enhanced `stripe-service.ts` in enabler to handle `requires_action` and `payment_failed` payment intent statuses
- Improved error messages and error object structure for better debugging


---

### Enhanced Subscription Service with Mixed Cart Support and One-Time Item Invoicing

### Added
- **One-Time Item Invoicing**: New functionality to create separate invoices for one-time items in mixed carts, allowing better management of subscription + one-time item scenarios
- **Mixed Cart Support**: Enhanced subscription creation logic to handle carts containing both subscription items and one-time items
- **Line Item Price Management**: New method `getAllLineItemPrices()` to retrieve all line item prices excluding subscription items
- **Enhanced Error Handling**: Improved error handling for scenarios where no subscription product is found in the cart
- **Quantity Support**: Enhanced quantity handling for subscription items with proper validation
- **Comprehensive Test Coverage**: Expanded test coverage to validate new features and ensure correct behavior with mixed item carts
- **Attribute Name Prefix Support**: Added support for `stripeConnector_` prefixed attribute names in product types
- **Enhanced Product Type Management**: Improved product type creation and update logic with better error handling
- **Attribute Transformation Utility**: Enhanced `transformVariantAttributes` function to automatically strip `stripeConnector_` prefixes

### Changed
- **Subscription Creation Logic**: Updated to ensure only subscription and shipping items are included in Stripe subscriptions
- **Cart Validation**: Modified error handling to restrict subscriptions to a single line item in the cart, improving validation logic
- **Payment Amount Calculation**: Enhanced calculation of total payment amounts to account for item quantities
- **Product Type Attributes**: Updated all subscription-related product type attributes to use `stripeConnector_` prefix for better organization
- **Attribute Name Mapping**: Modified `transformVariantAttributes` to automatically map prefixed attribute names to internal field names
- **Product Type Update Logic**: Improved product type update process with better error handling and validation
- **Function Signatures**: Updated `handleRequest` function to support both synchronous and asynchronous operations
- **Dependency Updates**: Updated `dotenv` to version 17.2.0 and `eslint-plugin-jest` to version 29.0.1

### Technical Details

#### New Subscription Service Features
- **`getAllLineItemPrices()`**: Retrieves all line item prices excluding subscription items for one-time item processing
- **`createOneTimeItemsInvoice()`**: Creates separate Stripe invoices for one-time items in mixed carts
- **Enhanced `createSubscription()`**: Now handles mixed carts by creating separate invoices for one-time items
- **Quantity Support**: Proper handling of line item quantities in subscription creation
- **Mixed Cart Validation**: Improved validation for carts containing both subscription and one-time items

#### One-Time Item Invoicing Process
1. **Item Identification**: Automatically identifies one-time items (non-subscription items) in the cart
2. **Price Retrieval**: Gets Stripe price IDs for all one-time items
3. **Invoice Creation**: Creates separate Stripe invoices for one-time items with proper metadata
4. **Invoice Finalization**: Automatically finalizes invoices for immediate payment processing
5. **Metadata Tracking**: Includes cart ID and type metadata for proper tracking

#### Enhanced Subscription Management
- **New `updateSubscription` Method**: Comprehensive subscription update functionality for product variant and price changes
- **Product Variant Switching**: Support for switching between master variant and specific variants
- **Price Updates**: Automatic price synchronization with commercetools product pricing
- **Configuration Inheritance**: Subscription attributes automatically inherited from new product variants
- **API Endpoint**: New `POST /subscription-api/:customerId` endpoint for subscription updates
- **Use Cases**: Product variant changes, price updates, subscription configuration changes, product migration

#### Attribute Name Changes
All subscription-related product type attributes now use the `stripeConnector_` prefix:
- `stripeConnector_description` → maps to `description`
- `stripeConnector_recurring_interval` → maps to `recurring_interval`
- `stripeConnector_recurring_interval_count` → maps to `recurring_interval_count`
- `stripeConnector_off_session` → maps to `off_session`
- `stripeConnector_collection_method` → maps to `collection_method`
- `stripeConnector_days_until_due` → maps to `days_until_due`
- `stripeConnector_cancel_at_period_end` → maps to `cancel_at_period_end`
- `stripeConnector_cancel_at` → maps to `cancel_at`
- `stripeConnector_billing_cycle_anchor_day` → maps to `billing_cycle_anchor_day`
- `stripeConnector_billing_cycle_anchor_time` → maps to `billing_cycle_anchor_time`
- `stripeConnector_billing_cycle_anchor_date` → maps to `billing_cycle_anchor_date`
- `stripeConnector_trial_period_days` → maps to `trial_period_days`
- `stripeConnector_trial_end_date` → maps to `trial_end_date`
- `stripeConnector_missing_payment_method_at_trial_end` → maps to `missing_payment_method_at_trial_end`
- `stripeConnector_proration_behavior` → maps to `proration_behavior`

#### Enhanced Utility Functions
- **`transformVariantAttributes`**: Now automatically strips `stripeConnector_` prefixes from attribute names
- **`handleRequest`**: Updated to support async functions with proper error handling
- **Product Type Management**: Improved creation and update logic with comprehensive error handling

#### Files Modified
- `processor/src/services/stripe-subscription.service.ts`: Added mixed cart support and one-time item invoicing
- `processor/src/custom-types/custom-types.ts`: Updated all subscription attributes to use `stripeConnector_` prefix
- `processor/src/utils.ts`: Enhanced `transformVariantAttributes` function with prefix stripping
- `processor/src/connectors/actions.ts`: Improved product type management and async function support
- `processor/src/services/commerce-tools/product-type-client.ts`: Added `updateProductType` function
- `processor/test/services/stripe-subscription.service.spec.ts`: Added comprehensive tests for new features
- `processor/test/utils/utils.spec.ts`: Added tests for attribute name transformation
- `processor/package-lock.json`: Updated dependencies

#### Product Type Management Improvements
- **Smart Update Logic**: Checks if product type exists and compares attributes before updating
- **Product Usage Validation**: Prevents updates when product type is in use by existing products
- **Error Handling**: Comprehensive error handling with detailed logging
- **Graceful Degradation**: Continues deployment even if product type updates fail

#### Testing Enhancements
- Added test case for `stripeConnector_` prefix stripping in `transformVariantAttributes`
- Enhanced test coverage for attribute name transformation
- Added comprehensive tests for mixed cart scenarios and one-time item invoicing
- Improved test reliability and coverage

### Breaking Changes
None - all changes are backward compatible. The `transformVariantAttributes` function now handles both prefixed and non-prefixed attribute names.

### Migration Guide
No migration required - existing functionality remains unchanged. The system automatically handles both old and new attribute name formats.

### Dependencies
- Updated `dotenv` from 16.5.0 to 17.2.0
- Updated `eslint-plugin-jest` from 28.11.0 to 29.0.1

### Performance Impact
- Minimal performance impact
- Improved error handling reduces failed operations
- Better logging for debugging and monitoring
- Enhanced attribute name handling improves data consistency
- Mixed cart support provides more flexible cart configurations

### Security
- No security changes
- Enhanced validation for product type operations
- Improved error handling prevents information leakage
- Better attribute name standardization enhances data integrity
- Proper invoice creation ensures secure payment processing

---

## [Previous] - Attribute Name Standardization and Product Type Management

### Added
- **Attribute Name Prefix Support**: Added support for `stripeConnector_` prefixed attribute names in product types
- **Enhanced Product Type Management**: Improved product type creation and update logic with better error handling
- **Attribute Transformation Utility**: Enhanced `transformVariantAttributes` function to automatically strip `stripeConnector_` prefixes
- **Comprehensive Test Coverage**: Added tests for attribute name transformation and prefix handling
- **Async Function Support**: Enhanced `handleRequest` function to properly support async operations

### Changed
- **Product Type Attributes**: Updated all subscription-related product type attributes to use `stripeConnector_` prefix for better organization
- **Attribute Name Mapping**: Modified `transformVariantAttributes` to automatically map prefixed attribute names to internal field names
- **Product Type Update Logic**: Improved product type update process with better error handling and validation
- **Function Signatures**: Updated `handleRequest` function to support both synchronous and asynchronous operations
- **Dependency Updates**: Updated `dotenv` to version 17.2.0 and `eslint-plugin-jest` to version 29.0.1

### Technical Details

#### Attribute Name Changes
All subscription-related product type attributes now use the `stripeConnector_` prefix:
- `stripeConnector_description` → maps to `description`
- `stripeConnector_recurring_interval` → maps to `recurring_interval`
- `stripeConnector_recurring_interval_count` → maps to `recurring_interval_count`
- `stripeConnector_off_session` → maps to `off_session`
- `stripeConnector_collection_method` → maps to `collection_method`
- `stripeConnector_days_until_due` → maps to `days_until_due`
- `stripeConnector_cancel_at_period_end` → maps to `cancel_at_period_end`
- `stripeConnector_cancel_at` → maps to `cancel_at`
- `stripeConnector_billing_cycle_anchor_day` → maps to `billing_cycle_anchor_day`
- `stripeConnector_billing_cycle_anchor_time` → maps to `billing_cycle_anchor_time`
- `stripeConnector_billing_cycle_anchor_date` → maps to `billing_cycle_anchor_date`
- `stripeConnector_trial_period_days` → maps to `trial_period_days`
- `stripeConnector_trial_end_date` → maps to `trial_end_date`
- `stripeConnector_missing_payment_method_at_trial_end` → maps to `missing_payment_method_at_trial_end`
- `stripeConnector_proration_behavior` → maps to `proration_behavior`

#### Enhanced Utility Functions
- **`transformVariantAttributes`**: Now automatically strips `stripeConnector_` prefixes from attribute names
- **`handleRequest`**: Updated to support async functions with proper error handling
- **Product Type Management**: Improved creation and update logic with comprehensive error handling

#### Files Modified
- `processor/src/custom-types/custom-types.ts`: Updated all subscription attributes to use `stripeConnector_` prefix
- `processor/src/utils.ts`: Enhanced `transformVariantAttributes` function with prefix stripping
- `processor/src/connectors/actions.ts`: Improved product type management and async function support
- `processor/src/services/commerce-tools/product-type-client.ts`: Added `updateProductType` function
- `processor/test/utils/utils.spec.ts`: Added tests for attribute name transformation
- `processor/package-lock.json`: Updated dependencies

#### Product Type Management Improvements
- **Smart Update Logic**: Checks if product type exists and compares attributes before updating
- **Product Usage Validation**: Prevents updates when product type is in use by existing products
- **Error Handling**: Comprehensive error handling with detailed logging
- **Graceful Degradation**: Continues deployment even if product type updates fail

#### Testing Enhancements
- Added test case for `stripeConnector_` prefix stripping in `transformVariantAttributes`
- Enhanced test coverage for attribute name transformation
- Improved test reliability and coverage

### Breaking Changes
None - all changes are backward compatible. The `transformVariantAttributes` function now handles both prefixed and non-prefixed attribute names.

### Migration Guide
No migration required - existing functionality remains unchanged. The system automatically handles both old and new attribute name formats.

### Dependencies
- Updated `dotenv` from 16.5.0 to 17.2.0
- Updated `eslint-plugin-jest` from 28.11.0 to 29.0.1

### Performance Impact
- Minimal performance impact
- Improved error handling reduces failed operations
- Better logging for debugging and monitoring
- Enhanced attribute name handling improves data consistency

### Security
- No security changes
- Enhanced validation for product type operations
- Improved error handling prevents information leakage
- Better attribute name standardization enhances data integrity

---

## [Previous] - Subscription Service Enhancements

### Added
- **Recurring Shipping Fee Support**: Comprehensive support for recurring shipping fees in subscriptions
- **Automatic Shipping Price Management**: Automatic creation and management of Stripe shipping prices
- **Enhanced Metadata Tracking**: Improved metadata handling for shipping methods and prices
- **Comprehensive Test Coverage**: Extensive test coverage for all subscription operations
- **Payment Mode Handling**: Improved handling of different payment modes in the enabler
- **Enhanced Payment Method Options**: Added support for multicapture and advanced payment method configurations
- **Shipping Address Integration**: Re-enabled shipping address integration in payment intents

### Changed
- **Method Signatures**: Updated method signatures to use proper object parameters for better type safety
- **API Documentation**: Updated API documentation to reflect Stripe API compliance
- **Error Handling**: Improved error handling and logging throughout the subscription service
- **Enabler Debugging**: Added comprehensive logging for subscription creation and payment confirmation
- **Payment Intent Configuration**: Enhanced payment intent creation with conditional shipping and payment method options

### Technical Details

#### New Methods Added
- `getSubscriptionShippingPriceId(cart: Cart)`: Retrieves or creates shipping price IDs for subscriptions
- `getStripeShippingPriceByMetadata(shipping: ShippingInfo)`: Searches for existing shipping prices by metadata
- `createStripeShippingPrice(props: CreateStripeShippingPriceProps)`: Creates new Stripe prices for shipping methods

#### Type Definitions Added
- `CreateStripeShippingPriceProps`: Interface for shipping price creation parameters
- Enhanced `FullSubscriptionData` interface with optional `shippingPriceId` field

#### Constants Added
- `METADATA_SHIPPING_PRICE_AMOUNT`: New metadata field for tracking shipping price amounts

#### Files Modified
- `processor/src/services/stripe-subscription.service.ts`: Core subscription service with shipping fee support
- `processor/src/services/types/stripe-subscription.type.ts`: New type definitions
- `processor/src/constants.ts`: New metadata constant
- `processor/test/services/stripe-subscription.service.spec.ts`: Comprehensive test coverage
- `processor/test/utils/mock-cart-data.ts`: Enhanced mock data for shipping information
- `processor/README.md`: Updated documentation with shipping fee functionality
- `README.md`: Updated main documentation with new features
- `.gitignore`: Added `.DS_Store` to ignored files
- `enabler/src/dropin/dropin-embedded.ts`: Enhanced payment mode handling and debugging
- `enabler/src/payment-enabler/payment-enabler-mock.ts`: Improved initialization
- `processor/src/services/stripe-payment.service.ts`: Enhanced payment intent configuration

#### Enabler Improvements
- **Payment Mode Handling**: Added conditional logic to prevent element updates in setup mode
- **Debug Logging**: Added comprehensive logging for subscription creation and payment confirmation
- **Error Handling**: Improved error handling in payment submission flow
- **Payment Confirmation**: Enhanced payment confirmation with better response handling

#### Payment Service Enhancements
- **Shipping Address Integration**: Re-enabled shipping address integration with conditional logic
- **Payment Method Options**: Added support for multicapture and advanced card configurations
- **Conditional Shipping**: Added conditional shipping address inclusion based on billing address collection setting

#### Test Coverage
- Added tests for all subscription service methods
- Enhanced mock data for shipping information and Stripe API responses
- Comprehensive error handling and edge case testing
- Mock improvements for Commercetools client authentication

### Documentation Updates
- Added detailed documentation for subscription shipping fee functionality
- Created technical implementation guide for shipping fee integration
- Updated API documentation to reflect Stripe API compliance
- Added comprehensive testing documentation and examples

### Breaking Changes
None - all changes are backward compatible

### Migration Guide
No migration required - existing functionality remains unchanged

### Dependencies
No new dependencies added

### Performance Impact
- Minimal performance impact
- Improved error handling reduces failed operations
- Better logging for debugging and monitoring
- Enhanced payment method options may improve payment success rates

### Security
- No security changes
- Enhanced validation for shipping information
- Improved error handling prevents information leakage
- Better payment method configuration enhances security 
