# Changelog

## [Latest] - Subscription Service Enhancements

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