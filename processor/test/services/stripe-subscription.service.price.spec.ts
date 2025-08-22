jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {}),
}));

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { StripeSubscriptionService } from '../../src/services/stripe-subscription.service';
import { paymentSDK } from '../../src/payment-sdk';
import { mockGetSubscriptionCartWithVariant, mockGetCartResult, lineItem, shippingInfo } from '../utils/mock-cart-data';
import {
  mockSubscriptionAttributes,
  stripePriceDataMock,
  stripePriceIdMock,
  stripeProductIdMock,
  stripeProductDataMock,
  stripePriceResponseMock,
  stripePriceEmptyResponseMock,
  stripeProductResponseMock,
  stripeProductEmptyResponseMock,
} from '../utils/mock-subscription-response';
import Stripe from 'stripe';

jest.mock('../../src/libs/logger');

describe('stripe-subscription.service.price', () => {
  const opts = {
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
    ctOrderService: paymentSDK.ctOrderService,
  };
  const stripeSubscriptionService = new StripeSubscriptionService(opts);

  beforeEach(async () => {
    jest.setTimeout(10000);
    jest.resetAllMocks();

    Stripe.prototype.prices = {
      search: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    } as unknown as Stripe.PricesResource;

    Stripe.prototype.products = {
      search: jest.fn(),
      create: jest.fn(),
      retrieve: jest.fn(),
    } as unknown as Stripe.ProductsResource;

    Stripe.prototype.subscriptions = {
      create: jest.fn(),
      retrieve: jest.fn(),
      update: jest.fn(),
      list: jest.fn(),
      cancel: jest.fn(),
    } as unknown as Stripe.SubscriptionsResource;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('method getSubscriptionPriceId', () => {
    test('should get the existing stripe price ID', async () => {
      jest.spyOn(Stripe.prototype.prices, 'search').mockResolvedValue({
        data: [
          { id: 'price_123', unit_amount: 1000, active: true, recurring: { interval: 'month', interval_count: 1 } },
        ],
      } as Stripe.Response<Stripe.ApiSearchResult<Stripe.Price>>);

      const result = await stripeSubscriptionService.getSubscriptionPriceId(mockGetSubscriptionCartWithVariant(1), {
        centAmount: 1000,
        currencyCode: 'USD',
        fractionDigits: 2,
      });

      expect(result).toStrictEqual('price_123');
      expect(Stripe.prototype.prices.search).toHaveBeenCalled();
    });

    test('should disable old stripe price and create new one successfully', async () => {
      jest
        .spyOn(Stripe.prototype.prices, 'search')
        .mockResolvedValueOnce({
          data: [
            { id: 'price_456', unit_amount: 2000, active: true, recurring: { interval: 'month', interval_count: 1 } },
          ],
        } as Stripe.Response<Stripe.ApiSearchResult<Stripe.Price>>)
        .mockResolvedValueOnce(stripePriceEmptyResponseMock);

      jest
        .spyOn(Stripe.prototype.prices, 'update')
        .mockResolvedValue(stripePriceDataMock as Stripe.Response<Stripe.Price>);
      jest
        .spyOn(Stripe.prototype.prices, 'create')
        .mockResolvedValue(stripePriceDataMock as Stripe.Response<Stripe.Price>);
      jest.spyOn(Stripe.prototype.products, 'search').mockResolvedValue(stripeProductResponseMock);

      const result = await stripeSubscriptionService.getSubscriptionPriceId(mockGetSubscriptionCartWithVariant(1), {
        centAmount: 1000,
        currencyCode: 'USD',
        fractionDigits: 2,
      });

      expect(result).toStrictEqual(stripePriceIdMock);
      expect(Stripe.prototype.prices.search).toHaveBeenCalled();
      expect(Stripe.prototype.prices.update).toHaveBeenCalled();
      expect(Stripe.prototype.prices.create).toHaveBeenCalled();
    });

    test('should create a stripe price successfully', async () => {
      jest.spyOn(Stripe.prototype.prices, 'search').mockResolvedValue(stripePriceEmptyResponseMock);
      jest
        .spyOn(Stripe.prototype.prices, 'create')
        .mockResolvedValue(stripePriceDataMock as Stripe.Response<Stripe.Price>);
      jest.spyOn(Stripe.prototype.products, 'search').mockResolvedValue(stripeProductResponseMock);

      const result = await stripeSubscriptionService.getSubscriptionPriceId(mockGetSubscriptionCartWithVariant(1), {
        centAmount: 1000,
        currencyCode: 'USD',
        fractionDigits: 2,
      });

      expect(result).toStrictEqual(stripePriceIdMock);
      expect(Stripe.prototype.prices.search).toHaveBeenCalled();
      expect(Stripe.prototype.prices.create).toHaveBeenCalled();
    });
  });

  describe('method disableStripePrice', () => {
    test('should disable stripe price successfully', async () => {
      jest
        .spyOn(Stripe.prototype.prices, 'update')
        .mockResolvedValue(stripePriceDataMock as Stripe.Response<Stripe.Price>);

      const result = await stripeSubscriptionService.disableStripePrice(
        stripePriceDataMock,
        mockGetSubscriptionCartWithVariant(1).lineItems[0],
      );

      expect(result).toBeUndefined();
      expect(Stripe.prototype.prices.update).toHaveBeenCalled();
    });

    test('should disable stripe price without nickname successfully', async () => {
      jest
        .spyOn(Stripe.prototype.prices, 'update')
        .mockResolvedValue(stripePriceDataMock as Stripe.Response<Stripe.Price>);

      const result = await stripeSubscriptionService.disableStripePrice(
        { ...stripePriceDataMock, nickname: null },
        mockGetSubscriptionCartWithVariant(1).lineItems[0],
      );

      expect(result).toBeUndefined();
      expect(Stripe.prototype.prices.update).toHaveBeenCalled();
    });
  });

  describe('method createStripePrice', () => {
    test('should create a new stripe price', async () => {
      const productMock = mockGetCartResult().lineItems[0];
      jest
        .spyOn(Stripe.prototype.prices, 'create')
        .mockResolvedValue(stripePriceDataMock as Stripe.Response<Stripe.Price>);

      const result = await stripeSubscriptionService.createStripePrice({
        amount: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        product: productMock,
        stripeProductId: stripeProductIdMock,
        attributes: mockSubscriptionAttributes,
      });

      expect(result).toStrictEqual(stripePriceIdMock);
      expect(Stripe.prototype.prices.create).toHaveBeenCalled();
    });
  });

  describe('method getSubscriptionShippingPriceId', () => {
    test('should get existing shipping price ID successfully', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);
      jest.spyOn(Stripe.prototype.products, 'search').mockResolvedValue(stripeProductResponseMock);
      jest.spyOn(Stripe.prototype.prices, 'search').mockResolvedValue(stripePriceResponseMock);

      const result = await stripeSubscriptionService.getSubscriptionShippingPriceId(mockCart);

      expect(result).toStrictEqual(stripePriceIdMock);
      expect(Stripe.prototype.products.search).toHaveBeenCalled();
      expect(Stripe.prototype.prices.search).toHaveBeenCalled();
    });

    test('should create new shipping price when no existing price found', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);

      jest.spyOn(Stripe.prototype.products, 'search').mockResolvedValue(stripeProductEmptyResponseMock);
      jest
        .spyOn(Stripe.prototype.products, 'create')
        .mockResolvedValue(stripeProductDataMock as Stripe.Response<Stripe.Product>);
      jest.spyOn(Stripe.prototype.prices, 'search').mockResolvedValue(stripePriceEmptyResponseMock);
      jest
        .spyOn(Stripe.prototype.prices, 'create')
        .mockResolvedValue(stripePriceDataMock as Stripe.Response<Stripe.Price>);

      const result = await stripeSubscriptionService.getSubscriptionShippingPriceId(mockCart);

      expect(result).toStrictEqual(stripePriceIdMock);
      expect(Stripe.prototype.products.search).toHaveBeenCalled();
      expect(Stripe.prototype.products.create).toHaveBeenCalled();
      expect(Stripe.prototype.prices.search).toHaveBeenCalled();
      expect(Stripe.prototype.prices.create).toHaveBeenCalled();
    });

    test('should return undefined when no shipping info in cart', async () => {
      const mockCart = { ...mockGetSubscriptionCartWithVariant(1), shippingInfo: undefined };
      const result = await stripeSubscriptionService.getSubscriptionShippingPriceId(mockCart);
      expect(result).toBeUndefined();
    });
  });

  describe('method getStripePriceByMetadata', () => {
    test('should search stripe prices by metadata successfully', async () => {
      jest.spyOn(Stripe.prototype.prices, 'search').mockResolvedValue(stripePriceResponseMock);

      const result = await stripeSubscriptionService.getStripePriceByMetadata(lineItem);

      expect(result).toStrictEqual(stripePriceResponseMock);
      expect(Stripe.prototype.prices.search).toHaveBeenCalled();
    });
  });

  describe('method getStripeShippingPriceByMetadata', () => {
    test('should search stripe shipping prices by metadata successfully', async () => {
      jest.spyOn(Stripe.prototype.prices, 'search').mockResolvedValue(stripePriceResponseMock);

      const result = await stripeSubscriptionService.getStripeShippingPriceByMetadata(shippingInfo!);

      expect(result).toStrictEqual(stripePriceResponseMock);
      expect(Stripe.prototype.prices.search).toHaveBeenCalled();
    });
  });

  describe('method createStripeShippingPrice', () => {
    test('should create stripe shipping price successfully', async () => {
      jest
        .spyOn(Stripe.prototype.prices, 'create')
        .mockResolvedValue(stripePriceDataMock as Stripe.Response<Stripe.Price>);

      const result = await stripeSubscriptionService.createStripeShippingPrice({
        shipping: shippingInfo!,
        stripeProductId: stripeProductIdMock,
        attributes: mockSubscriptionAttributes,
      });

      expect(result).toStrictEqual(stripePriceIdMock);
      expect(Stripe.prototype.prices.create).toHaveBeenCalled();
    });
  });
});
