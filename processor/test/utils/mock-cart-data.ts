import { Cart, LineItem, CustomLineItem, ShippingInfo, Order } from '@commercetools/connect-payments-sdk';
import { ProductVariant } from '@commercetools/platform-sdk';
import { randomUUID } from 'crypto';
import { mockCtCustomerId } from './mock-customer-data';

export const mockGetCartResult = () => {
  const cartId = randomUUID();
  const mockGetCartResult: Cart = {
    id: cartId,
    customerId: mockCtCustomerId,
    version: 1,
    lineItems: [lineItem],
    customLineItems: [customLineItem],
    totalPrice: {
      type: 'centPrecision',
      currencyCode: 'USD',
      centAmount: 150000,
      fractionDigits: 2,
    },
    cartState: 'Ordered',
    origin: 'Customer',
    taxMode: 'ExternalAmount',
    taxRoundingMode: 'HalfEven',
    taxCalculationMode: 'LineItemLevel',
    shipping: [],
    discountCodes: [],
    directDiscounts: [],
    refusedGifts: [],
    itemShippingAddresses: [],
    inventoryMode: 'ReserveOnOrder',
    shippingMode: 'Single',
    shippingInfo: shippingInfo,
    createdAt: '2024-01-01T00:00:00Z',
    lastModifiedAt: '2024-01-01T00:00:00Z',
    customerEmail: 'test@example.com',
    paymentInfo: {
      payments: [
        {
          id: 'paymentId',
          typeId: 'payment',
          obj: undefined,
        },
      ],
    },
    shippingAddress: {
      title: 'Mr.',
      firstName: 'John',
      lastName: 'Smith',
      streetName: 'Test street',
      streetNumber: '123',
      postalCode: '12345',
      city: 'Los Angeles',
      state: 'CA',
      country: 'US',
      phone: '+312345678',
      mobile: '+312345679',
      email: 'test@example.com',
      key: 'address1',
      additionalStreetInfo: 'department 1',
    },
    custom: {
      type: {
        typeId: 'type',
        id: 'xxxxxxxxxxx',
      },
      fields: {
        stripeCustomerId: 'cus_Example',
      },
    },
  };
  return mockGetCartResult;
};

export const mockGetCartWithoutCustomerIdResult = () => {
  const cartId = randomUUID();
  const mockGetCartResult: Cart = {
    id: cartId,
    customerId: '',
    version: 1,
    lineItems: [lineItem],
    customLineItems: [customLineItem],
    totalPrice: {
      type: 'centPrecision',
      currencyCode: 'USD',
      centAmount: 150000,
      fractionDigits: 2,
    },
    cartState: 'Ordered',
    origin: 'Customer',
    taxMode: 'ExternalAmount',
    taxRoundingMode: 'HalfEven',
    taxCalculationMode: 'LineItemLevel',
    shipping: [],
    discountCodes: [],
    directDiscounts: [],
    refusedGifts: [],
    itemShippingAddresses: [],
    inventoryMode: 'ReserveOnOrder',
    shippingMode: 'Single',
    shippingInfo: shippingInfo,
    createdAt: '2024-01-01T00:00:00Z',
    lastModifiedAt: '2024-01-01T00:00:00Z',
    customerEmail: 'test@example.com',
    paymentInfo: {
      payments: [
        {
          id: 'paymentId',
          typeId: 'payment',
          obj: undefined,
        },
      ],
    },
    shippingAddress: {
      title: 'Mr.',
      firstName: 'John',
      lastName: 'Smith',
      streetName: 'Test street',
      streetNumber: '123',
      postalCode: '12345',
      city: 'Los Angeles',
      state: 'CA',
      country: 'US',
      phone: '+312345678',
      mobile: '+312345679',
      email: 'test@example.com',
      key: 'address1',
      additionalStreetInfo: 'department 1',
    },
  };
  return mockGetCartResult;
};

export const variantOne: ProductVariant = {
  id: 1,
  sku: 'variant-sku-1',
  attributes: [
    { name: 'cancel_at_period_end', value: false },
    {
      name: 'collection_method',
      value: {
        key: 'charge_automatically',
        label: 'charge_automatically',
      },
    },
    { name: 'off_session', value: true },
    { name: 'recurring_interval_count', value: 1 },
    {
      name: 'recurring_interval',
      value: {
        key: 'month',
        label: 'month',
      },
    },
    {
      name: 'missing_payment_method_at_trial_end',
      value: {
        key: 'create_invoice',
        label: 'create_invoice',
      },
    },
    { name: 'description', value: 'Weekly Subscription with trial days' },
    { name: 'trial_period_days', value: 3 },
  ],
};

export const variantSix: ProductVariant = {
  id: 6,
  sku: 'variant-sku-6',
  attributes: [
    { name: 'recurring_interval_count', value: 1 },
    { name: 'off_session', value: true },
    { name: 'billing_cycle_anchor_date', value: '2025-05-20T21:00:00.000Z' },
    { name: 'description', value: 'Monthly Subscription with Anchor Days, no proration and send invoice' },
    { name: 'days_until_due', value: 3 },
    {
      name: 'recurring_interval',
      value: {
        key: 'month',
        label: 'month',
      },
    },
    {
      name: 'collection_method',
      value: {
        key: 'send_invoice',
        label: 'send_invoice',
      },
    },
    {
      name: 'proration_behavior',
      value: {
        key: 'none',
        label: 'none',
      },
    },
  ],
};

export const variantEight: ProductVariant = {
  id: 8,
  sku: 'variant-sku-8',
  attributes: [
    { name: 'recurring_interval_count', value: 1 },
    { name: 'off_session', value: true },
    { name: 'billing_cycle_anchor_date', value: '2025-09-30T07:00:00.000Z' },
    { name: 'description', value: 'Monthly Subscription with Anchor Days, proration and send invoice' },
    { name: 'days_until_due', value: 1 },
    {
      name: 'recurring_interval',
      value: {
        key: 'month',
        label: 'month',
      },
    },
    {
      name: 'collection_method',
      value: {
        key: 'send_invoice',
        label: 'send_invoice',
      },
    },
    {
      name: 'proration_behavior',
      value: {
        key: 'create_prorations',
        label: 'create_prorations',
      },
    },
  ],
};

const variants = {
  1: variantOne,
  6: variantSix,
  8: variantEight,
};

export const lineItem: LineItem = {
  id: 'lineitem-id-1',
  productId: 'product-id-1',
  name: {
    en: 'lineitem-name-1',
  },
  productType: {
    id: 'product-type-reference-1',
    typeId: 'product-type',
  },
  price: {
    id: 'price-id-1',
    value: {
      type: 'centPrecision',
      currencyCode: 'USD',
      centAmount: 150000,
      fractionDigits: 2,
    },
  },
  quantity: 1,
  totalPrice: {
    type: 'centPrecision',
    currencyCode: 'USD',
    centAmount: 150000,
    fractionDigits: 2,
  },
  discountedPricePerQuantity: [],
  taxedPricePortions: [],
  state: [],
  perMethodTaxRate: [],
  priceMode: 'Platform',
  lineItemMode: 'Standard',
  variant: {
    id: 6,
    sku: 'variant-sku-6',
  },
};

export const lineItemSubscription: LineItem = {
  ...lineItem,
  productType: {
    id: 'product-type-reference-1',
    typeId: 'product-type',
    obj: {
      id: 'product-type-id',
      version: 1,
      name: 'subscription-information',
      createdAt: '2024-01-01T00:00:00Z',
      lastModifiedAt: '2024-01-01T00:00:00Z',
      description: 'The product type.',
    },
  },
};

export const customLineItem: CustomLineItem = {
  id: 'customLineItem-id-1',
  name: {
    en: 'customLineItem-name-1',
  },
  slug: '',
  money: {
    type: 'centPrecision',
    currencyCode: 'USD',
    centAmount: 150000,
    fractionDigits: 2,
  },
  quantity: 1,
  totalPrice: {
    type: 'centPrecision',
    currencyCode: 'USD',
    centAmount: 150000,
    fractionDigits: 2,
  },
  discountedPricePerQuantity: [],
  taxedPricePortions: [],
  state: [],
  perMethodTaxRate: [],
  priceMode: 'Platform',
};

export const shippingInfo: ShippingInfo = {
  shippingMethodName: 'shippingMethodName1',
  price: {
    type: 'centPrecision',
    currencyCode: 'USD',
    centAmount: 150000,
    fractionDigits: 2,
  },
  shippingRate: {
    price: {
      type: 'centPrecision',
      currencyCode: 'USD',
      centAmount: 1000,
      fractionDigits: 2,
    },
    tiers: [],
  },
  shippingMethodState: 'MatchesCart',
};

export const mockGetSubscriptionCart: Cart = {
  ...mockGetCartResult(),
  lineItems: [lineItemSubscription],
};

const getVariant = (num: keyof typeof variants): ProductVariant => {
  return variants[num];
};

export const mockGetSubscriptionCartWithVariant = (num: keyof typeof variants): Cart => ({
  ...mockGetCartResult(),
  lineItems: [{ ...lineItemSubscription, variant: getVariant(num) }],
});

export const mockGetSubscriptionCartWithTwoItems: Cart = {
  ...mockGetCartResult(),
  lineItems: [
    { ...lineItemSubscription, variant: getVariant(1), quantity: 2 },
    { ...lineItemSubscription, variant: getVariant(6) },
  ],
};

export const orderMock = {
  id: 'mock-order-id',
  version: 1,
  orderState: 'Open',
  paymentState: 'Paid',
} as Order;
