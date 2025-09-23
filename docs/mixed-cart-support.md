# Mixed Cart Support

## Overview

The Stripe Payment Connector now supports mixed carts containing both subscription items and one-time items. This feature enables customers to purchase subscription products alongside regular products in a single transaction, with automatic handling of different billing scenarios.

## What is a Mixed Cart?

A mixed cart is a shopping cart that contains:
- **Subscription Items**: Products configured with the `payment-connector-subscription-information` product type that require recurring billing
- **One-Time Items**: Regular products that require immediate payment

## How It Works

### 1. Cart Analysis
The system automatically analyzes the cart during subscription creation to identify:
- Items with the `payment-connector-subscription-information` product type (subscription items)
- All other items (one-time items)

### 2. Separate Processing
- **Subscription Items**: Processed as recurring billing through Stripe subscriptions
- **One-Time Items**: Processed as immediate payment through the first Stripe subscription invoice

### 3. Unified Checkout Experience
Customers experience a seamless checkout process regardless of cart composition, with all items processed in a single transaction.

## Technical Implementation

### Key Methods

#### `getAllLineItemPrices(cart: Cart)`
Retrieves all line item prices excluding subscription items for one-time item processing.

```typescript
private async getAllLineItemPrices(cart: Cart): Promise<Array<{ price: string; quantity: number }>> {
  const subscriptionLineItem = this.findSubscriptionLineItem(cart);
  const lineItemPrices: Array<{ price: string; quantity: number }> = [];

  for (const lineItem of cart.lineItems) {
    if (lineItem.productType.obj?.name === productTypeSubscription.name) {
      continue; // Skip subscription items
    }

    const priceId = await this.getLineItemPriceId(lineItem);
    lineItemPrices.push({
      price: priceId,
      quantity: lineItem.quantity || 1,
    });
  }

  return lineItemPrices;
}
```

#### Enhanced `createSubscription()`
The main subscription creation method now handles mixed carts by adding the one time items to the subscription's first invoice.

```typescript
public async createSubscription(): Promise<SubscriptionResponseSchemaDTO> {
  try {
    const { cart, amountPlanned, priceId, stripeCustomerId, subscriptionParams, billingAddress, merchantReturnUrl, shippingPriceId } =
      await this.prepareSubscriptionData();

    // Handle one-time items if present
    const oneTimeItems = await this.getAllLineItemPrices(cart);

    // Create subscription with one-time items
    const subscription = await stripe.subscriptions.create({
      ...subscriptionParams,
      customer: stripeCustomerId!,
      items: [
        { price: priceId, quantity: this.findSubscriptionLineItem(cart).quantity || 1 }, 
        ...(shippingPriceId ? [{ price: shippingPriceId }] : []),
      ],
      add_invoice_items: oneTimeItems, // Here
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata: this.paymentCreationService.getPaymentMetadata(cart),
      discounts: await this.stripeCouponService.getStripeCoupons(cart),
    }, { idempotencyKey: randomUUID() });

    // ... rest of the method
  } catch (error) {
    throw wrapStripeError(error);
  }
}
```

## Usage Examples

### Example 1: Basic Mixed Cart
```typescript
// Cart contains:
// - 1x Monthly Subscription Product (recurring)
// - 2x One-time Product (immediate payment)

const result = await stripeSubscriptionService.createSubscription();

// Result:
// 1. Stripe Subscription created for the monthly product
// 2. First Subscription invoice contains the one-time items
// 3. Both processed in the same transaction
```

### Example 2: Mixed Cart with Shipping
```typescript
// Cart contains:
// - 1x Annual Subscription Product (recurring)
// - 1x One-time Product (immediate payment)
// - Shipping information

const result = await stripeSubscriptionService.createSubscription();

// Result:
// 1. Stripe Subscription created for the annual product + shipping
// 2. First Subscription invoice contains the one-time items
// 3. Shipping included in subscription billing
```

### Example 3: Subscription-Only Cart
```typescript
// Cart contains only subscription items
// - 1x Monthly Subscription Product

const result = await stripeSubscriptionService.createSubscription();

// Result:
// 1. Stripe Subscription created (no separate invoice needed)
```

## Metadata Tracking

The system includes comprehensive metadata tracking for the subscription and invoice items:

### Metadata
- Cart ID
- Payment metadata from commercetools
- Subscription-specific information in the case of the subscription

__NOTE:__ When dealing with the Stripe invoice object, keep in mind that a snapshot of the metadata at the time can be found within the invoice data, as explained (here)[https://docs.stripe.com/billing/invoices/subscription#subscription-metadata]

## Testing

The mixed cart support includes comprehensive test coverage:

### Test Scenarios
- Mixed cart with subscription and one-time items
- Subscription-only cart
- One-time items only cart
- Error scenarios
- Quantity handling
- Metadata tracking

### Running Tests
```bash
npm test -- --testPathPatterns=stripe-subscription.service.spec.ts
```

## Configuration

No additional configuration is required for mixed cart support. The feature is automatically enabled and works with existing subscription configurations.

### Requirements
- Valid Stripe customer ID
- Properly configured subscription product types
- Valid Stripe price IDs for all items

## Limitations

- Shipping fees are only applied to subscription items
- Coupons and discounts are applied separately to subscriptions and invoices
- One-time items cannot be part of trial periods
- If the shipping address is updated after checkout, the original shipping fee amount will continue to be charged for the subscription.