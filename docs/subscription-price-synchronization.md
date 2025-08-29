# Subscription Price Synchronization & Management

## Overview

This document provides comprehensive information about the subscription price synchronization system and the enhanced subscription management capabilities in the Stripe-Commercetools connector.

## Price Synchronization Architecture

### Source of Truth Principles

The connector implements a sophisticated architecture that separates concerns between Stripe and commercetools:

- **Stripe**: Source of truth for **products** (subscription lifecycle, billing cycles, customer relationships)
- **Commercetools**: Source of truth for **prices** (product pricing, variants, business logic)
- **Synchronization Layer**: Automatically aligns subscription prices between systems

### How It Works

#### Automatic Mode (`STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true`)
1. **Webhook Trigger**: `invoice.upcoming` event received from Stripe
2. **Price Comparison**: System compares current Stripe price with commercetools product price
3. **Automatic Update**: If prices differ, subscription is updated with current commercetools price
4. **Same-Period Billing**: Price change takes effect for current billing period

#### Standard Mode (`STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=false`)
1. **Invoice Payment**: Customer pays invoice with old price
2. **Post-Payment Update**: `createOrder` method detects price difference
3. **Next-Cycle Update**: Price change takes effect for next billing cycle

### Configuration

#### Environment Variables
```bash
# Enable automatic price synchronization
export STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true

# Choose payment handling strategy (independent of price sync)
export STRIPE_SUBSCRIPTION_PAYMENT_HANDLING=createOrder  # or addPaymentToOrder
```

#### Webhook Configuration
Ensure your Stripe webhook endpoint receives `invoice.upcoming` events:
- **Event Type**: `invoice.upcoming`
- **Purpose**: Triggers price synchronization before invoice creation
- **Timing**: Before each billing cycle

## Enhanced Subscription Management

### updateSubscription Method

The connector provides a comprehensive `updateSubscription` method for managing subscription changes while maintaining data consistency.

#### API Endpoint
```
POST /subscription-api/:customerId
```

#### Authentication
OAuth2 authentication with "manage_project" and "manage_subscriptions" scopes.

#### Request Schema
```typescript
{
  subscriptionId: string;           // ID of subscription to update
  newSubscriptionVariantId: string; // New product variant ID
  newSubscriptionVariantPosition: number; // Variant position (1 = master)
  newSubscriptionPriceId: string;   // Specific price ID from variant
}
```

#### Use Cases

1. **Product Variant Changes**
   - Switch between different sizes, colors, or configurations
   - Update subscription to new product variants
   - Handle product discontinuation scenarios

2. **Price Updates**
   - Move customers to new pricing tiers
   - Apply promotional pricing
   - Handle seasonal price changes

3. **Subscription Configuration Changes**
   - Modify billing cycles and trial periods
   - Update subscription attributes
   - Change collection methods

4. **Product Migration**
   - Move customers to new product versions
   - Handle product line updates
   - Manage product consolidation

#### Example Requests

**Update to Different Variant:**
```bash
curl -X POST "https://your-connector-url/subscription-api/customer-12345" \
  -H "Authorization: Bearer <commercetools-oauth2-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "subscriptionId": "sub_1234567890",
    "newSubscriptionVariantId": "product-456",
    "newSubscriptionVariantPosition": 2,
    "newSubscriptionPriceId": "price-789"
  }'
```

**Update to Master Variant:**
```bash
curl -X POST "https://your-connector-url/subscription-api/customer-12345" \
  -H "Authorization: Bearer <commercetools-oauth2-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "subscriptionId": "sub_1234567890",
    "newSubscriptionVariantId": "product-456",
    "newSubscriptionVariantPosition": 1,
    "newSubscriptionPriceId": "price-789"
  }'
```

#### Response Format
```json
{
  "id": "sub_1234567890",
  "status": "active",
  "outcome": "updated",
  "message": "Subscription sub_1234567890 has been successfully updated."
}
```

### How updateSubscription Works

#### 1. Validation Phase
- Verifies customer owns the subscription
- Ensures subscription exists and is active
- Validates subscription has items to update

#### 2. Product Retrieval Phase
- Fetches new product variant from commercetools
- Retrieves specific price information
- Validates subscription attributes on variant

#### 3. Price Creation Phase
- Creates or retrieves corresponding Stripe price
- Ensures price matches commercetools configuration
- Handles recurring interval setup

#### 4. Subscription Update Phase
- Updates Stripe subscription with new price
- Applies new subscription configuration
- Maintains existing quantity and customer data

#### 5. Attribute Synchronization Phase
- Inherits subscription attributes from new variant
- Updates billing cycles, trial periods, etc.
- Maintains consistency with product configuration

## Best Practices

### 1. Environment Configuration
```bash
# Recommended setup for dynamic pricing
export STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true
export STRIPE_SUBSCRIPTION_PAYMENT_HANDLING=createOrder
```

### 2. Product Management
- Always update prices in commercetools first
- Ensure product variants have proper subscription attributes
- Use consistent price IDs across your catalog
- Test price changes in development environment

### 3. Webhook Management
- Configure `invoice.upcoming` webhook events
- Monitor webhook delivery and processing
- Set up webhook retry mechanisms
- Test webhook endpoints regularly

### 4. Monitoring and Logging
- Monitor price synchronization logs
- Track subscription update operations
- Set up alerts for synchronization failures
- Monitor webhook event processing

### 5. Testing Strategy
1. **Price Sync Testing**
   - Create test subscription with known price
   - Update product price in commercetools
   - Verify automatic synchronization

2. **Update API Testing**
   - Test variant switching scenarios
   - Verify price inheritance
   - Test error handling

3. **Integration Testing**
   - Test with real Stripe webhooks
   - Verify end-to-end workflows
   - Test error recovery scenarios

## Error Handling

### Common Issues and Solutions

#### Missing Products
- **Error**: "Product with ID {id} not found in commercetools"
- **Solution**: Ensure product exists before subscription operations
- **Prevention**: Validate product existence in business logic

#### Missing Variants
- **Error**: "No variant found with ID {id} in product {productId}"
- **Solution**: Check variant position and product structure
- **Prevention**: Use consistent variant numbering (1 = master)

#### Missing Prices
- **Error**: "No price found with ID {id} in product {productId}"
- **Solution**: Verify price ID exists on the specified variant
- **Prevention**: Validate price IDs in product data

#### Webhook Failures
- **Error**: Price synchronization not triggered
- **Solution**: Check webhook endpoint configuration and authentication
- **Prevention**: Monitor webhook delivery and set up retry mechanisms

## Performance Considerations

### Optimization Strategies
- **Batch Processing**: Price synchronization processes subscriptions individually for optimal performance
- **Caching**: Product and price data is cached to minimize API calls
- **Idempotency**: Operations are idempotent to prevent duplicate updates
- **Async Processing**: Webhook processing is asynchronous to maintain responsiveness

### Monitoring Metrics
- **Synchronization Time**: Track time required for price updates
- **API Call Volume**: Monitor commercetools and Stripe API usage
- **Error Rates**: Track synchronization success/failure rates
- **Webhook Latency**: Monitor webhook processing times

## Integration Examples

### E-commerce Platform Integration
```typescript
// Example: Update subscription when customer changes plan
async function updateCustomerPlan(customerId: string, newPlanId: string) {
  const subscription = await getCustomerSubscription(customerId);
  const newPlan = await getProductPlan(newPlanId);
  
  await updateSubscription({
    customerId,
    subscriptionId: subscription.id,
    newSubscriptionVariantId: newPlan.productId,
    newSubscriptionVariantPosition: 1, // Master variant
    newSubscriptionPriceId: newPlan.priceId
  });
}
```

### Subscription Management Dashboard
```typescript
// Example: Handle subscription upgrades/downgrades
async function handlePlanChange(request: PlanChangeRequest) {
  try {
    const result = await updateSubscription({
      customerId: request.customerId,
      subscriptionId: request.subscriptionId,
      newSubscriptionVariantId: request.newPlan.productId,
      newSubscriptionVariantPosition: request.newPlan.variantPosition,
      newSubscriptionPriceId: request.newPlan.priceId
    });
    
    // Notify customer of successful plan change
    await sendPlanChangeConfirmation(result);
    
  } catch (error) {
    // Handle errors and notify customer
    await handlePlanChangeError(error);
  }
}
```

## Troubleshooting

### Debug Mode
Enable detailed logging for troubleshooting:
```bash
export LOGGER_LEVEL=debug
```

### Common Debug Scenarios
1. **Price Sync Not Working**
   - Check webhook configuration
   - Verify environment variables
   - Review webhook logs

2. **Update API Failures**
   - Validate request payload
   - Check product and variant existence
   - Verify authentication and permissions

3. **Performance Issues**
   - Monitor API response times
   - Check caching effectiveness
   - Review webhook processing times

### Support Resources
- **Logs**: Check application logs for detailed error information
- **Stripe Dashboard**: Monitor webhook delivery and subscription changes
- **Commercetools Console**: Verify product and price data
- **API Documentation**: Reference Stripe and commercetools API docs

## Conclusion

The subscription price synchronization system provides a robust foundation for managing subscription pricing while maintaining data consistency between Stripe and commercetools. The enhanced `updateSubscription` method enables comprehensive subscription management capabilities that work seamlessly with the automatic synchronization system.

By following the best practices outlined in this document, you can ensure reliable price synchronization and effective subscription management in your e-commerce platform.
