import { Cart, LineItem, CustomLineItem, ShippingInfo } from '@commercetools/connect-payments-sdk';
import { randomUUID } from 'crypto';

export const mockGetCartResult = () => {
  const cartId = randomUUID();
  const mockGetCartResult: Cart = {
    id: cartId,
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
    paymentInfo: {
      payments: [
        {
          id: 'paymentId',
          typeId: 'payment',
          obj: undefined,
        },
      ],
    },
  };
  return mockGetCartResult;
};

const lineItem: LineItem = {
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
    id: 1,
    sku: 'variant-sku-1',
  },
};

const customLineItem: CustomLineItem = {
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

const shippingInfo: ShippingInfo = {
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
