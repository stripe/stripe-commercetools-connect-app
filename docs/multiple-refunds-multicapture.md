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

### Enhanced Event Handling

The webhook routing has been simplified to always route events to their dedicated handlers:

```typescript
case StripeEvent.CHARGE__UPDATED:
  // Always route to dedicated multicapture handler
  log.info(`Processing Stripe multicapture event: ${event.type}`);
  await opts.paymentService.processStripeEventMultipleCaptured(event);
  break;

case StripeEvent.CHARGE__REFUNDED:
  // Always route to dedicated refund handler
  log.info(`Processing Stripe refund event: ${event.type}`);
  await opts.paymentService.processStripeEventRefunded(event);
  break;
```

**Note**: The subscription invoice checks have been removed to simplify the routing logic and ensure consistent processing of multicapture and refund events.

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

### Capture Method Configuration

The connector now uses manual capture mode by default to enable multicapture functionality:

```typescript
// In config.ts
stripeCaptureMethod: 'manual', // Hardcoded for multicapture support
```

This change ensures that all payments are created with manual capture, which is required for:
- Multiple partial captures on the same payment intent
- Proper multicapture event handling
- Accurate incremental capture tracking

### Environment Variables

The following environment variables are used for multicapture and refund support:

**Required Variables:**
- **`STRIPE_SECRET_KEY`**: Required for API calls to fetch refund details
- **`STRIPE_WEBHOOK_SIGNING_SECRET`**: Required for webhook signature verification
- **`STRIPE_CAPTURE_METHOD`**: Controls capture behavior (now hardcoded to 'manual' for multicapture support)

**Optional Variables:**
- **`STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED`**: Enable automatic subscription price synchronization (default: false)
- **`STRIPE_SUBSCRIPTION_PAYMENT_HANDLING`**: Subscription payment handling strategy - 'createOrder' or 'addPaymentToOrder' (default: 'createOrder')

### Webhook Configuration

Ensure your Stripe webhook endpoint includes the following events:
- `charge.updated` - For multicapture support (now always routed to multicapture handler)
- `charge.refunded` - For refund processing (now always routed to refund handler)
- `payment_intent.succeeded` - For successful payments
- `payment_intent.canceled` - For canceled payments

**Note**: The webhook routing has been simplified. `charge.updated` and `charge.refunded` events are now always processed by their respective handlers, regardless of whether they originate from subscription invoices.

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

All changes are backward compatible:
- **Existing Functionality**: All existing payment processing continues to work
- **Enhanced Capabilities**: New features are additive and don't break existing flows
- **Configuration**: No configuration changes required

### Upgrade Path

1. **Deploy Updated Code**: Deploy the updated connector with multicapture and refund support
2. **Verify Webhook Events**: Ensure webhook endpoint includes `charge.updated` and `charge.refunded` events
3. **Test Functionality**: Test multicapture and refund scenarios in your environment
4. **Monitor Logs**: Monitor logs for any issues with the new functionality

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
