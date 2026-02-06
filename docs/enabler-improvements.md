# Enabler and Payment Service Improvements

This document details the recent improvements made to the enabler components and payment service functionality.

## Overview

Recent updates have enhanced the enabler's payment mode handling, debugging capabilities, and payment service configuration to provide better user experience and more robust payment processing.

## Enabler Improvements

### Payment Mode Handling

The enabler now includes improved handling of different payment modes, particularly for setup intents and subscription flows.

#### Key Changes

1. **Conditional Element Updates**: Element updates are now conditional based on payment mode
   ```typescript
   if(this.baseOptions.paymentMode !== 'setup') {
     this.baseOptions.elements.update({amount: response});
   }
   ```

2. **Enhanced Debug Logging**: Comprehensive logging has been added for better debugging
   ```typescript
   console.log("submit");
   console.log("submitError", submitError);
   console.log("createSubscription");
   ```

3. **Improved Payment Confirmation**: Better handling of payment confirmation responses
   ```typescript
   const confirmedPayment = await this.stripe.confirmStripePayment({
     // ... parameters
   });
   const paymentIntentId = confirmedPayment.id;
   ```

### Benefits

- **Better Error Tracking**: Enhanced logging helps identify and resolve payment issues
- **Mode-Specific Behavior**: Proper handling of different payment modes prevents unnecessary operations
- **Improved Debugging**: Comprehensive logging for subscription creation and payment confirmation
- **Enhanced User Experience**: Better error handling and response processing

### Frontend Configuration Override (stripeConfig)

The enabler now supports a `stripeConfig` option in its constructor, allowing frontend applications to override certain backend configurations for Stripe Elements and PaymentIntent creation. This enables per-implementation customization without requiring backend changes.

#### Key Features

1. **Elements Configuration Override**: Customize Stripe Elements appearance, layout, and billing address collection
   ```typescript
   stripeConfig: {
     elements: {
       appearance: { theme: 'night', variables: { colorPrimary: '#7c3aed' } },
       layout: { type: 'accordion', defaultCollapsed: false },
       collectBillingAddress: 'never',
     },
   }
   ```

2. **Payment Intent Configuration**: Specify payment method-specific options for PaymentIntent creation
   ```typescript
   stripeConfig: {
     paymentIntent: {
       paymentMethodOptions: {
         pix: { expires_after_seconds: 3600 },
         boleto: { expires_after_days: 15 },
       },
     },
   }
   ```

3. **Configuration Precedence**: Frontend `stripeConfig` takes priority over backend environment variables
   - `stripeConfig.elements.appearance` overrides `STRIPE_APPEARANCE_PAYMENT_ELEMENT` or `STRIPE_APPEARANCE_EXPRESS_CHECKOUT`
   - `stripeConfig.elements.layout` overrides `STRIPE_LAYOUT`
   - `stripeConfig.elements.collectBillingAddress` overrides `STRIPE_COLLECT_BILLING_ADDRESS`
   - `stripeConfig.paymentIntent.paymentMethodOptions` merges with backend defaults (frontend takes priority)

#### Benefits

- **Flexibility**: Frontend applications can customize Stripe UI and payment behavior dynamically
- **Reduced Backend Changes**: Less need to modify backend environment variables for minor UI or payment option adjustments
- **Improved Developer Experience**: Clear separation of concerns for frontend-specific configurations
- **Per-Implementation Customization**: Different frontend implementations can have different configurations without backend changes

## Payment Service Enhancements

### Boleto Payment Handling

The enabler now includes special handling for Boleto payments to properly support the Boleto payment flow, where voucher generation is the expected completion state.

#### Key Features

1. **Boleto Voucher Generation**: When a Boleto payment intent has `status === "requires_action"` with `next_action.type === "boleto_display_details"`, this is treated as a successful payment completion, not an error
   ```typescript
   if (paymentIntent.status === "requires_action") {
     // Boleto: voucher was generated successfully - this is the expected flow
     if (paymentIntent.next_action?.type === "boleto_display_details") {
       return paymentIntent;
     }
     // For all other requires_action types, follow the original flow
     throw error;
   }
   ```

2. **Expected Flow**: For Boleto payments, the voucher generation (`boleto_display_details`) is the normal completion state, not an error condition
3. **Other Payment Methods**: All other payment methods with `requires_action` status continue to follow the original error handling flow

#### Benefits

- **Correct Boleto Flow**: Boleto payments complete successfully when vouchers are generated
- **Better User Experience**: Users can see their Boleto vouchers without encountering errors
- **Proper Error Handling**: Other payment methods that require action still trigger appropriate error handling
- **Stripe API Compliance**: Aligns with Stripe's Boleto payment flow expectations

### Shipping Address Integration

The payment service now includes improved shipping address handling with conditional logic.

#### Key Features

1. **Conditional Shipping Address**: Shipping addresses are included based on billing address collection settings
   ```typescript
   ...(config.stripeCollectBillingAddress === 'auto' && {
     shipping: shippingAddress,
   }),
   ```

2. **Enhanced Payment Method Options**: Support for advanced payment method configurations with frontend override capability
   ```typescript
   payment_method_options: {
     card: {
       request_multicapture: 'if_available',
     },
     pix: {
       expires_after_seconds: 3600,
     },
    boleto: {
      expires_after_days: 15,
    },
   },
   ```
   Payment method options can be specified from three sources, merged in the following order (later sources take priority):
   - Backend defaults (e.g., `request_multicapture` when `STRIPE_ENABLE_MULTI_OPERATIONS` is enabled)
   - Frontend `stripeConfig.paymentIntent.paymentMethodOptions` (from Enabler initialization)
   - Request body `paymentMethodOptions` (from POST /payments endpoint)

3. **Re-enabled Shipping Integration**: Shipping address integration has been re-enabled with proper validation

### POST /payments Endpoint with Dynamic Payment Method Options

A new `POST /payments` endpoint has been added to support dynamic payment method options directly from the frontend request body, complementing the existing `GET /payments` endpoint.

#### Key Features

1. **Request Body Support**: Accept `paymentMethodOptions` in the request body for per-request customization
   ```typescript
   POST /payments
   {
     "paymentMethodOptions": {
       "pix": {
         "expires_after_seconds": 3600
       },
      "boleto": {
        "expires_after_days": 15
      }
     }
   }
   ```

2. **Merging Logic**: Payment method options are merged with the following precedence:
   - Backend defaults (lowest priority)
   - `stripeConfig.paymentIntent.paymentMethodOptions` from Enabler initialization
   - Request body `paymentMethodOptions` (highest priority)

3. **Backward Compatibility**: The existing `GET /payments` endpoint remains available and uses backend configurations or `stripeConfig` from Enabler initialization

#### Use Cases

- **Dynamic Expiration Times**: Set different expiration times for local payment methods (PIX, Boleto) based on business logic
- **Per-Request Customization**: Override payment method options for specific payment intents without modifying Enabler configuration
- **A/B Testing**: Test different payment method configurations without backend changes

#### Benefits

- **Flexibility**: Per-request customization of payment method options
- **Backward Compatibility**: Existing implementations using `GET /payments` continue to work
- **Dynamic Configuration**: Adjust payment behavior based on runtime conditions
- **Reduced Backend Dependencies**: Frontend can control payment method options without backend modifications

### Benefits

- **Flexible Shipping**: Conditional shipping address inclusion based on configuration
- **Advanced Payment Options**: Support for multicapture and other advanced payment features
- **Better Integration**: Improved integration with Stripe's payment intent system
- **Enhanced Security**: Better payment method configuration enhances security

## Technical Implementation

### Enabler Changes

#### File: `enabler/src/dropin/dropin-embedded.ts`

**Payment Mode Handling**
- Added conditional logic to prevent element updates in setup mode
- Enhanced error handling in payment submission flow
- Improved payment confirmation with better response handling

**Debug Logging**
- Added comprehensive logging for subscription creation
- Enhanced error tracking for payment confirmation
- Better debugging information for troubleshooting

#### File: `enabler/src/services/stripe-service.ts`

**Boleto Payment Handling**
- Added special handling for Boleto payments with `requires_action` status
- When `paymentIntent.status === "requires_action"` and `next_action.type === "boleto_display_details"`, the payment intent is returned successfully (this is the expected flow for Boleto voucher generation)
- For all other `requires_action` types, the original error flow is maintained
- This ensures Boleto payments complete successfully when the voucher is generated, as this is the normal completion flow for Boleto payments

#### File: `enabler/src/payment-enabler/payment-enabler-mock.ts`

**Initialization Improvements**
- Enhanced initialization process for better reliability
- Improved error handling during setup

#### File: `enabler/src/payment-enabler/payment-enabler.ts`

**stripeConfig Support**
- Added `StripeConfig` interface with `StripeElementsConfig` and `StripePaymentIntentConfig` sub-interfaces
- Integrated `stripeConfig` into `EnablerOptions` interface
- Type-safe configuration using native Stripe types (`Appearance`, `LayoutObject`)

#### File: `enabler/src/dropin/dropin-embedded.ts`

**stripeConfig Integration**
- Integrated `stripeConfig.paymentIntent.paymentMethodOptions` into payment intent creation flow
- Passes `paymentMethodOptions` from `stripeConfig` to the API service when creating payment intents

### Payment Service Changes

#### File: `processor/src/services/stripe-payment.service.ts`

**Payment Intent Configuration**
- Re-enabled shipping address integration with conditional logic
- Added support for multicapture and advanced card configurations
- Enhanced payment method options for better payment processing
- Implemented `mergePaymentMethodOptions` method to merge backend defaults with frontend options (frontend takes priority)

**Payment Method Options Merging**
```typescript
private mergePaymentMethodOptions(
  frontendOptions?: Record<string, Record<string, unknown>>,
): Stripe.PaymentIntentCreateParams.PaymentMethodOptions {
  const backendDefaults = {
    card: {
      ...(config.stripeEnableMultiOperations && { request_multicapture: 'if_available' }),
    },
  };
  
  // Merge: backend defaults + frontend options (frontend takes priority)
  return Object.entries(frontendOptions).reduce(
    (merged, [method, options]) => ({
      ...merged,
      [method]: { ...merged[method], ...options },
    }),
    backendDefaults,
  );
}
```

#### File: `processor/src/routes/stripe-payment.route.ts`

**New POST /payments Endpoint**
- Added `POST /payments` endpoint that accepts `paymentMethodOptions` in the request body
- Maintains backward compatibility with existing `GET /payments` endpoint
- Validates request body using `PaymentMethodOptionsSchema`

**Shipping Address Logic**
```typescript
const shippingAddress = this.customerService.getStripeCustomerAddress(
  cart.shippingAddress,
  customer?.addresses[0],
);

// Conditional inclusion based on configuration
...(config.stripeCollectBillingAddress === 'auto' && {
  shipping: shippingAddress,
}),
```

## Configuration

### Environment Variables

No new environment variables are required. The improvements use existing configuration:

- `STRIPE_COLLECT_BILLING_ADDRESS`: Controls shipping address inclusion (can be overridden by `stripeConfig.elements.collectBillingAddress`)
- `STRIPE_APPEARANCE_PAYMENT_ELEMENT` / `STRIPE_APPEARANCE_EXPRESS_CHECKOUT`: Default appearance (can be overridden by `stripeConfig.elements.appearance`)
- `STRIPE_LAYOUT`: Default layout (can be overridden by `stripeConfig.elements.layout`)
- `STRIPE_ENABLE_MULTI_OPERATIONS`: Enables multicapture for cards (can be overridden by `stripeConfig.paymentIntent.paymentMethodOptions`)

### Frontend Configuration Override

The `stripeConfig` option in the Enabler allows frontend applications to override backend environment variables:

| Backend Variable | stripeConfig Override | Priority |
|-----------------|----------------------|----------|
| `STRIPE_APPEARANCE_PAYMENT_ELEMENT` / `STRIPE_APPEARANCE_EXPRESS_CHECKOUT` | `stripeConfig.elements.appearance` | Frontend takes priority |
| `STRIPE_LAYOUT` | `stripeConfig.elements.layout` | Frontend takes priority |
| `STRIPE_COLLECT_BILLING_ADDRESS` | `stripeConfig.elements.collectBillingAddress` | Frontend takes priority |
| Backend payment method defaults | `stripeConfig.paymentIntent.paymentMethodOptions` | Merged (frontend takes priority) |
| All above | Request body `paymentMethodOptions` (POST /payments) | Highest priority |

### Behavior Changes

1. **Setup Mode**: Element updates are skipped in setup mode to prevent conflicts
2. **Shipping Addresses**: Conditionally included based on billing address collection setting
3. **Payment Methods**: Enhanced with multicapture and advanced options
4. **Debugging**: Comprehensive logging for better troubleshooting
5. **Frontend Configuration Override**: `stripeConfig` allows frontend to override backend configurations for Elements and PaymentIntent
6. **Payment Method Options Merging**: Options are merged from backend defaults, `stripeConfig`, and request body (in that order, with later sources taking priority)
7. **New POST Endpoint**: `POST /payments` enables per-request payment method options customization

## Testing

### Test Coverage

The improvements include:

- **Payment Mode Testing**: Tests for different payment modes
- **Shipping Address Testing**: Tests for conditional shipping address inclusion
- **Payment Method Testing**: Tests for advanced payment method options
- **Error Handling Testing**: Tests for improved error scenarios
- **stripeConfig Testing**: Tests for frontend configuration override functionality
- **Payment Method Options Merging**: Tests for merging logic between backend defaults, `stripeConfig`, and request body
- **POST /payments Endpoint**: Tests for new endpoint with dynamic payment method options

### Debugging

Enhanced debugging capabilities:

- **Comprehensive Logging**: Detailed logs for payment flows
- **Error Tracking**: Better error identification and resolution
- **Response Validation**: Improved validation of payment responses
- **Mode-Specific Debugging**: Debug information specific to payment modes

## Best Practices

### Implementation Guidelines

1. **Use Conditional Logic**: Always check payment mode before performing operations
2. **Enable Debug Logging**: Use comprehensive logging for troubleshooting
3. **Validate Responses**: Always validate payment confirmation responses
4. **Handle Errors Gracefully**: Implement proper error handling for all scenarios

### Performance Considerations

1. **Conditional Operations**: Only perform necessary operations based on payment mode
2. **Efficient Logging**: Use appropriate log levels for different environments
3. **Response Optimization**: Optimize response handling for better performance
4. **Resource Management**: Properly manage resources during payment processing

## Troubleshooting

### Common Issues

1. **Element Update Errors**: Check if payment mode is setup
2. **Shipping Address Issues**: Verify billing address collection configuration
3. **Payment Method Problems**: Check payment method options configuration (verify merging order: backend defaults → `stripeConfig` → request body)
4. **Debug Information**: Use enhanced logging for troubleshooting
5. **Configuration Override Issues**: Verify `stripeConfig` structure and ensure it matches expected format
6. **POST /payments Errors**: Check request body format and ensure `paymentMethodOptions` structure is correct

### Debug Steps

1. Check payment mode configuration
2. Verify billing address collection settings
3. Review payment method options (check merging order and precedence)
4. Check debug logs for detailed information
5. Validate payment confirmation responses
6. Verify `stripeConfig` structure if using frontend configuration override
7. Check request body format when using `POST /payments` endpoint

## Future Enhancements

### Planned Features

1. **Advanced Payment Modes**: Support for additional payment modes
2. **Enhanced Debugging**: More sophisticated debugging tools
3. **Performance Optimization**: Further performance improvements
4. **Security Enhancements**: Additional security features

### Extension Points

The current implementation provides extension points for:

- Custom payment mode handling
- Advanced debugging capabilities
- Custom payment method configurations via `stripeConfig` and `POST /payments`
- Enhanced error handling
- Frontend configuration override for Elements appearance, layout, and billing address collection
- Dynamic payment method options per request 
