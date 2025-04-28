import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { DefaultCartService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-cart.service';
import { DefaultPaymentService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-payment.service';
import { Cart, Payment } from '@commercetools/connect-payments-sdk';
import { paymentSDK } from '../../src/payment-sdk';
import { mockGetCartResult } from '../utils/mock-cart-data';
import { mockCtCustomerData, mockCtCustomerId } from '../utils/mock-customer-data';
import { StripeCustomerService } from '../../src/services/stripe-customer.service';
import { StripeCreatePaymentService } from '../../src/services/stripe-create-payment.service';
import { StripePaymentServiceOptions } from '../../src/services/types/stripe-payment.type';
import {
  configDataWithBillingAsNever,
  mockGetPaymentAmount,
  mockGetPaymentResult,
  mockStripeCreatePaymentResult,
  stripePriceDataMock,
  stripePriceEmptyResponseMock,
  stripePriceIdMock,
  stripePriceResponseMock,
  stripeProductDataMock,
  stripeProductEmptyResponseMock,
  stripeProductIdMock,
  stripeProductResponseMock,
  subscriptionResponseMock,
  subscriptionWithoutPaymentResponseMock,
} from '../utils/mock-payment-results';
import * as Logger from '../../src/libs/logger/index';
import * as ConfigModule from '../../src/config/config';

jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {}),
}));
jest.mock('../../src/libs/logger');

describe('stripe-create-payment.service', () => {
  const opts: StripePaymentServiceOptions = {
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
    ctOrderService: paymentSDK.ctOrderService,
  };
  const stripeCreatePaymentService: StripeCreatePaymentService = new StripeCreatePaymentService(opts);

  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
    Stripe.prototype.paymentIntents = {
      create: jest.fn(),
      update: jest.fn(),
    } as unknown as Stripe.PaymentIntentsResource;
    Stripe.prototype.subscriptions = {
      create: jest.fn(),
      update: jest.fn(),
    } as unknown as Stripe.SubscriptionsResource;
    Stripe.prototype.prices = {
      create: jest.fn(),
      search: jest.fn(),
    } as unknown as Stripe.PricesResource;
    Stripe.prototype.products = {
      create: jest.fn(),
      search: jest.fn(),
    } as unknown as Stripe.ProductsResource;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('method createPaymentIntent', () => {
    test('should createPaymentIntent successful', async () => {
      const cartMock = mockGetCartResult();
      const getCtCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'getCtCustomer')
        .mockResolvedValue(mockCtCustomerData);
      const getPaymentAmountMock = jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockResolvedValue(mockGetPaymentAmount);
      const stripeCreatePaymentIntentMock = jest
        .spyOn(Stripe.prototype.paymentIntents, 'create')
        .mockResolvedValue(mockStripeCreatePaymentResult);
      const handleCtPaymentCreationMock = jest
        .spyOn(StripeCreatePaymentService.prototype, 'handleCtPaymentCreation')
        .mockResolvedValue(mockGetPaymentResult.id);

      const result = await stripeCreatePaymentService.createPaymentIntent(cartMock);

      expect(result.clientSecret).toStrictEqual(mockStripeCreatePaymentResult.client_secret);
      expect(result).toBeDefined();

      expect(getCtCustomerMock).toHaveBeenCalled();
      expect(getPaymentAmountMock).toHaveBeenCalled();
      expect(stripeCreatePaymentIntentMock).toHaveBeenCalled();
      expect(handleCtPaymentCreationMock).toHaveBeenCalled();
    });

    test('should createPaymentIntent with billing information successful', async () => {
      jest.spyOn(ConfigModule, 'getConfig').mockReturnValue(configDataWithBillingAsNever);
      const cartMock = mockGetCartResult();
      const getCtCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'getCtCustomer')
        .mockResolvedValue(mockCtCustomerData);
      const getPaymentAmountMock = jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockResolvedValue(mockGetPaymentAmount);
      const stripeCreatePaymentIntentMock = jest
        .spyOn(Stripe.prototype.paymentIntents, 'create')
        .mockResolvedValue(mockStripeCreatePaymentResult);
      const handleCtPaymentCreationMock = jest
        .spyOn(StripeCreatePaymentService.prototype, 'handleCtPaymentCreation')
        .mockResolvedValue(mockGetPaymentResult.id);

      const result = await stripeCreatePaymentService.createPaymentIntent(cartMock);

      expect(result.clientSecret).toStrictEqual(mockStripeCreatePaymentResult.client_secret);
      expect(result).toBeDefined();

      expect(getCtCustomerMock).toHaveBeenCalled();
      expect(getPaymentAmountMock).toHaveBeenCalled();
      expect(stripeCreatePaymentIntentMock).toHaveBeenCalled();
      expect(handleCtPaymentCreationMock).toHaveBeenCalled();
    });
  });

  describe('method createSubscription', () => {
    test('should create subscription successful', async () => {
      const cartMock = mockGetCartResult();
      const getPaymentAmountMock = jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockResolvedValue(mockGetPaymentAmount);
      const getCtCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'getCtCustomer')
        .mockResolvedValue(mockCtCustomerData);
      const getSubscriptionPriceIdMock = jest
        .spyOn(StripeCreatePaymentService.prototype, 'getSubscriptionPriceId')
        .mockResolvedValue(stripePriceIdMock);
      const stripeCreateSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'create')
        .mockResolvedValue(subscriptionResponseMock);
      const handleCtPaymentCreationMock = jest
        .spyOn(StripeCreatePaymentService.prototype, 'handleCtPaymentCreation')
        .mockResolvedValue(mockGetPaymentResult.id);

      const result = await stripeCreatePaymentService.createSubscription(cartMock);

      expect(result.clientSecret).toStrictEqual(mockStripeCreatePaymentResult.client_secret);
      expect(result).toBeDefined();

      expect(getSubscriptionPriceIdMock).toHaveBeenCalled();
      expect(getPaymentAmountMock).toHaveBeenCalled();
      expect(getCtCustomerMock).toHaveBeenCalled();
      expect(stripeCreateSubscriptionMock).toHaveBeenCalled();
      expect(handleCtPaymentCreationMock).toHaveBeenCalled();
    });

    test('should fail to create subscription', async () => {
      const cartMock = mockGetCartResult();
      const getPaymentAmountMock = jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockResolvedValue(mockGetPaymentAmount);
      const getSubscriptionPriceIdMock = jest
        .spyOn(StripeCreatePaymentService.prototype, 'getSubscriptionPriceId')
        .mockResolvedValue(stripePriceIdMock);
      const stripeCreateSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'create')
        .mockResolvedValue(subscriptionWithoutPaymentResponseMock);

      try {
        await stripeCreatePaymentService.createSubscription(cartMock);
      } catch (e) {
        expect(e).toEqual('Failed to create Subscription.');
      }

      expect(getSubscriptionPriceIdMock).toHaveBeenCalled();
      expect(getPaymentAmountMock).toHaveBeenCalled();
      expect(stripeCreateSubscriptionMock).toHaveBeenCalled();
    });
  });

  describe('method createCtPayment', () => {
    test('should create ct payment successfully', async () => {
      const getPaymentAmountMock = jest
        .spyOn(DefaultPaymentService.prototype, 'createPayment')
        .mockResolvedValue(mockGetPaymentResult);

      const result = await stripeCreatePaymentService.createCtPayment({
        cart: mockGetCartResult(),
        amountPlanned: mockGetPaymentAmount,
        paymentIntentId: mockStripeCreatePaymentResult.id,
      });

      expect(result).toStrictEqual(mockGetPaymentResult.id);
      expect(result).toBeDefined();

      expect(getPaymentAmountMock).toHaveBeenCalled();
    });

    test('should create ct payment without customer ID successfully', async () => {
      const mockCart: Cart = { ...mockGetCartResult(), customerId: undefined };
      const getPaymentAmountMock = jest
        .spyOn(DefaultPaymentService.prototype, 'createPayment')
        .mockResolvedValue(mockGetPaymentResult);

      const result = await stripeCreatePaymentService.createCtPayment({
        cart: mockCart,
        amountPlanned: mockGetPaymentAmount,
        paymentIntentId: mockStripeCreatePaymentResult.id,
      });

      expect(result).toStrictEqual(mockGetPaymentResult.id);
      expect(result).toBeDefined();
      expect(getPaymentAmountMock).toHaveBeenCalled();
    });

    test('should create ct payment with anonymous ID successfully', async () => {
      const mockCart: Cart = { ...mockGetCartResult(), customerId: undefined, anonymousId: 'test-anonymous-id' };
      const getPaymentAmountMock = jest
        .spyOn(DefaultPaymentService.prototype, 'createPayment')
        .mockResolvedValue(mockGetPaymentResult);

      const result = await stripeCreatePaymentService.createCtPayment({
        cart: mockCart,
        amountPlanned: mockGetPaymentAmount,
        paymentIntentId: mockStripeCreatePaymentResult.id,
      });

      expect(result).toStrictEqual(mockGetPaymentResult.id);
      expect(result).toBeDefined();
      expect(getPaymentAmountMock).toHaveBeenCalled();
    });

    test('should create ct payment for subscription successfully', async () => {
      const getPaymentAmountMock = jest
        .spyOn(DefaultPaymentService.prototype, 'createPayment')
        .mockResolvedValue(mockGetPaymentResult);

      const result = await stripeCreatePaymentService.createCtPayment({
        cart: mockGetCartResult(),
        amountPlanned: mockGetPaymentAmount,
        paymentIntentId: mockStripeCreatePaymentResult.id,
        isSubscription: true,
      });

      expect(result).toStrictEqual(mockGetPaymentResult.id);
      expect(result).toBeDefined();

      expect(getPaymentAmountMock).toHaveBeenCalled();
    });

    test('should fail to create ct payment', async () => {
      const getPaymentAmountMock = jest
        .spyOn(DefaultPaymentService.prototype, 'createPayment')
        .mockResolvedValue({} as Payment);

      try {
        await stripeCreatePaymentService.createCtPayment({
          cart: mockGetCartResult(),
          amountPlanned: mockGetPaymentAmount,
          paymentIntentId: mockStripeCreatePaymentResult.id,
        });
      } catch (e) {
        expect(e).toEqual('Failed to create CT payment.');
      }
      expect(getPaymentAmountMock).toHaveBeenCalled();
    });
  });

  describe('method addCtPayment', () => {
    test('should add ct payment successfully', async () => {
      const addPaymentAmountMock = jest
        .spyOn(DefaultCartService.prototype, 'addPayment')
        .mockResolvedValue(mockGetCartResult());

      await stripeCreatePaymentService.addCtPayment({
        cart: mockGetCartResult(),
        ctPaymentId: mockGetPaymentResult.id,
      });
      expect(addPaymentAmountMock).toHaveBeenCalled();
    });
  });

  describe('method handleCtPaymentCreation', () => {
    test('should create and add ct payment successfully', async () => {
      const ctPaymentIdMock = jest
        .spyOn(StripeCreatePaymentService.prototype, 'createCtPayment')
        .mockResolvedValue(mockGetPaymentResult.id);
      const addCtPaymentMock = jest.spyOn(StripeCreatePaymentService.prototype, 'addCtPayment').mockResolvedValue();
      const updatePaymentMetadataMock = jest
        .spyOn(StripeCreatePaymentService.prototype, 'updatePaymentMetadata')
        .mockResolvedValue();

      await stripeCreatePaymentService.handleCtPaymentCreation({
        cart: mockGetCartResult(),
        amountPlanned: mockGetPaymentAmount,
        paymentIntentId: mockStripeCreatePaymentResult.id,
      });
      expect(ctPaymentIdMock).toHaveBeenCalled();
      expect(addCtPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMetadataMock).toHaveBeenCalled();
    });
  });

  describe('method updatePaymentMetadata', () => {
    test('should create and add ct payment successfully', async () => {
      const stripeUpdatePaymentIntentMock = jest
        .spyOn(Stripe.prototype.paymentIntents, 'update')
        .mockResolvedValue(mockStripeCreatePaymentResult);

      await stripeCreatePaymentService.updatePaymentMetadata({
        cart: mockGetCartResult(),
        ctPaymentId: mockGetPaymentResult.id,
        paymentIntentId: mockStripeCreatePaymentResult.id,
      });
      expect(Logger.log.info).toBeCalled();
      expect(stripeUpdatePaymentIntentMock).toHaveBeenCalled();
    });

    test('should create and add ct payment for subscription successfully', async () => {
      const stripeUpdatePaymentIntentMock = jest
        .spyOn(Stripe.prototype.paymentIntents, 'update')
        .mockResolvedValue(mockStripeCreatePaymentResult);
      const stripeUpdateSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'update')
        .mockResolvedValue(subscriptionResponseMock);

      await stripeCreatePaymentService.updatePaymentMetadata({
        cart: mockGetCartResult(),
        ctPaymentId: mockGetPaymentResult.id,
        paymentIntentId: mockStripeCreatePaymentResult.id,
        subscriptionId: subscriptionResponseMock.id,
      });
      expect(Logger.log.info).toBeCalled();
      expect(stripeUpdatePaymentIntentMock).toHaveBeenCalled();
      expect(stripeUpdateSubscriptionMock).toHaveBeenCalled();
    });
  });

  describe('method getSubscriptionPriceId', () => {
    test('should get the existing stripe price ID', async () => {
      const stripeSearchPricesMock = jest
        .spyOn(Stripe.prototype.prices, 'search')
        .mockResolvedValue(stripePriceResponseMock);

      const result = await stripeCreatePaymentService.getSubscriptionPriceId(mockGetCartResult(), mockGetPaymentAmount);
      expect(result).toStrictEqual(stripePriceIdMock);
      expect(Logger.log.info).toBeCalled();
      expect(stripeSearchPricesMock).toHaveBeenCalled();
    });

    test('should create a stripe price ID successfully', async () => {
      const stripeUpdatePaymentIntentMock = jest
        .spyOn(Stripe.prototype.prices, 'search')
        .mockResolvedValue(stripePriceEmptyResponseMock);
      const getStripeProductIdMock = jest
        .spyOn(StripeCreatePaymentService.prototype, 'getStripeProduct')
        .mockResolvedValue(stripeProductIdMock);
      const createStripePriceMock = jest
        .spyOn(StripeCreatePaymentService.prototype, 'createStripePrice')
        .mockResolvedValue(stripePriceIdMock);

      const result = await stripeCreatePaymentService.getSubscriptionPriceId(mockGetCartResult(), mockGetPaymentAmount);
      expect(result).toStrictEqual(stripePriceIdMock);
      expect(Logger.log.info).toBeCalled();
      expect(stripeUpdatePaymentIntentMock).toHaveBeenCalled();
      expect(getStripeProductIdMock).toHaveBeenCalled();
      expect(createStripePriceMock).toHaveBeenCalled();
    });
  });

  describe('method getStripeProduct', () => {
    test('should get the existing stripe product ID', async () => {
      const productMock = mockGetCartResult().lineItems[0];
      const stripeSearchProducts = jest
        .spyOn(Stripe.prototype.products, 'search')
        .mockResolvedValue(stripeProductResponseMock);

      const result = await stripeCreatePaymentService.getStripeProduct(productMock);
      expect(result).toStrictEqual(stripeProductIdMock);
      expect(Logger.log.info).toBeCalled();
      expect(stripeSearchProducts).toHaveBeenCalled();
    });

    test('should get a new stripe product ID', async () => {
      const productMock = mockGetCartResult().lineItems[0];
      const stripeSearchProducts = jest
        .spyOn(Stripe.prototype.products, 'search')
        .mockResolvedValue(stripeProductEmptyResponseMock);
      const createStripeProductMock = jest
        .spyOn(StripeCreatePaymentService.prototype, 'createStripeProduct')
        .mockResolvedValue(stripeProductIdMock);

      const result = await stripeCreatePaymentService.getStripeProduct(productMock);
      expect(result).toStrictEqual(stripeProductIdMock);
      expect(stripeSearchProducts).toHaveBeenCalled();
      expect(createStripeProductMock).toHaveBeenCalled();
    });
  });

  describe('method createStripeProduct', () => {
    test('should create a new stripe product', async () => {
      const productMock = mockGetCartResult().lineItems[0];
      const stripeCreateProductMock = jest
        .spyOn(Stripe.prototype.products, 'create')
        .mockResolvedValue(stripeProductDataMock);

      const result = await stripeCreatePaymentService.createStripeProduct(productMock);
      expect(result).toStrictEqual(stripeProductIdMock);
      expect(Logger.log.info).toBeCalled();
      expect(stripeCreateProductMock).toHaveBeenCalled();
    });

    test('should create a new stripe product', async () => {
      const productMock = mockGetCartResult().lineItems[0];
      const stripeCreateProductMock = jest
        .spyOn(Stripe.prototype.products, 'create')
        .mockResolvedValue({} as Stripe.Response<Stripe.Product>);

      try {
        await stripeCreatePaymentService.createStripeProduct(productMock);
      } catch (e) {
        expect(e).toEqual('Failed to create new stripe product.');
      }
      expect(stripeCreateProductMock).toHaveBeenCalled();
    });
  });

  describe('method createStripePrice', () => {
    test('should create a new stripe price', async () => {
      const productMock = mockGetCartResult().lineItems[0];
      const stripeCreatePriceMock = jest
        .spyOn(Stripe.prototype.prices, 'create')
        .mockResolvedValue(stripePriceDataMock);

      const result = await stripeCreatePaymentService.createStripePrice({
        amount: mockGetPaymentAmount,
        product: productMock,
        stripeProductId: stripeProductIdMock,
      });
      expect(result).toStrictEqual(stripePriceIdMock);
      expect(stripeCreatePriceMock).toHaveBeenCalled();
    });

    test('should create a new stripe product', async () => {
      const productMock = mockGetCartResult().lineItems[0];
      const stripeCreatePriceMock = jest
        .spyOn(Stripe.prototype.prices, 'create')
        .mockResolvedValue({} as Stripe.Response<Stripe.Price>);

      try {
        await stripeCreatePaymentService.createStripePrice({
          amount: mockGetPaymentAmount,
          product: productMock,
          stripeProductId: stripeProductIdMock,
        });
      } catch (e) {
        expect(e).toEqual('Failed to create stripe product price.');
      }
      expect(stripeCreatePriceMock).toHaveBeenCalled();
    });
  });

  describe('method getPaymentMetadata', () => {
    test('should return the payment metadata with customer id', () => {
      const cart = mockGetCartResult();
      const paymentMetadataMock = {
        cart_id: cart.id,
        ct_project_key: ConfigModule.getConfig().projectKey,
        ct_customer_id: mockCtCustomerId,
      };
      const result = stripeCreatePaymentService.getPaymentMetadata(cart);
      expect(result).toStrictEqual(paymentMetadataMock);
    });

    test('should return the payment metadata withhout customer id', () => {
      const cart: Cart = { ...mockGetCartResult(), customerId: undefined };
      const paymentMetadataMock = {
        cart_id: cart.id,
        ct_project_key: ConfigModule.getConfig().projectKey,
      };
      const result = stripeCreatePaymentService.getPaymentMetadata(cart);
      expect(result).toStrictEqual(paymentMetadataMock);
    });
  });
});
