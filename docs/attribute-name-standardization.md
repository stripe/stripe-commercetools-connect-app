# Attribute Name Standardization

This document describes the attribute name standardization changes implemented in the latest version of the Stripe Composable Connector.

## Overview

The connector has been updated to use a standardized naming convention for all subscription-related product type attributes. All attributes now use the `stripeConnector_` prefix for better organization, consistency, and maintainability.

## Changes Made

### Attribute Name Updates

All subscription-related product type attributes have been updated to use the `stripeConnector_` prefix:

| Old Name | New Name | Description |
|----------|----------|-------------|
| `description` | `stripeConnector_description` | Subscription description |
| `recurring_interval` | `stripeConnector_recurring_interval` | Billing frequency |
| `recurring_interval_count` | `stripeConnector_recurring_interval_count` | Number of intervals between billings |
| `off_session` | `stripeConnector_off_session` | Off-session usage flag |
| `collection_method` | `stripeConnector_collection_method` | Payment collection method |
| `days_until_due` | `stripeConnector_days_until_due` | Days until invoice due |
| `cancel_at_period_end` | `stripeConnector_cancel_at_period_end` | Cancel at period end flag |
| `cancel_at` | `stripeConnector_cancel_at` | Specific cancellation date |
| `billing_cycle_anchor_day` | `stripeConnector_billing_cycle_anchor_day` | Day of month for billing |
| `billing_cycle_anchor_time` | `stripeConnector_billing_cycle_anchor_time` | Time of day for billing |
| `billing_cycle_anchor_date` | `stripeConnector_billing_cycle_anchor_date` | Specific billing anchor date |
| `trial_period_days` | `stripeConnector_trial_period_days` | Trial period length in days |
| `trial_end_date` | `stripeConnector_trial_end_date` | Specific trial end date |
| `missing_payment_method_at_trial_end` | `stripeConnector_missing_payment_method_at_trial_end` | Behavior when payment method missing |
| `proration_behavior` | `stripeConnector_proration_behavior` | Proration behavior for changes |

### Automatic Transformation

The `transformVariantAttributes` utility function has been enhanced to automatically handle the transformation between prefixed attribute names and internal field names:

```typescript
// Enhanced function automatically strips prefixes
export const transformVariantAttributes = <T>(attributes?: Attribute[]): T => {
  const result: Record<string, string> = {};
  for (const { name, value } of attributes ?? []) {
    // Remove 'stripeConnector_' prefix if present
    const cleanName = name.startsWith('stripeConnector_') ? name.replace('stripeConnector_', '') : name;
    result[cleanName] = isObject(value) ? value.key : value;
  }
  return result as T;
};
```

## Benefits

### 1. Better Organization
- Clear separation between connector-specific attributes and general product attributes
- Easier identification of subscription-related fields
- Consistent naming convention across all connector components

### 2. Improved Maintainability
- Reduced naming conflicts with other product attributes
- Clear ownership of attributes by the Stripe connector
- Easier to extend with new attributes in the future

### 3. Enhanced Compatibility
- Backward compatibility maintained through automatic transformation
- Support for both old and new attribute name formats
- No breaking changes for existing implementations

### 4. Better Debugging
- Clear attribute ownership in logs and error messages
- Easier to identify connector-related issues
- Improved troubleshooting capabilities

## Implementation Details

### Product Type Definition

The custom product type `payment-connector-subscription-information` now defines all attributes with the `stripeConnector_` prefix:

```typescript
export const productTypeSubscription: ProductTypeDraft = {
  name: 'payment-connector-subscription-information',
  key: 'payment-connector-subscription-information',
  description: 'The subscription-information product type.',
  attributes: [
    {
      name: 'stripeConnector_description',
      label: { 'en-US': 'Description' },
      // ... other configuration
    },
    {
      name: 'stripeConnector_recurring_interval',
      label: { 'en-US': 'Recurring Interval' },
      // ... other configuration
    },
    // ... additional attributes
  ],
};
```

### Automatic Processing

The subscription service automatically processes the transformed attribute names:

```typescript
// Product type attributes (with prefix)
const productAttributes = [
  { name: 'stripeConnector_description', value: 'Monthly subscription' },
  { name: 'stripeConnector_recurring_interval', value: { key: 'month' } },
  { name: 'stripeConnector_off_session', value: true }
];

// Transformed to internal format (prefix removed)
const subscriptionParams = getSubscriptionAttributes(productAttributes);
// Result: { description: 'Monthly subscription', recurring_interval: 'month', off_session: true }
```

## Migration Guide

### For New Implementations
- Use the new `stripeConnector_` prefixed attribute names when defining product types
- No additional configuration required - transformation is automatic

### For Existing Implementations
- No migration required - the system automatically handles both formats
- Existing product types will continue to work without changes
- New deployments will use the standardized naming convention

### For Product Type Updates
- When updating existing product types, the system will automatically handle the transformation
- The `createProductTypeSubscription` function includes logic to compare and update attributes
- Updates are performed safely with proper error handling

## Testing

Comprehensive tests have been added to verify the attribute name transformation:

```typescript
test('should strip stripeConnector_ prefix from attribute names', () => {
  const attributes = [
    { name: 'stripeConnector_description', value: 'Test subscription' },
    { name: 'stripeConnector_recurring_interval', value: { key: 'month' } },
    { name: 'stripeConnector_off_session', value: true },
  ];
  const result = transformVariantAttributes(attributes);
  expect(result).toEqual({ 
    description: 'Test subscription', 
    recurring_interval: 'month',
    off_session: true 
  });
});
```

## Impact Assessment

### Performance Impact
- Minimal performance impact from attribute name transformation
- Improved data consistency and organization
- Better error handling and debugging capabilities

### Security Impact
- No security changes
- Enhanced validation for attribute processing
- Improved error handling prevents information leakage

### Compatibility Impact
- Full backward compatibility maintained
- No breaking changes for existing implementations
- Automatic handling of both attribute name formats

## Future Considerations

### Extensibility
- Easy to add new `stripeConnector_` prefixed attributes
- Clear pattern for future connector enhancements
- Consistent naming convention for all connector features

### Maintenance
- Simplified attribute management and organization
- Clear ownership and responsibility for connector attributes
- Improved debugging and troubleshooting capabilities

### Documentation
- Clear documentation of attribute naming conventions
- Easy to understand and maintain
- Consistent with industry best practices 