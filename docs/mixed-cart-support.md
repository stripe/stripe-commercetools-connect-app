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
- **One-Time Items**: Processed as immediate payment through Stripe invoices

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

#### `createOneTimeItemsInvoice(cart, stripeCustomerId, oneTimeItems)`
Creates separate Stripe invoices for one-time items in mixed carts.

```typescript
private async createOneTimeItemsInvoice(
  cart: Cart, 
  stripeCustomerId: string, 
  oneTimeItems: Array<{ price: string; quantity: number }>
): Promise<void> {
  try {
    // Create invoice items for each one-time item
    for (const item of oneTimeItems) {
      await stripe.invoiceItems.create({
        customer: stripeCustomerId,
        price: item.price,
        quantity: item.quantity,
        description: 'One-time item from commercetools cart',
      }, { idempotencyKey: randomUUID() });
    }

    // Create and finalize the invoice
    const invoice = await stripe.invoices.create({ 
      customer: stripeCustomerId,
      metadata: { 
        cartId: cart.id,
        type: 'one-time-items'
      }
    }, { idempotencyKey: randomUUID() });

    await stripe.invoices.finalizeInvoice(invoice.id);

    log.info('One-time items invoice created and finalized.', {
      ctCartId: cart.id,
      stripeInvoiceId: invoice.id,
      itemsCount: oneTimeItems.length,
    });
  } catch (error) {
    log.error('Failed to create one-time items invoice.', {
      ctCartId: cart.id,
      error: error,
    });
    throw error;
  }
}
```

#### Enhanced `createSubscription()`
The main subscription creation method now handles mixed carts by creating separate invoices for one-time items.

```typescript
public async createSubscription(): Promise<SubscriptionResponseSchemaDTO> {
  try {
    const { cart, amountPlanned, priceId, stripeCustomerId, subscriptionParams, billingAddress, merchantReturnUrl, shippingPriceId } =
      await this.prepareSubscriptionData();

    // Handle one-time items if present
    const oneTimeItems = await this.getAllLineItemPrices(cart);
    if (oneTimeItems.length > 0) {
      await this.createOneTimeItemsInvoice(cart, stripeCustomerId!, oneTimeItems);
    }

    // Create subscription with only subscription and shipping items
    const subscription = await stripe.subscriptions.create({
      ...subscriptionParams,
      customer: stripeCustomerId!,
      items: [
        { price: priceId, quantity: this.findSubscriptionLineItem(cart).quantity || 1 }, 
        ...(shippingPriceId ? [{ price: shippingPriceId }] : []),
      ],
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
// 2. Stripe Invoice created for the one-time products
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
// 2. Stripe Invoice created for the one-time product
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

The system includes comprehensive metadata tracking for both subscription and invoice items:

### Subscription Metadata
- Cart ID
- Payment metadata from commercetools
- Subscription-specific information

### Invoice Metadata
- Cart ID
- Type: 'one-time-items'
- Invoice-specific information

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

- One-time items are processed as immediate invoices (not part of the subscription)
- Shipping fees are only applied to subscription items
- Coupons and discounts are applied separately to subscriptions and invoices
- One-time items cannot be part of trial periods
- If the shipping address is updated after checkout, the original shipping fee amount will continue to be charged for the subscription.