/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {}),
}));

import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { StripeSubscriptionService } from '../../src/services/stripe-subscription.service';
import { paymentSDK } from '../../src/payment-sdk';
import { mockGetSubscriptionCartWithVariant } from '../utils/mock-cart-data';
import { CtPaymentCreationService } from '../../src/services/ct-payment-creation.service';
import { mockEvent__invoice_upcoming__simple } from '../utils/mock-subscription-data';

import * as Config from '../../src/config/config';
import * as PriceClient from '../../src/services/commerce-tools/price-client';
import {
  METADATA_PRODUCT_ID_FIELD,
  METADATA_CUSTOMER_ID_FIELD,
  METADATA_PAYMENT_ID_FIELD,
  METADATA_PROJECT_KEY_FIELD,
  METADATA_CART_ID_FIELD,
} from '../../src/constants';

jest.mock('../../src/libs/logger', () => ({
  log: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../src/payment-sdk', () => ({
  paymentSDK: {
    ctCartService: {},
    ctPaymentService: {
      getPayment: jest.fn(),
    },
    ctOrderService: {},
    ctAPI: {},
  },
}));

describe('stripe-subscription.service.business-logic', () => {
  const opts = {
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
    ctOrderService: paymentSDK.ctOrderService,
  };
  const stripeSubscriptionService = new StripeSubscriptionService(opts);

  beforeEach(async () => {
    jest.setTimeout(10000);
    jest.resetAllMocks();

    Stripe.prototype.subscriptions = {
      retrieve: jest.fn(),
      update: jest.fn(),
    } as unknown as Stripe.SubscriptionsResource;

    Stripe.prototype.prices = {
      search: jest.fn<() => Promise<Stripe.ApiList<Stripe.Price>>>(),
      create: jest.fn<() => Promise<Stripe.Response<Stripe.Price>>>(),
      update: jest.fn<() => Promise<Stripe.Response<Stripe.Price>>>(),
    } as unknown as Stripe.PricesResource;

    Stripe.prototype.setupIntents = {
      create: jest.fn<() => Promise<Stripe.Response<Stripe.SetupIntent>>>(),
      retrieve: jest.fn<() => Promise<Stripe.Response<Stripe.SetupIntent>>>(),
    } as unknown as Stripe.SetupIntentsResource;

    Stripe.prototype.products = {
      retrieve: jest.fn(),
      search: jest.fn(),
    } as unknown as Stripe.ProductsResource;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('method processUpcomingSubscriptionEvent', () => {
    test('should process upcoming subscription event successfully when price sync is enabled', async () => {
      jest.spyOn(Config, 'getConfig').mockReturnValue({
        ...Config.getConfig(),
        subscriptionPriceSyncEnabled: true,
      } as ReturnType<typeof Config.getConfig>);

      const mockEvent = {
        id: 'evt_123',
        type: 'invoice.upcoming',
        data: { object: { id: 'in_123', subscription: 'sub_123' } },
      } as Stripe.Event;

      const mockSubscription = {
        id: 'sub_123',
        object: 'subscription',
        items: {
          data: [
            {
              id: 'si_123',
              price: {
                id: 'price_123',
                unit_amount: 1000,
                product: 'prod_123',
              },
            },
          ],
        },
        status: 'active',
        customer: 'cus_123',
        metadata: {},
        created: Date.now() / 1000,
      } as Stripe.Subscription;

      const mockResponse = {
        ...mockSubscription,
        lastResponse: {
          headers: {},
          requestId: 'req_123',
          statusCode: 200,
        },
      } as Stripe.Response<Stripe.Subscription>;
      const stripeSubscriptionRetrieveMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'retrieve')
        .mockResolvedValue(mockResponse as Stripe.Response<Stripe.Subscription>);

      const mockProduct = {
        id: 'prod_123',
        object: 'product',
        active: true,
        created: Date.now() / 1000,
        description: 'Test product',
        livemode: false,
        name: 'Test Product',
        updated: Date.now() / 1000,
        images: [],
        marketing_features: [],
        package_dimensions: null,
        shippable: false,
        type: 'service',
        unit_label: null,
        url: null,
        metadata: {
          ct_product_id: 'test-product-id',
        },
      } as unknown as Stripe.Product;

      const stripeProductRetrieveMock = jest
        .spyOn(Stripe.prototype.products, 'retrieve')
        .mockResolvedValue(mockProduct as Stripe.Response<Stripe.Product>);

      // Mock the price client
      const mockPrice = { centAmount: 1500, currencyCode: 'USD', fractionDigits: 2 };
      jest
        .spyOn(require('../../src/services/commerce-tools/price-client'), 'getProductMasterPrice')
        .mockResolvedValue(mockPrice);

      // Mock price search
      jest.spyOn(Stripe.prototype.prices, 'search').mockResolvedValue({
        data: [],
        object: 'search_result',
        has_more: false,
        next_page: null,
        url: '/v1/prices/search',
        lastResponse: {
          headers: {},
          requestId: 'req_123',
          statusCode: 200,
        },
      } as unknown as Stripe.Response<Stripe.ApiSearchResult<Stripe.Price>>);

      // Mock price creation
      const mockNewPrice = { id: 'price_new_123' } as Stripe.Price;
      jest.spyOn(Stripe.prototype.prices, 'create').mockResolvedValue(mockNewPrice as Stripe.Response<Stripe.Price>);

      // Mock subscription update
      jest
        .spyOn(Stripe.prototype.subscriptions, 'update')
        .mockResolvedValue(mockSubscription as Stripe.Response<Stripe.Subscription>);

      // Mock product search
      jest.spyOn(Stripe.prototype.products, 'search').mockResolvedValue({
        data: [mockProduct],
        object: 'search_result',
        has_more: false,
        next_page: null,
        url: '/v1/products/search',
        lastResponse: {
          headers: {},
          requestId: 'req_123',
          statusCode: 200,
        },
      } as unknown as Stripe.Response<Stripe.ApiSearchResult<Stripe.Product>>);

      await stripeSubscriptionService.processSubscriptionEventUpcoming(mockEvent);

      expect(stripeSubscriptionRetrieveMock).toHaveBeenCalled();
      expect(stripeProductRetrieveMock).toHaveBeenCalledWith('prod_123');
    });

    test('should skip processing when price sync is disabled', async () => {
      jest.spyOn(Config, 'getConfig').mockReturnValue({
        ...Config.getConfig(),
        subscriptionPriceSyncEnabled: false,
      } as ReturnType<typeof Config.getConfig>);

      const mockEvent = {
        id: 'evt_123',
        type: 'invoice.upcoming',
        data: { object: { id: 'in_123', subscription: 'sub_123' } },
      } as Stripe.Event;

      await stripeSubscriptionService.processSubscriptionEventUpcoming(mockEvent);

      expect(Stripe.prototype.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(Stripe.prototype.products.retrieve).not.toHaveBeenCalled();
    });

    test('should handle error when processing upcoming subscription event', async () => {
      jest.spyOn(Config, 'getConfig').mockReturnValue({
        ...Config.getConfig(),
        subscriptionPriceSyncEnabled: true,
      } as ReturnType<typeof Config.getConfig>);

      const mockEvent = {
        id: 'evt_123',
        type: 'invoice.upcoming',
        data: { object: { id: 'in_123', subscription: 'sub_123' } },
      } as Stripe.Event;

      Stripe.prototype.subscriptions = {
        retrieve: jest
          .fn<() => Promise<Stripe.Response<Stripe.Subscription>>>()
          .mockRejectedValue(new Error('Subscription not found')),
      } as unknown as Stripe.SubscriptionsResource;

      await expect(stripeSubscriptionService.processSubscriptionEventUpcoming(mockEvent)).resolves.toBeUndefined();

      expect(Stripe.prototype.subscriptions.retrieve).toHaveBeenCalledWith('sub_123');
    });

    test('should handle missing subscription ID in event data', async () => {
      const mockEvent = {
        id: 'evt_123',
        type: 'invoice.upcoming',
        data: { object: { id: 'in_123' } },
      } as Stripe.Event;

      await expect(stripeSubscriptionService.processSubscriptionEventUpcoming(mockEvent)).resolves.toBeUndefined();

      expect(Stripe.prototype.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    test('should handle undefined subscription ID in event data', async () => {
      const mockEvent = {
        ...mockEvent__invoice_upcoming__simple,
        data: {
          object: {
            ...mockEvent__invoice_upcoming__simple.data.object,
            subscription: undefined,
          } as unknown as Stripe.Invoice,
        },
      } as Stripe.Event;

      await expect(stripeSubscriptionService.processSubscriptionEventUpcoming(mockEvent)).resolves.toBeUndefined();

      expect(Stripe.prototype.subscriptions.retrieve).not.toHaveBeenCalled();
    });
  });

  describe('method updateSubscriptionMetadata', () => {
    test('should update subscription metadata successfully with all fields', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);
      const metadataProps = {
        subscriptionId: 'sub_123',
        cart: mockCart,
        ctPaymentId: 'ct_payment_123',
        customerId: 'ct_customer_123',
      };

      const mockResponse = {
        id: 'sub_123',
        object: 'subscription',
        status: 'active',
      } as Stripe.Response<Stripe.Subscription>;

      const stripeSubscriptionUpdateMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'update')
        .mockResolvedValue(mockResponse);

      await stripeSubscriptionService.updateSubscriptionMetadata(metadataProps);

      expect(stripeSubscriptionUpdateMock).toHaveBeenCalledWith(
        'sub_123',
        {
          metadata: {
            [METADATA_CART_ID_FIELD]: mockCart.id,
            [METADATA_PROJECT_KEY_FIELD]: expect.any(String),
            [METADATA_CUSTOMER_ID_FIELD]: 'ct_customer_123',
            [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
          },
        },
        { idempotencyKey: expect.any(String) },
      );
    });

    test('should update subscription metadata with only required fields', async () => {
      const metadataProps = {
        subscriptionId: 'sub_123',
        ctPaymentId: 'ct_payment_123',
      };

      const mockResponse = {
        id: 'sub_123',
        object: 'subscription',
        status: 'active',
      } as Stripe.Response<Stripe.Subscription>;

      const stripeSubscriptionUpdateMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'update')
        .mockResolvedValue(mockResponse);

      await stripeSubscriptionService.updateSubscriptionMetadata(metadataProps);

      expect(stripeSubscriptionUpdateMock).toHaveBeenCalledWith(
        'sub_123',
        {
          metadata: {
            [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
          },
        },
        { idempotencyKey: expect.any(String) },
      );
    });

    test('should skip update when no subscription ID provided', async () => {
      const metadataProps = {
        subscriptionId: '',
        ctPaymentId: 'ct_payment_123',
      };

      const stripeSubscriptionUpdateMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'update')
        .mockResolvedValue({} as Stripe.Response<Stripe.Subscription>);

      await stripeSubscriptionService.updateSubscriptionMetadata(metadataProps);

      expect(stripeSubscriptionUpdateMock).not.toHaveBeenCalled();
    });

    test('should skip update when no metadata fields provided', async () => {
      const metadataProps = {
        subscriptionId: 'sub_123',
      };

      const stripeSubscriptionUpdateMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'update')
        .mockResolvedValue({} as Stripe.Response<Stripe.Subscription>);

      await stripeSubscriptionService.updateSubscriptionMetadata(metadataProps);

      expect(stripeSubscriptionUpdateMock).not.toHaveBeenCalled();
    });

    test('should handle error when updating subscription metadata', async () => {
      const metadataProps = {
        subscriptionId: 'sub_123',
        ctPaymentId: 'ct_payment_123',
      };

      const stripeError = new Error('Update failed');
      Stripe.prototype.subscriptions = {
        update: jest.fn<() => Promise<Stripe.Response<Stripe.Subscription>>>().mockRejectedValue(stripeError),
      } as unknown as Stripe.SubscriptionsResource;

      try {
        await stripeSubscriptionService.updateSubscriptionMetadata(metadataProps);
      } catch (error) {
        console.log(`Error updating subscription metadata: ${JSON.stringify(error, null, 2)}`);
      }

      expect(Stripe.prototype.subscriptions.update).toHaveBeenCalled();
    });
  });

  describe('method synchronizeSubscriptionPrice', () => {
    test.each([
      {
        name: 'missing subscription items',
        subscription: { id: 'sub_123', items: { data: [] } },
        productMetadata: {},
        priceResult: undefined,
      },
      {
        name: 'missing product metadata',
        subscription: {
          id: 'sub_123',
          items: {
            data: [{ id: 'si_123', price: { id: 'price_123', unit_amount: 1000, product: 'prod_123' } }],
          },
        },
        productMetadata: {},
        priceResult: undefined,
      },
      {
        name: 'prices are different',
        subscription: {
          id: 'sub_123',
          items: {
            data: [{ id: 'si_123', price: { id: 'price_123', unit_amount: 1000, product: 'prod_123' } }],
          },
        },
        productMetadata: { [METADATA_PRODUCT_ID_FIELD]: 'ct_product_123' },
        priceResult: { centAmount: 1500, currencyCode: 'USD', fractionDigits: 2 },
      },
      {
        name: 'prices are the same',
        subscription: {
          id: 'sub_123',
          items: {
            data: [{ id: 'si_123', price: { id: 'price_123', unit_amount: 1000, product: 'prod_123' } }],
          },
        },
        productMetadata: { [METADATA_PRODUCT_ID_FIELD]: 'ct_product_123' },
        priceResult: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
      },
      {
        name: 'missing commercetools product price',
        subscription: {
          id: 'sub_123',
          items: {
            data: [{ id: 'si_123', price: { id: 'price_123', unit_amount: 1000, product: 'prod_123' } }],
          },
        },
        productMetadata: { [METADATA_PRODUCT_ID_FIELD]: 'ct_product_123' },
        priceResult: undefined,
      },
    ])('should handle $name gracefully', async ({ subscription, productMetadata, priceResult }) => {
      const mockEvent = {
        id: 'evt_123',
        type: 'invoice.upcoming',
        data: { object: { id: 'in_123', subscription: 'sub_123' } },
      } as Stripe.Event;

      Stripe.prototype.subscriptions = {
        retrieve: jest
          .fn<() => Promise<Stripe.Response<Stripe.Subscription>>>()
          .mockResolvedValue(subscription as Stripe.Response<Stripe.Subscription>),
      } as unknown as Stripe.SubscriptionsResource;

      Stripe.prototype.products = {
        retrieve: jest.fn<() => Promise<Stripe.Response<Stripe.Product>>>().mockResolvedValue({
          id: 'prod_123',
          metadata: productMetadata,
        } as Stripe.Response<Stripe.Product>),
      } as unknown as Stripe.ProductsResource;

      if (priceResult) {
        jest.spyOn(PriceClient, 'getProductMasterPrice').mockResolvedValue(priceResult);
      }

      await expect(stripeSubscriptionService.processSubscriptionEventUpcoming(mockEvent)).resolves.toBeUndefined();
    });
  });

  describe('method getStripeProduct', () => {
    test.each([
      {
        name: 'return existing stripe product id when found',
        input: { product: { productId: 'ct_product_123', name: { en: 'Test Product' } } },
        searchResult: { data: [{ id: 'stripe_product_123' }] },
        createResult: null,
        expectedResult: 'stripe_product_123',
        shouldCreate: false,
      },
      {
        name: 'create new stripe product when not found',
        input: { product: { productId: 'ct_product_123', name: { en: 'Test Product' } } },
        searchResult: { data: [] },
        createResult: { id: 'new_stripe_product_123', name: 'Test Product' },
        expectedResult: 'new_stripe_product_123',
        shouldCreate: true,
      },
      {
        name: 'handle shipping info correctly',
        input: { shipping: { shippingMethod: { id: 'shipping_method_123' }, shippingMethodName: 'Standard Shipping' } },
        searchResult: { data: [] },
        createResult: { id: 'new_shipping_product_123', name: 'Standard Shipping' },
        expectedResult: 'new_shipping_product_123',
        shouldCreate: true,
      },
    ])('should $name', async ({ input, searchResult, createResult, expectedResult, shouldCreate }) => {
      Stripe.prototype.products = {
        search: jest
          .fn<() => Promise<Stripe.ApiList<Stripe.Product>>>()
          .mockResolvedValue(searchResult as Stripe.ApiList<Stripe.Product>),
        create: shouldCreate
          ? jest
              .fn<() => Promise<Stripe.Response<Stripe.Product>>>()
              .mockResolvedValue(createResult as Stripe.Response<Stripe.Product>)
          : jest.fn<() => Promise<Stripe.Response<Stripe.Product>>>(),
      } as unknown as Stripe.ProductsResource;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (stripeSubscriptionService as any).getStripeProduct(input);

      expect(result).toBe(expectedResult);
      if (shouldCreate) {
        expect(Stripe.prototype.products.create).toHaveBeenCalledWith(
          {
            name: (input.product?.name?.en || input.shipping?.shippingMethodName) as string,
            metadata: {
              [METADATA_PRODUCT_ID_FIELD]: (input.product?.productId || input.shipping?.shippingMethod?.id) as string,
            },
          },
          { idempotencyKey: expect.any(String) },
        );
      }
    });
  });

  describe('method createStripeProduct', () => {
    test.each([
      {
        name: 'create stripe product for line item successfully',
        input: { product: { productId: 'ct_product_123', name: { en: 'Test Product' } } },
        result: { id: 'stripe_product_123', name: 'Test Product' },
      },
      {
        name: 'create stripe product for shipping successfully',
        input: { shipping: { shippingMethod: { id: 'shipping_method_123' }, shippingMethodName: 'Standard Shipping' } },
        result: { id: 'stripe_shipping_product_123', name: 'Standard Shipping' },
      },
    ])('should $name', async ({ input, result }) => {
      Stripe.prototype.products = {
        create: jest
          .fn<() => Promise<Stripe.Response<Stripe.Product>>>()
          .mockResolvedValue(result as Stripe.Response<Stripe.Product>),
      } as unknown as Stripe.ProductsResource;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const actualResult = await (stripeSubscriptionService as any).createStripeProduct(input);

      expect(actualResult).toBe(result.id);
      expect(Stripe.prototype.products.create).toHaveBeenCalledWith(
        {
          name: (input.product?.name?.en || input.shipping?.shippingMethodName) as string,
          metadata: {
            [METADATA_PRODUCT_ID_FIELD]: (input.product?.productId || input.shipping?.shippingMethod?.id) as string,
          },
        },
        { idempotencyKey: expect.any(String) },
      );
    });
  });

  describe('method createStripeSetupIntent', () => {
    test.each([
      {
        name: 'create setup intent successfully',
        offSession: false,
        usage: 'on_session',
        clientSecret: 'seti_123_secret_456',
        shouldThrow: false,
      },
      {
        name: 'create setup intent with off_session usage',
        offSession: true,
        usage: 'off_session',
        clientSecret: 'seti_123_secret_456',
        shouldThrow: false,
      },
      {
        name: 'throw error when client_secret is missing',
        offSession: false,
        usage: 'on_session',
        clientSecret: null,
        shouldThrow: true,
      },
    ])('should $name', async ({ offSession, usage, clientSecret, shouldThrow }) => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);
      const setupIntentProps = {
        stripeCustomerId: 'cus_123',
        cart: mockCart,
        ...(offSession !== undefined && { offSession }),
      };

      Stripe.prototype.setupIntents = {
        create: jest.fn<() => Promise<Stripe.Response<Stripe.SetupIntent>>>().mockResolvedValue({
          id: 'seti_123',
          client_secret: clientSecret,
        } as Stripe.Response<Stripe.SetupIntent>),
      } as unknown as Stripe.SetupIntentsResource;

      jest.spyOn(CtPaymentCreationService.prototype, 'getPaymentMetadata').mockReturnValue({
        cart_id: mockCart.id,
        ct_project_key: 'test-project-key',
      });

      if (shouldThrow) {
        await expect(stripeSubscriptionService.createStripeSetupIntent(setupIntentProps)).rejects.toThrow(
          'Failed to create Setup Intent.',
        );
      } else {
        const result = await stripeSubscriptionService.createStripeSetupIntent(setupIntentProps);
        expect(result).toEqual({
          id: 'seti_123',
          clientSecret: clientSecret,
        });
      }

      expect(Stripe.prototype.setupIntents.create).toHaveBeenCalledWith(
        {
          customer: 'cus_123',
          usage: usage as 'on_session' | 'off_session',
          metadata: {
            cart_id: mockCart.id,
            ct_project_key: 'test-project-key',
          },
        },
        { idempotencyKey: expect.any(String) },
      );
    });
  });

  describe('method getCommercetoolsProductPrice', () => {
    test.each([
      {
        name: 'return product price successfully',
        mockPrice: { centAmount: 1500, currencyCode: 'USD', fractionDigits: 2 },
        shouldError: false,
      },
      {
        name: 'return undefined when price not found',
        mockPrice: undefined,
        shouldError: false,
      },
      {
        name: 'handle errors gracefully',
        mockPrice: undefined,
        shouldError: true,
      },
    ])('should $name', async ({ mockPrice, shouldError }) => {
      if (shouldError) {
        jest
          .spyOn(require('../../src/services/commerce-tools/price-client'), 'getProductMasterPrice')
          .mockRejectedValue(new Error('Price fetch error'));
      } else {
        jest
          .spyOn(require('../../src/services/commerce-tools/price-client'), 'getProductMasterPrice')
          .mockResolvedValue(mockPrice);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (stripeSubscriptionService as any).getCommercetoolsProductPrice('ct_product_123');

      expect(result).toEqual(mockPrice);
    });
  });

  describe('method findStripePriceByProductAndPrice', () => {
    test.each([
      {
        name: 'find matching price successfully',
        searchData: [
          { id: 'price_123', unit_amount: 1500, currency: 'usd', active: true },
          { id: 'price_456', unit_amount: 2000, currency: 'usd', active: true },
        ],
        shouldError: false,
        expectedResult: { id: 'price_123', unit_amount: 1500, currency: 'usd', active: true },
      },
      {
        name: 'return undefined when no prices found',
        searchData: [],
        shouldError: false,
        expectedResult: undefined,
      },
      {
        name: 'return undefined when no matching price found',
        searchData: [{ id: 'price_456', unit_amount: 2000, currency: 'usd', active: true }],
        shouldError: false,
        expectedResult: undefined,
      },
      {
        name: 'handle search errors gracefully',
        searchData: [],
        shouldError: true,
        expectedResult: undefined,
      },
    ])('should $name', async ({ searchData, shouldError, expectedResult }) => {
      const mockPrice = {
        centAmount: 1500,
        currencyCode: 'USD',
        fractionDigits: 2,
      };

      Stripe.prototype.prices = {
        search: jest.fn<() => Promise<Stripe.ApiList<Stripe.Price>>>().mockImplementation(() => {
          if (shouldError) {
            return Promise.reject(new Error('Search failed'));
          } else {
            return Promise.resolve({ data: searchData } as Stripe.ApiList<Stripe.Price>);
          }
        }),
      } as unknown as Stripe.PricesResource;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (stripeSubscriptionService as any).findStripePriceByProductAndPrice(
        'ct_product_123',
        mockPrice,
      );

      expect(result).toEqual(expectedResult);
      if (!shouldError) {
        expect(Stripe.prototype.prices.search).toHaveBeenCalledWith({
          query: `metadata['ct_variant_sku']:'ct_product_123' AND active:'true'`,
        });
      }
    });
  });

  describe('method confirmSubscriptionPayment', () => {
    const mockCart = mockGetSubscriptionCartWithVariant(1);
    const mockPayment = {
      id: 'payment_123',
      amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
      version: 1,
      customer: { id: 'customer_123', typeId: 'customer' as const },
      interfaceId: 'int_123',
      paymentMethodInfo: { method: 'card', name: { en: 'Card' } },
      paymentStatus: { interfaceText: 'Pending' },
      transactions: [],
      interfaceInteractions: [],
      createdAt: '2024-01-01T00:00:00Z',
      lastModifiedAt: '2024-01-01T00:00:00Z',
    } as any;

    beforeEach(() => {
      jest
        .spyOn(require('../../src/services/commerce-tools/cart-client'), 'getCartExpanded')
        .mockResolvedValue(mockCart);

      jest.spyOn(require('../../src/mappers/subscription-mapper'), 'getSubscriptionAttributes').mockReturnValue({
        customer: 'cus_123',
        collection_method: 'charge_automatically',
        trial_period_days: 0,
        proration_behavior: 'none',
      });

      jest
        .spyOn(
          require('../../src/services/ct-payment-creation.service').CtPaymentCreationService.prototype,
          'updateSubscriptionPaymentTransactions',
        )
        .mockResolvedValue(undefined);
    });

    test('should confirm subscription payment with no invoice successfully', async () => {
      const confirmRequest = {
        subscriptionId: 'sub_123',
        paymentReference: 'payment_123',
        paymentIntentId: 'pi_123',
      };

      jest.spyOn(stripeSubscriptionService, 'getSubscriptionTypes').mockReturnValue({
        hasTrial: false,
        hasAnchorDays: false,
        hasFreeAnchorDays: false,
        hasProrations: false,
        isSendInvoice: false,
        hasNoInvoice: true,
      });

      jest.spyOn(paymentSDK.ctPaymentService, 'getPayment').mockResolvedValue(mockPayment);

      await stripeSubscriptionService.confirmSubscriptionPayment(confirmRequest);

      expect(
        require('../../src/services/ct-payment-creation.service').CtPaymentCreationService.prototype
          .updateSubscriptionPaymentTransactions,
      ).toHaveBeenCalledWith({
        interactionId: 'sub_123',
        payment: { ...mockPayment, amountPlanned: { ...mockPayment.amountPlanned, centAmount: 0 } },
        subscriptionId: 'sub_123',
      });
    });

    test('should confirm subscription payment with invoice successfully', async () => {
      const confirmRequest = {
        subscriptionId: 'sub_123',
        paymentReference: 'payment_123',
        paymentIntentId: 'pi_123',
      };

      const mockInvoice = {
        id: 'in_123',
        amount_due: 1500,
        amount_paid: 1500,
        object: 'invoice',
        account_country: 'US',
        account_name: 'Test Account',
        account_tax_ids: null,
        amount_tax: 0,
        application: null,
        application_fee_amount: null,
        attempt_count: 1,
        attempted: true,
        auto_advance: false,
        billing_reason: 'subscription_create',
        charge: null,
        collection_method: 'charge_automatically',
        created: 1234567890,
        currency: 'usd',
        custom_fields: null,
        customer: 'cus_123',
        default_payment_method: null,
        default_source: null,
        default_tax_rates: null,
        description: null,
        discount: null,
        due_date: null,
        ending_balance: 0,
        footer: null,
        from_invoice: null,
        hosted_invoice_url: null,
        invoice_pdf: null,
        last_finalization_error: null,
        livemode: false,
        metadata: {},
        next_payment_attempt: null,
        number: 'INV-123',
        on_behalf_of: null,
        paid: true,
        paid_out_of_band: false,
        payment_intent: null,
        period_end: 1234567890,
        period_start: 1234567890,
        post_payment_credit_notes_amount: 0,
        pre_payment_credit_notes_amount: 0,
        quote: null,
        receipt_number: null,
        rendering_options: null,
        shipping_cost: null,
        shipping_details: null,
        starting_balance: 0,
        statement_descriptor: null,
        status: 'paid',
        status_transitions: null,
        subscription: 'sub_123',
        subscription_proration_date: null,
        subtotal: 1500,
        subtotal_excluding_tax: 1500,
        tax: null,
        test_clock: null,
        threshold_reason: null,
        total: 1500,
        total_discount_amounts: null,
        total_tax_amounts: null,
        transfer_data: null,
        webhooks_delivered_at: 1234567890,
      } as any;

      jest.spyOn(stripeSubscriptionService, 'getSubscriptionTypes').mockReturnValue({
        hasTrial: false,
        hasAnchorDays: false,
        hasFreeAnchorDays: false,
        hasProrations: false,
        isSendInvoice: false,
        hasNoInvoice: false,
      });

      jest.spyOn(stripeSubscriptionService, 'getInvoiceFromSubscription').mockResolvedValue(mockInvoice as any);

      jest.spyOn(stripeSubscriptionService, 'getCurrentPayment').mockResolvedValue(mockPayment);

      jest.spyOn(paymentSDK.ctPaymentService, 'getPayment').mockResolvedValue(mockPayment);

      await stripeSubscriptionService.confirmSubscriptionPayment(confirmRequest);

      expect(stripeSubscriptionService.getInvoiceFromSubscription).toHaveBeenCalledWith('sub_123');
      expect(stripeSubscriptionService.getCurrentPayment).toHaveBeenCalledWith({
        paymentReference: 'payment_123',
        invoice: mockInvoice,
        subscriptionParams: {
          customer: 'cus_123',
          collection_method: 'charge_automatically',
          trial_period_days: 0,
          proration_behavior: 'none',
        },
      });
      expect(
        require('../../src/services/ct-payment-creation.service').CtPaymentCreationService.prototype
          .updateSubscriptionPaymentTransactions,
      ).toHaveBeenCalledWith({
        interactionId: 'pi_123',
        payment: mockPayment,
        subscriptionId: 'sub_123',
        isPending: false,
      });
    });

    test('should confirm subscription payment with send invoice and trial', async () => {
      const confirmRequest = {
        subscriptionId: 'sub_123',
        paymentReference: 'payment_123',
        paymentIntentId: 'pi_123',
      };

      const mockInvoice = {
        id: 'in_123',
        amount_due: 1500,
        amount_paid: 1500,
        currency: 'usd',
        status: 'open',
      };

      jest.spyOn(stripeSubscriptionService, 'getSubscriptionTypes').mockReturnValue({
        hasTrial: true,
        hasAnchorDays: false,
        hasFreeAnchorDays: false,
        hasProrations: false,
        isSendInvoice: true,
        hasNoInvoice: false,
      });

      jest.spyOn(stripeSubscriptionService, 'getInvoiceFromSubscription').mockResolvedValue(mockInvoice as any);

      jest.spyOn(stripeSubscriptionService, 'getCurrentPayment').mockResolvedValue(mockPayment);

      jest.spyOn(paymentSDK.ctPaymentService, 'getPayment').mockResolvedValue(mockPayment);

      await stripeSubscriptionService.confirmSubscriptionPayment(confirmRequest);

      expect(
        require('../../src/services/ct-payment-creation.service').CtPaymentCreationService.prototype
          .updateSubscriptionPaymentTransactions,
      ).toHaveBeenCalledWith({
        interactionId: 'pi_123',
        payment: mockPayment,
        subscriptionId: 'sub_123',
        isPending: true, // Should be pending for send invoice + trial
      });
    });

    test('should confirm subscription payment with invoice but no payment intent ID', async () => {
      const confirmRequest = {
        subscriptionId: 'sub_123',
        paymentReference: 'payment_123',
        // No paymentIntentId provided
      };

      const mockInvoice = {
        id: 'in_456',
        amount_due: 1500,
        amount_paid: 1500,
        currency: 'usd',
        status: 'paid',
      };

      jest.spyOn(stripeSubscriptionService, 'getSubscriptionTypes').mockReturnValue({
        hasTrial: false,
        hasAnchorDays: false,
        hasFreeAnchorDays: false,
        hasProrations: false,
        isSendInvoice: false,
        hasNoInvoice: false,
      });

      jest.spyOn(stripeSubscriptionService, 'getInvoiceFromSubscription').mockResolvedValue(mockInvoice as any);

      jest.spyOn(stripeSubscriptionService, 'getCurrentPayment').mockResolvedValue(mockPayment);

      jest.spyOn(paymentSDK.ctPaymentService, 'getPayment').mockResolvedValue(mockPayment);

      await stripeSubscriptionService.confirmSubscriptionPayment(confirmRequest);

      expect(
        require('../../src/services/ct-payment-creation.service').CtPaymentCreationService.prototype
          .updateSubscriptionPaymentTransactions,
      ).toHaveBeenCalledWith({
        interactionId: 'in_456',
        payment: mockPayment,
        subscriptionId: 'sub_123',
        isPending: false,
      });
    });

    test('should confirm subscription payment with invoice but no payment intent ID and no invoice', async () => {
      const confirmRequest = {
        subscriptionId: 'sub_123',
        paymentReference: 'payment_123',
      };

      const mockInvoice = {
        id: undefined,
        amount_due: 1500,
        amount_paid: 1500,
        currency: 'usd',
        status: 'paid',
      };

      jest.spyOn(stripeSubscriptionService, 'getSubscriptionTypes').mockReturnValue({
        hasTrial: false,
        hasAnchorDays: false,
        hasFreeAnchorDays: false,
        hasProrations: false,
        isSendInvoice: false,
        hasNoInvoice: false,
      });

      jest.spyOn(stripeSubscriptionService, 'getInvoiceFromSubscription').mockResolvedValue(mockInvoice as any);

      jest.spyOn(stripeSubscriptionService, 'getCurrentPayment').mockResolvedValue(mockPayment);

      jest.spyOn(paymentSDK.ctPaymentService, 'getPayment').mockResolvedValue(mockPayment);

      await stripeSubscriptionService.confirmSubscriptionPayment(confirmRequest);

      expect(
        require('../../src/services/ct-payment-creation.service').CtPaymentCreationService.prototype
          .updateSubscriptionPaymentTransactions,
      ).toHaveBeenCalledWith({
        interactionId: 'sub_123',
        payment: mockPayment,
        subscriptionId: 'sub_123',
        isPending: false,
      });
    });

    test('should handle error when confirming subscription payment', async () => {
      const confirmRequest = {
        subscriptionId: 'sub_123',
        paymentReference: 'payment_123',
        paymentIntentId: 'pi_123',
      };

      jest
        .spyOn(require('../../src/services/commerce-tools/cart-client'), 'getCartExpanded')
        .mockRejectedValue(new Error('Cart not found'));

      await expect(stripeSubscriptionService.confirmSubscriptionPayment(confirmRequest)).rejects.toThrow(
        'Cart not found',
      );

      expect(
        require('../../src/services/ct-payment-creation.service').CtPaymentCreationService.prototype
          .updateSubscriptionPaymentTransactions,
      ).not.toHaveBeenCalled();
    });

    test('should handle error when getting payment fails', async () => {
      const confirmRequest = {
        subscriptionId: 'sub_123',
        paymentReference: 'payment_123',
        paymentIntentId: 'pi_123',
      };

      jest.spyOn(stripeSubscriptionService, 'getSubscriptionTypes').mockReturnValue({
        hasTrial: false,
        hasAnchorDays: false,
        hasFreeAnchorDays: false,
        hasProrations: false,
        isSendInvoice: false,
        hasNoInvoice: true,
      });

      jest.spyOn(paymentSDK.ctPaymentService, 'getPayment').mockRejectedValue(new Error('Payment not found'));

      await expect(stripeSubscriptionService.confirmSubscriptionPayment(confirmRequest)).rejects.toThrow(
        'Payment not found',
      );

      expect(
        require('../../src/services/ct-payment-creation.service').CtPaymentCreationService.prototype
          .updateSubscriptionPaymentTransactions,
      ).not.toHaveBeenCalled();
    });

    test('should handle error when getting invoice fails', async () => {
      const confirmRequest = {
        subscriptionId: 'sub_123',
        paymentReference: 'payment_123',
        paymentIntentId: 'pi_123',
      };

      jest.spyOn(stripeSubscriptionService, 'getSubscriptionTypes').mockReturnValue({
        hasTrial: false,
        hasAnchorDays: false,
        hasFreeAnchorDays: false,
        hasProrations: false,
        isSendInvoice: false,
        hasNoInvoice: false,
      });

      jest
        .spyOn(stripeSubscriptionService, 'getInvoiceFromSubscription')
        .mockRejectedValue(new Error('Invoice not found'));

      await expect(stripeSubscriptionService.confirmSubscriptionPayment(confirmRequest)).rejects.toThrow(
        'Invoice not found',
      );

      expect(
        require('../../src/services/ct-payment-creation.service').CtPaymentCreationService.prototype
          .updateSubscriptionPaymentTransactions,
      ).not.toHaveBeenCalled();
    });
  });

  describe('method getInvoiceFromSubscription', () => {
    const mockInvoice = {
      id: 'in_123',
      object: 'invoice',
      amount_due: 1500,
      amount_paid: 1500,
      currency: 'usd',
      status: 'paid',
      subscription: 'sub_123',
      customer: 'cus_123',
      created: 1234567890,
      livemode: false,
      metadata: {},
      number: 'INV-123',
      hosted_invoice_url: null,
      invoice_pdf: null,
      receipt_number: null,
      account_country: 'US',
      account_name: 'Test Account',
      account_tax_ids: null,
      amount_tax: 0,
      application: null,
      application_fee_amount: null,
      attempt_count: 1,
      attempted: true,
      auto_advance: false,
      billing_reason: 'subscription_create',
      charge: null,
      collection_method: 'charge_automatically',
      custom_fields: null,
      default_payment_method: null,
      default_source: null,
      default_tax_rates: null,
      description: null,
      discount: null,
      due_date: null,
      ending_balance: 0,
      footer: null,
      from_invoice: null,
      last_finalization_error: null,
      next_payment_attempt: null,
      on_behalf_of: null,
      paid: true,
      paid_out_of_band: false,
      payment_intent: null,
      period_end: 1234567890,
      period_start: 1234567890,
      post_payment_credit_notes_amount: 0,
      pre_payment_credit_notes_amount: 0,
      quote: null,
      rendering_options: null,
      shipping_cost: null,
      shipping_details: null,
      starting_balance: 0,
      statement_descriptor: null,
      status_transitions: null,
      subscription_proration_date: null,
      subtotal: 1500,
      subtotal_excluding_tax: 1500,
      tax: null,
      test_clock: null,
      threshold_reason: null,
      total: 1500,
      total_discount_amounts: null,
      total_tax_amounts: null,
      transfer_data: null,
      webhooks_delivered_at: 1234567890,
    };

    beforeEach(() => {
      Stripe.prototype.subscriptions = {
        retrieve: jest.fn(),
      } as unknown as Stripe.SubscriptionsResource;
    });

    test('should retrieve invoice from subscription successfully', async () => {
      const subscriptionId = 'sub_123';
      const mockSubscription = {
        id: 'sub_123',
        latest_invoice: mockInvoice,
      };

      jest.spyOn(Stripe.prototype.subscriptions, 'retrieve').mockResolvedValue(mockSubscription as any);

      const result = await stripeSubscriptionService.getInvoiceFromSubscription(subscriptionId);

      expect(Stripe.prototype.subscriptions.retrieve).toHaveBeenCalledWith(subscriptionId, {
        expand: ['latest_invoice.payment_intent'],
      });
      expect(result).toEqual(mockInvoice);
    });

    test('should throw error when subscription has no latest invoice', async () => {
      const subscriptionId = 'sub_123';
      const mockSubscription = {
        id: 'sub_123',
        latest_invoice: null,
      };

      jest.spyOn(Stripe.prototype.subscriptions, 'retrieve').mockResolvedValue(mockSubscription as any);

      await expect(stripeSubscriptionService.getInvoiceFromSubscription(subscriptionId)).rejects.toThrow(
        `Subscription with ID "${subscriptionId}" does not have an invoice.`,
      );

      expect(Stripe.prototype.subscriptions.retrieve).toHaveBeenCalledWith(subscriptionId, {
        expand: ['latest_invoice.payment_intent'],
      });
    });

    test('should throw error when latest invoice is a string ID', async () => {
      const subscriptionId = 'sub_123';
      const mockSubscription = {
        id: 'sub_123',
        latest_invoice: 'in_123', // String ID instead of object
      };

      jest.spyOn(Stripe.prototype.subscriptions, 'retrieve').mockResolvedValue(mockSubscription as any);

      await expect(stripeSubscriptionService.getInvoiceFromSubscription(subscriptionId)).rejects.toThrow(
        `Subscription with ID "${subscriptionId}" does not have an invoice.`,
      );

      expect(Stripe.prototype.subscriptions.retrieve).toHaveBeenCalledWith(subscriptionId, {
        expand: ['latest_invoice.payment_intent'],
      });
    });

    test('should throw error when Stripe API call fails', async () => {
      const subscriptionId = 'sub_123';
      const stripeError = new Error('Stripe API error');

      jest.spyOn(Stripe.prototype.subscriptions, 'retrieve').mockRejectedValue(stripeError);

      await expect(stripeSubscriptionService.getInvoiceFromSubscription(subscriptionId)).rejects.toThrow(
        'Stripe API error',
      );

      expect(Stripe.prototype.subscriptions.retrieve).toHaveBeenCalledWith(subscriptionId, {
        expand: ['latest_invoice.payment_intent'],
      });
    });

    test('should handle subscription with expanded invoice and payment intent', async () => {
      const subscriptionId = 'sub_123';
      const mockInvoiceWithPaymentIntent = {
        ...mockInvoice,
        payment_intent: {
          id: 'pi_123',
          client_secret: 'pi_secret_123',
          status: 'requires_payment_method',
        },
      };
      const mockSubscription = {
        id: 'sub_123',
        latest_invoice: mockInvoiceWithPaymentIntent,
      };

      jest.spyOn(Stripe.prototype.subscriptions, 'retrieve').mockResolvedValue(mockSubscription as any);

      const result = await stripeSubscriptionService.getInvoiceFromSubscription(subscriptionId);

      expect(Stripe.prototype.subscriptions.retrieve).toHaveBeenCalledWith(subscriptionId, {
        expand: ['latest_invoice.payment_intent'],
      });
      expect(result).toEqual(mockInvoiceWithPaymentIntent);
      expect(result.payment_intent).toBeDefined();
    });

    test('should handle subscription with undefined latest invoice', async () => {
      const subscriptionId = 'sub_123';
      const mockSubscription = {
        id: 'sub_123',
        latest_invoice: undefined,
      };

      jest.spyOn(Stripe.prototype.subscriptions, 'retrieve').mockResolvedValue(mockSubscription as any);

      await expect(stripeSubscriptionService.getInvoiceFromSubscription(subscriptionId)).rejects.toThrow(
        `Subscription with ID "${subscriptionId}" does not have an invoice.`,
      );

      expect(Stripe.prototype.subscriptions.retrieve).toHaveBeenCalledWith(subscriptionId, {
        expand: ['latest_invoice.payment_intent'],
      });
    });

    test('should handle subscription with empty string latest invoice', async () => {
      const subscriptionId = 'sub_123';
      const mockSubscription = {
        id: 'sub_123',
        latest_invoice: '',
      };

      jest.spyOn(Stripe.prototype.subscriptions, 'retrieve').mockResolvedValue(mockSubscription as any);

      await expect(stripeSubscriptionService.getInvoiceFromSubscription(subscriptionId)).rejects.toThrow(
        `Subscription with ID "${subscriptionId}" does not have an invoice.`,
      );

      expect(Stripe.prototype.subscriptions.retrieve).toHaveBeenCalledWith(subscriptionId, {
        expand: ['latest_invoice.payment_intent'],
      });
    });
  });
});
