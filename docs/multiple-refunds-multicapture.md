# Multiple Refunds and Multicapture Support

This document provides comprehensive information about the enhanced payment processing capabilities, including multiple refunds and multicapture support implemented in the Stripe-Commercetools payment connector.

## Overview

The connector now supports advanced payment processing scenarios including:
- **Multiple Partial Captures**: Capture different amounts from the same payment intent multiple times
- **Accurate Refund Processing**: Fetch refund details directly from Stripe API for precise transaction records
- **Incremental Capture Tracking**: Track incremental captured amounts using Stripe's event system
- **Enhanced Webhook Processing**: Dedicated handlers for complex payment scenarios

## Multicapture Support

### How Multicapture Works

Multicapture allows merchants to capture different amounts from a single payment intent multiple times, which is useful for:
- **Split Shipments**: Capture payment as items are shipped
- **Partial Deliveries**: Capture payment for delivered portions of an order
- **Service-Based Billing**: Capture payment as services are completed

### Implementation Details

#### Capture Payment Method Enhancement

The `capturePayment()` method has been enhanced to support multicapture:

```typescript
public async capturePayment(request: CapturePaymentRequest): Promise<PaymentProviderModificationResponse> {
  const paymentIntentId = request.payment.interfaceId as string;
  const amountToBeCaptured = request.amount.centAmount;
  const stripePaymentIntent = await stripeApi().paymentIntents.retrieve(paymentIntentId);
  
  const cartTotalAmount = request.payment.amountPlanned.centAmount;
  const isPartialCapture = stripePaymentIntent.amount_received + amountToBeCaptured < cartTotalAmount;
  
  const response = await stripeApi().paymentIntents.capture(paymentIntentId, {
    amount_to_capture: amountToBeCaptured,
    ...(isPartialCapture && {
      final_capture: false,
    }),
  });
  
  // Process the capture...
}
```

#### Key Features

- **Partial Capture Detection**: Automatically detects if the capture is partial by comparing `amount_received` with `amountPlanned`
- **Final Capture Handling**: Sets `final_capture: false` for partial captures to allow future captures
- **Amount Validation**: Ensures payment amount is properly set before processing
- **Comprehensive Logging**: Detailed logging for capture operations including partial capture status

### Multicapture Event Processing

#### Charge Updated Event Handler

The `processStripeEventMultipleCaptured()` method handles `charge.updated` events:

```typescript
public async processStripeEventMultipleCaptured(event: Stripe.Event): Promise<void> {
  const updateData = this.stripeEventConverter.convert(event);
  const charge = event.data.object as Stripe.Charge;
  
  // Validate charge is captured
  if (!charge.captured) {
    log.warn('Charge is already captured', { chargeId: charge.id });
    return;
  }
  
  // Get previous attributes to calculate incremental amount
  const previousAttributes = event.data.previous_attributes as Stripe.Charge;
  
  // Calculate the INCREMENTAL captured amount (not total)
  const incrementalAmount = charge.amount_captured - (previousAttributes.amount_captured || 0);
  
  // Update transactions with incremental amount
  updateData.transactions.forEach((tx) => {
    tx.interactionId = charge.balance_transaction as string;
    tx.amount = {
      centAmount: incrementalAmount,
      currencyCode: charge.currency.toUpperCase(),
    };
  });
  
  // Process each transaction...
}
```

#### Key Features

- **Incremental Amount Calculation**: Calculates only the incremental captured amount, not the total
- **Previous Attributes Validation**: Uses Stripe's `previous_attributes` to determine what changed
- **Balance Transaction Tracking**: Uses Stripe balance transaction ID as PSP reference
- **Comprehensive Validation**: Validates that the charge is captured and amount increased

## Enhanced Refund Processing

### How Refund Processing Works

The enhanced refund processing fetches actual refund details from Stripe API instead of relying solely on webhook event data, providing:
- **Accurate Refund Amounts**: Uses actual refund amounts from Stripe API
- **Precise Refund IDs**: Uses actual refund IDs for transaction tracking
- **Multiple Refund Support**: Handles scenarios with multiple refunds on the same charge

### Implementation Details

#### Refund Event Handler

The `processStripeEventRefunded()` method processes refund events:

```typescript
public async processStripeEventRefunded(event: Stripe.Event): Promise<void> {
  const updateData = this.stripeEventConverter.convert(event);
  const charge = event.data.object as Stripe.Charge;
  
  // Fetch refunds for this charge
  const refunds = await stripeApi().refunds.list({
    charge: charge.id,
    created: {
      gte: charge.created,
    },
    limit: 2,
  });
  
  const refund = refunds.data[0];
  if (!refund) {
    log.warn('No refund found for charge', { chargeId: charge.id });
    return;
  }
  
  // Update the transaction data with refund details
  updateData.pspReference = refund.id;
  updateData.transactions.forEach((tx) => {
    tx.interactionId = refund.id;
    tx.amount = {
      centAmount: refund.amount,
      currencyCode: refund.currency.toUpperCase(),
    };
  });
  
  // Process each transaction...
}
```

#### Key Features

- **API-Based Refund Details**: Fetches actual refund information from Stripe API
- **Accurate Amount Tracking**: Uses actual refund amounts for precise transaction records
- **Multiple Refund Support**: Handles scenarios with multiple refunds on the same charge
- **Comprehensive Logging**: Enhanced logging for refund processing with detailed transaction information

## Webhook Event Routing

### Conditional Event Handling

The webhook routing now uses conditional processing based on the `STRIPE_ENABLE_MULTI_OPERATIONS` configuration:

```typescript
case StripeEvent.CHARGE__UPDATED:
  if (getConfig().stripeEnableMultiOperations) {
    log.info(`Processing Stripe multicapture event: ${event.type}`);
    await opts.paymentService.processStripeEventMultipleCaptured(event);
  } else {
    log.info(`Multi-operations disabled, skipping multicapture: ${event.type}`);
  }
  break;

case StripeEvent.CHARGE__REFUNDED:
  if (getConfig().stripeEnableMultiOperations) {
    log.info(`Processing Stripe multirefund event: ${event.type}`);
    await opts.paymentService.processStripeEventRefunded(event);
  } else {
    log.info(`Multi-operations disabled, skipping multirefund: ${event.type}`);
  }
  break;
```

**Benefits of Conditional Processing**:
- **Backward Compatibility**: Ensures merchants without multicapture in their Stripe accounts can continue using the connector
- **Explicit Opt-In**: Merchants must explicitly enable these features via environment variable
- **Graceful Handling**: Webhook events are gracefully skipped when features are disabled
- **Clear Logging**: Informative log messages indicate when events are skipped

### Event Type Support

#### New Event Types

- **`CHARGE__UPDATED`**: Handles multicapture scenarios with incremental amount tracking
- **Enhanced `CHARGE__REFUNDED`**: Improved refund processing with API-based details

#### Event Converter Updates

The `StripeEventConverter` has been updated to support new event types:

```typescript
case StripeEvent.CHARGE__UPDATED:
  return [
    {
      type: PaymentTransactions.CHARGE,
      state: PaymentStatus.SUCCESS,
      amount: this.populateAmount(event),
      interactionId: paymentIntentId,
    },
  ];
```

## Transaction Management

### Simplified Payment Updates

The connector now relies on webhook-based processing instead of manual payment updates:

#### Before (Manual Updates)
```typescript
// Manual commercetools payment updates in capture/cancel methods
await this.ctPaymentService.updatePayment({
  id: request.payment.id,
  transaction: {
    type: PaymentTransactions.CHARGE,
    amount: request.amount,
    interactionId: response.id,
    state: PaymentStatus.SUCCESS,
  },
});
```

#### After (Webhook-Based)
```typescript
// Webhook events automatically handle payment updates
// No manual updates needed in capture/cancel methods
```

### Benefits of Webhook-Based Processing

- **Consistency**: All payment updates go through the same webhook processing pipeline
- **Reliability**: Webhook events ensure payment state is always synchronized
- **Auditability**: All payment changes are tracked through webhook events
- **Error Handling**: Centralized error handling for all payment operations

## Configuration

### Enabling Multicapture and Multirefund Features

**IMPORTANT**: Multicapture and multirefund features are now **opt-in** and must be explicitly enabled via environment variable configuration. This ensures backward compatibility with Stripe accounts that don't support these advanced features.

#### Environment Variable Configuration

Set the following environment variable to enable both features:

```bash
# Enable multicapture and multirefund support
STRIPE_ENABLE_MULTI_OPERATIONS=true
```

**Default Behavior** (when not set or set to `false`):
- Multicapture: Disabled - `request_multicapture` is not set on payment intents
- Multirefund: Disabled - `charge.refunded` webhook events are skipped
- Standard single-capture payment processing continues to work normally

**When Enabled** (`STRIPE_ENABLE_MULTI_OPERATIONS=true`):
- Multicapture: Enabled - `request_multicapture: 'if_available'` is set on payment intents
- Multirefund: Enabled - `charge.refunded` webhook events are processed
- `charge.updated` webhook events are processed for multicapture scenarios

### Prerequisites

Before enabling these features, ensure:
1. **Stripe Account Support**: Your Stripe account has multicapture enabled
2. **Manual Capture Mode**: Set `STRIPE_CAPTURE_METHOD=manual` for multicapture to work
3. **Webhook Configuration**: Webhook endpoint includes `charge.updated` and `charge.refunded` events

### Capture Method Configuration

For multicapture to work, you must use manual capture mode:

```bash
# Required for multicapture support
STRIPE_CAPTURE_METHOD=manual
```

This ensures that all payments are created with manual capture, which is required for:
- Multiple partial captures on the same payment intent
- Proper multicapture event handling
- Accurate incremental capture tracking

### Environment Variables

The following environment variables are used for multicapture and refund support:

**Required Variables:**
- **`STRIPE_SECRET_KEY`**: Required for API calls to fetch refund details
- **`STRIPE_WEBHOOK_SIGNING_SECRET`**: Required for webhook signature verification
- **`STRIPE_CAPTURE_METHOD`**: Controls capture behavior (set to 'manual' for multicapture support)

**Feature Control Variables:**
- **`STRIPE_ENABLE_MULTI_OPERATIONS`**: Enable/disable multicapture and multirefund support (default: false)
  - Values: `true` | `false`
  - When `false` (default): Features are disabled for backward compatibility
  - When `true`: Enables both multicapture and multirefund features
  - **NOTE**: Requires multicapture to be enabled in your Stripe account

**Optional Variables:**
- **`STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED`**: Enable automatic subscription price synchronization (default: false)
- **`STRIPE_SUBSCRIPTION_PAYMENT_HANDLING`**: Subscription payment handling strategy - 'createOrder' or 'addPaymentToOrder' (default: 'createOrder')

### Webhook Configuration

Ensure your Stripe webhook endpoint includes the following events:
- `charge.updated` - For multicapture support (conditionally processed when `STRIPE_ENABLE_MULTI_OPERATIONS=true`)
- `charge.refunded` - For refund processing (conditionally processed when `STRIPE_ENABLE_MULTI_OPERATIONS=true`)
- `payment_intent.succeeded` - For successful payments
- `payment_intent.canceled` - For canceled payments

**Webhook Event Routing**:
- When `STRIPE_ENABLE_MULTI_OPERATIONS=false` (default):
  - `charge.updated` events are received but skipped (logged as "Multi-operations disabled, skipping multicapture")
  - `charge.refunded` events are received but skipped (logged as "Multi-operations disabled, skipping multirefund")
- When `STRIPE_ENABLE_MULTI_OPERATIONS=true`:
  - `charge.updated` events are processed by the dedicated multicapture handler
  - `charge.refunded` events are processed by the dedicated refund handler

## Testing

### Test Coverage

The implementation includes comprehensive test coverage:

- **Multicapture Tests**: Tests for partial capture detection and incremental amount calculation
- **Refund Tests**: Tests for API-based refund processing and multiple refund scenarios
- **Webhook Tests**: Tests for enhanced webhook routing and event handling
- **Converter Tests**: Tests for new event converter functionality

### Test Files Updated

- `processor/test/services/stripe-payment.service.spec.ts`
- `processor/test/routes.test/stripe-payment.spec.ts`
- `processor/test/services/converters/stripeEvent.converter.spec.ts`

## Error Handling

### Validation and Error Management

The implementation includes comprehensive error handling:

- **Charge Validation**: Validates that charges are captured before processing
- **Amount Validation**: Ensures payment amounts are properly set
- **API Error Handling**: Handles Stripe API errors gracefully
- **Logging**: Comprehensive logging for debugging and monitoring

### Error Scenarios

- **Uncaptured Charges**: Warns and skips processing for uncaptured charges
- **Missing Refunds**: Handles cases where refunds are not found
- **Amount Mismatches**: Validates incremental amounts are positive
- **API Failures**: Graceful handling of Stripe API errors

## Performance Considerations

### Efficiency Improvements

- **Reduced Manual Updates**: Eliminated manual commercetools payment updates
- **API Optimization**: Efficient use of Stripe API for refund and capture operations
- **Webhook Processing**: Centralized webhook processing reduces duplicate operations

### Monitoring

- **Comprehensive Logging**: Enhanced logging for all operations
- **Transaction Tracking**: Better PSP reference tracking for audit purposes
- **Error Monitoring**: Structured error handling with detailed information

## Migration Guide

### Backward Compatibility

All changes are fully backward compatible with **opt-in** configuration:
- **Existing Functionality**: All existing payment processing continues to work without changes
- **Default Behavior**: Features are disabled by default (`STRIPE_ENABLE_MULTI_OPERATIONS=false`)
- **No Breaking Changes**: Merchants without multicapture support in Stripe accounts are not affected
- **Graceful Handling**: Webhook events are gracefully skipped when features are disabled
- **Enhanced Capabilities**: New features are additive and only activate when explicitly enabled

### Upgrade Path

#### For Merchants WITHOUT Multicapture Support
1. **Deploy Updated Code**: Deploy the updated connector
2. **No Configuration Changes**: Leave `STRIPE_ENABLE_MULTI_OPERATIONS` unset or set to `false`
3. **Verify Functionality**: Existing payment processing continues to work normally
4. **Monitor Logs**: Check logs to confirm webhook events are being skipped appropriately

#### For Merchants WITH Multicapture Support
1. **Deploy Updated Code**: Deploy the updated connector with multicapture and refund support
2. **Enable Feature**: Set `STRIPE_ENABLE_MULTI_OPERATIONS=true` in environment variables
3. **Verify Webhook Events**: Ensure webhook endpoint includes `charge.updated` and `charge.refunded` events
4. **Set Capture Method**: Ensure `STRIPE_CAPTURE_METHOD=manual` for multicapture to work
5. **Test Functionality**: Test multicapture and refund scenarios in your environment
6. **Monitor Logs**: Monitor logs for multicapture and refund processing confirmation

### Configuration Example

```bash
# For merchants WITH multicapture support in Stripe account
STRIPE_ENABLE_MULTI_OPERATIONS=true
STRIPE_CAPTURE_METHOD=manual
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SIGNING_SECRET=whsec_...

# For merchants WITHOUT multicapture support (or default behavior)
# STRIPE_ENABLE_MULTI_OPERATIONS=false  # or leave unset
STRIPE_CAPTURE_METHOD=automatic  # or manual for single captures
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SIGNING_SECRET=whsec_...
```

## Best Practices

### Multicapture Usage

- **Use for Split Shipments**: Implement multicapture for orders with multiple shipments
- **Monitor Capture Limits**: Be aware of Stripe's limits on partial captures
- **Handle Edge Cases**: Implement proper error handling for failed captures

### Refund Processing

- **Use API-Based Details**: Always use the enhanced refund processing for accurate records
- **Handle Multiple Refunds**: Ensure your system can handle multiple refunds on the same charge
- **Monitor Refund Status**: Track refund status and handle failed refunds appropriately

### Webhook Management

- **Ensure Event Coverage**: Include all necessary webhook events in your Stripe configuration
- **Handle Event Ordering**: Be prepared for webhook events arriving out of order
- **Implement Idempotency**: Ensure webhook processing is idempotent

## Troubleshooting

### Common Issues

#### Multicapture Not Working
- **Check Webhook Events**: Ensure `charge.updated` is included in webhook configuration
- **Verify Capture Method**: Check that `STRIPE_CAPTURE_METHOD` is set appropriately
- **Review Logs**: Check logs for multicapture processing errors

#### Refund Processing Issues
- **API Permissions**: Ensure Stripe API key has refund read permissions
- **Webhook Configuration**: Verify `charge.refunded` is included in webhook events
- **Refund Validation**: Check that refunds exist in Stripe before processing

#### Webhook Routing Problems
- **Event Type Support**: Ensure all event types are properly handled
- **Subscription Detection**: Verify subscription vs. non-subscription event routing
- **Error Handling**: Check error handling for webhook processing failures

### Debugging

- **Enable Detailed Logging**: Use comprehensive logging to debug issues
- **Check Stripe Dashboard**: Verify events and transactions in Stripe dashboard
- **Monitor commercetools**: Check payment transactions in commercetools
- **Review Webhook Logs**: Monitor webhook processing logs for errors

## Support

For issues or questions related to multicapture and refund support:

1. **Check Documentation**: Review this documentation and related guides
2. **Review Logs**: Examine connector logs for error details
3. **Test Scenarios**: Create test scenarios to reproduce issues
4. **Contact Support**: Reach out to the development team with detailed information

## Subscription Enhancements

### Price Synchronization

The connector now includes automatic subscription price synchronization:

- **Automatic Price Updates**: Subscription prices are synchronized with current commercetools product prices
- **Invoice Upcoming Events**: Triggered by `invoice.upcoming` webhook events
- **Configurable**: Controlled by `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED` environment variable

### Enhanced Subscription Payment Handling

Two strategies are available for handling subscription payments:

1. **Create New Order** (default): Creates a new order for each subscription payment
2. **Add Payment to Order**: Adds payment to existing order

Controlled by `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING` environment variable.

## Conclusion

The multiple refunds and multicapture implementation provides enhanced payment processing capabilities while maintaining backward compatibility. The features are designed to handle complex payment scenarios with accurate transaction tracking and comprehensive error handling.

Key benefits include:
- **Flexible Payment Capture**: Support for multiple partial captures
- **Accurate Refund Tracking**: Precise refund processing using Stripe API
- **Enhanced Webhook Processing**: Robust event handling for complex scenarios
- **Improved Transaction Management**: Better PSP reference tracking and audit capabilities
- **Comprehensive Error Handling**: Structured error management with detailed logging
- **Subscription Management**: Enhanced subscription handling with price synchronization
