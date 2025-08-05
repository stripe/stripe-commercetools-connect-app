# Changelog

## [Latest] - Enhanced Subscription Service with Mixed Cart Support and One-Time Item Invoicing

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