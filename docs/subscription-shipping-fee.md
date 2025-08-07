# Subscription Shipping Fee Integration

This document provides detailed technical information about the subscription shipping fee functionality implemented in the Stripe Composable Connector.

## Overview

The subscription shipping fee integration allows merchants to include recurring shipping costs as part of their subscription billing. This feature automatically creates and manages Stripe shipping prices that align with the subscription's billing interval, ensuring consistent billing for both products and shipping.

## Architecture

### Core Components

1. **Shipping Price Detection**: Automatically detects shipping information in the cart during subscription creation
2. **Price Management**: Creates or retrieves Stripe prices for shipping methods
3. **Subscription Integration**: Includes shipping fees as separate line items in subscriptions
4. **Metadata Tracking**: Maintains proper tracking of shipping method IDs and amounts

### Data Flow

```
Cart with Shipping Info → Detect Shipping Method → Create/Retrieve Stripe Price → Add to Subscription Items
```

## Implementation Details

### Key Methods

#### `getSubscriptionShippingPriceId(cart: Cart)`

This method is responsible for retrieving or creating shipping price IDs for subscriptions.

**Process:**
1. Extracts shipping information from the cart
2. Searches for existing Stripe shipping prices using metadata
3. Validates price compatibility with subscription billing interval
4. Creates new shipping price if none exists
5. Returns the shipping price ID

**Parameters:**
- `cart`: Commercetools cart object containing shipping information

**Returns:**
- `Promise<string | undefined>`: Shipping price ID or undefined if no shipping info

#### `getStripeShippingPriceByMetadata(shipping: ShippingInfo)`

Searches for existing Stripe shipping prices using metadata.

**Search Criteria:**
- Shipping method ID (`ct_variant_sku`)
- Shipping price amount (`ct_shipping_price_amount`)

#### `createStripeShippingPrice(props: CreateStripeShippingPriceProps)`

Creates new Stripe prices for shipping methods.

**Parameters:**
- `shipping`: Shipping information from the cart
- `stripeProductId`: Stripe product ID for the shipping method
- `attributes`: Subscription attributes for billing interval

### Metadata Fields

The following metadata fields are used to track shipping information:

| Field | Description | Example |
|-------|-------------|---------|
| `ct_variant_sku` | Shipping method ID | `"shipping-method-123"` |
| `ct_shipping_price_amount` | Shipping price in cents | `"1500"` |

### Type Definitions

```typescript
interface CreateStripeShippingPriceProps {
  shipping: ShippingInfo;
  stripeProductId: string;
  attributes: SubscriptionAttributes;
}

interface FullSubscriptionData extends BasicSubscriptionData {
  // ... existing fields
  shippingPriceId?: string;
}
```

## Integration Points

### Subscription Creation

Shipping fees are automatically included when creating subscriptions:

```typescript
const subscription = await stripe.subscriptions.create({
  customer: stripeCustomerId,
  items: [
    { price: priceId }, // Main product price
    ...(shippingPriceId ? [{ price: shippingPriceId }] : []) // Shipping price
  ],
  // ... other subscription parameters
});
```

### Setup Intent Integration

Shipping fees are also included when creating subscriptions from setup intents:

```typescript
const subscription = await stripe.subscriptions.create({
  customer: stripeCustomerId,
  default_payment_method: paymentMethodId,
  items: [
    { price: priceId },
    ...(shippingPriceId ? [{ price: shippingPriceId }] : [])
  ],
  // ... other parameters
});
```

## Configuration

### Environment Variables

No additional environment variables are required for shipping fee functionality. The feature uses existing Stripe configuration.

### Commercetools Configuration

Shipping information is automatically extracted from the cart's `shippingInfo` field. The connector expects:

- `shippingInfo.shippingMethod.id`: Shipping method identifier
- `shippingInfo.price.centAmount`: Shipping cost in cents
- `shippingInfo.price.currencyCode`: Currency code
- `shippingInfo.shippingMethodName`: Display name for the shipping method

## Error Handling

### Common Scenarios

1. **No Shipping Information**: Returns `undefined` without error
2. **Invalid Shipping Method**: Logs warning and continues without shipping
3. **Price Creation Failure**: Throws error with detailed logging
4. **Metadata Mismatch**: Handles gracefully with fallback to price creation

### Logging

The implementation includes comprehensive logging:

- Info logs for successful operations
- Warning logs for edge cases
- Error logs for failures with context

## Testing

### Test Coverage

The shipping fee functionality includes comprehensive test coverage:

- **Unit Tests**: Individual method testing
- **Integration Tests**: End-to-end subscription creation
- **Edge Case Tests**: Error scenarios and edge cases
- **Mock Data**: Realistic test data for all scenarios

### Test Scenarios

1. **Successful shipping price creation**
2. **Existing price retrieval**
3. **No shipping information handling**
4. **Price compatibility validation**
5. **Metadata search functionality**
6. **Error handling scenarios**

## Best Practices

### Implementation Guidelines

1. **Always validate shipping information** before processing
2. **Use proper error handling** for all Stripe API calls
3. **Maintain consistent metadata** for price tracking
4. **Log operations** for debugging and monitoring
5. **Handle edge cases** gracefully

### Performance Considerations

1. **Cache shipping prices** when possible to reduce API calls
2. **Batch operations** for multiple shipping methods
3. **Optimize metadata searches** for better performance
4. **Monitor Stripe API usage** to stay within limits

## Troubleshooting

### Common Issues

1. **Shipping prices not created**: Check cart shipping information
2. **Metadata mismatches**: Verify shipping method IDs and amounts
3. **Billing interval conflicts**: Ensure shipping prices match subscription intervals
4. **API rate limits**: Monitor Stripe API usage

### Debug Steps

1. Check cart shipping information
2. Verify Stripe product creation
3. Review metadata consistency
4. Check Stripe API responses
5. Review application logs

## Future Enhancements

### Planned Features

1. **Dynamic shipping rate calculation**
2. **Multi-currency shipping support**
3. **Shipping method validation**
4. **Advanced shipping rules**
5. **Shipping cost analytics**

### Extension Points

The current implementation provides extension points for:

- Custom shipping price calculation
- Advanced shipping validation
- Integration with external shipping providers
- Custom metadata handling 