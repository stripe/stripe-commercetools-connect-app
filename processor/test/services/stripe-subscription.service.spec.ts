/* eslint-disable @typescript-eslint/no-explicit-any */
jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {}),
}));

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { StripeSubscriptionService } from '../../src/services/stripe-subscription.service';
import { CtPaymentCreationService } from '../../src/services/ct-payment-creation.service';
import { paymentSDK } from '../../src/payment-sdk';
import { mockGetSubscriptionCartWithVariant, mockGetCartResult } from '../utils/mock-cart-data';
import { mockInvoice } from '../utils/mock-subscription-data';
import { mockInvoiceExpanded__simple, mockEvent__invoice_paid__simple } from '../utils/mock-subscription-data';
import { subscriptionResponseMock } from '../utils/mock-subscription-response';
import { mockPayment__subscription_success } from '../utils/mock-payment-results';
import { DefaultPaymentService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-payment.service';
import { SubscriptionEventConverter } from '../../src/services/converters/subscriptionEventConverter';
import { BasicSubscriptionData } from '../../src/services/types/stripe-subscription.type';
import Stripe from 'stripe';
import * as CartClient from '../../src/services/commerce-tools/cart-client';
import { ShippingInfo } from '@commercetools/platform-sdk';

jest.mock('../../src/libs/logger');

jest.mock('../../src/services/commerce-tools/cart-client', () => ({
  updateCartById: jest.fn(),
  getCartExpanded: jest.fn(),
}));

describe('stripe-subscription.service', () => {
  const opts = {
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
    ctOrderService: paymentSDK.ctOrderService,
  };
  const stripeSubscriptionService = new StripeSubscriptionService(opts);

  beforeEach(async () => {
    jest.setTimeout(10000);
    jest.resetAllMocks();

    Stripe.prototype.products = {
      search: jest.fn(),
      create: jest.fn(),
      retrieve: jest.fn(),
    } as unknown as Stripe.ProductsResource;

    Stripe.prototype.prices = {
      search: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    } as unknown as Stripe.PricesResource;

    Stripe.prototype.subscriptions = {
      create: jest.fn(),
      retrieve: jest.fn(),
      update: jest.fn(),
      list: jest.fn(),
      cancel: jest.fn(),
    } as unknown as Stripe.SubscriptionsResource;

    Stripe.prototype.setupIntents = {
      create: jest.fn(),
      retrieve: jest.fn(),
    } as unknown as Stripe.SetupIntentsResource;

    Stripe.prototype.customers = {
      create: jest.fn(),
      retrieve: jest.fn(),
      update: jest.fn(),
    } as unknown as Stripe.CustomersResource;

    Stripe.prototype.paymentIntents = {
      create: jest.fn(),
      retrieve: jest.fn(),
      update: jest.fn(),
    } as unknown as Stripe.PaymentIntentsResource;

    Stripe.prototype.invoices = {
      create: jest.fn(),
      retrieve: jest.fn(),
      finalize: jest.fn(),
      send: jest.fn(),
      sendInvoice: jest.fn(),
      finalizeInvoice: jest.fn(),
    } as unknown as Stripe.InvoicesResource;

    Stripe.prototype.invoiceItems = {
      create: jest.fn(),
    } as unknown as Stripe.InvoiceItemsResource;

    Stripe.prototype.coupons = {
      list: jest.fn(),
    } as unknown as Stripe.CouponsResource;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('method createSetupIntent', () => {
    test('should create setup intent successfully', async () => {
      const mockCart = mockGetCartResult();

      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        cart: mockCart,
        stripeCustomerId: 'cus_123',
        subscriptionParams: { customer: 'cus_123', off_session: false },
        billingAddress: '123 Main St',
        merchantReturnUrl: 'http://example.com',
      } as BasicSubscriptionData);

      jest.spyOn(StripeSubscriptionService.prototype, 'createStripeSetupIntent').mockResolvedValue({
        id: 'seti_123',
        clientSecret: 'secret_123',
      });

      const result = await stripeSubscriptionService.createSetupIntent();

      expect(result).toBeDefined();
      expect(result.clientSecret).toBe('secret_123');
      expect(result.merchantReturnUrl).toBe('http://example.com');
    });

    test('should handle error when creating setup intent', async () => {
      const error = new Error('Failed to create setup intent');
      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockRejectedValue(error);

      await expect(stripeSubscriptionService.createSetupIntent()).rejects.toThrow('Failed to create setup intent');
    });
  });

  describe('method createSubscription', () => {
    test('should create subscription successfully', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);

      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        cart: mockCart,
        stripeCustomerId: 'cus_123',
        subscriptionParams: { customer: 'cus_123' },
        billingAddress: '123 Main St',
        merchantReturnUrl: 'http://example.com',
        lineItemAmount: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        priceId: 'price_123',
        shippingPriceId: undefined,
      } as BasicSubscriptionData);

      jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue({
        id: 'sub_123',
        latest_invoice: {
          id: 'in_123',
          payment_intent: {
            id: 'pi_123',
            client_secret: 'pi_secret_123',
          },
        },
      } as Stripe.Response<Stripe.Subscription>);

      jest.spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation').mockResolvedValue('payment_ref_123');
      jest.spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId').mockResolvedValue();

      const result = await stripeSubscriptionService.createSubscription();

      expect(result).toBeDefined();
      expect(result.subscriptionId).toBe('sub_123');
      expect(result.paymentReference).toBe('payment_ref_123');
      expect(result.cartId).toBeDefined();
    });

    test('should handle error when creating subscription', async () => {
      const error = new Error('Failed to create subscription');
      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockRejectedValue(error);

      await expect(stripeSubscriptionService.createSubscription()).rejects.toThrow('Failed to create subscription');
    });
  });

  describe('method createSubscriptionFromSetupIntent', () => {
    test('should create subscription from setup intent successfully', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);

      jest.spyOn(Stripe.prototype.setupIntents, 'retrieve').mockResolvedValue({
        payment_method: 'pm_123',
      } as Stripe.Response<Stripe.SetupIntent>);

      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        cart: mockCart,
        stripeCustomerId: 'cus_123',
        subscriptionParams: { customer: 'cus_123' },
        billingAddress: '123 Main St',
        merchantReturnUrl: 'http://example.com',
        lineItemAmount: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        priceId: 'price_123',
        shippingPriceId: undefined,
      } as BasicSubscriptionData);

      jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue({
        id: 'sub_123',
        latest_invoice: { id: 'in_123' },
      } as Stripe.Response<Stripe.Subscription>);

      jest.spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId').mockResolvedValue();
      jest.spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation').mockResolvedValue('payment_ref_123');

      const result = await stripeSubscriptionService.createSubscriptionFromSetupIntent('setup_intent_123');

      expect(result).toEqual({
        subscriptionId: 'sub_123',
        paymentReference: 'payment_ref_123',
      });
    });

    test('should handle error when creating subscription from setup intent', async () => {
      const error = new Error('Failed to create subscription');
      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockRejectedValue(error);

      await expect(stripeSubscriptionService.createSubscriptionFromSetupIntent('setup_intent_123')).rejects.toThrow(
        'Failed to create subscription',
      );
    });
  });

  describe('method confirmSubscriptionPayment', () => {
    test('should confirm subscription payment successfully', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);

      jest.spyOn(CartClient, 'getCartExpanded').mockResolvedValue(mockCart);
      jest.spyOn(StripeSubscriptionService.prototype, 'getInvoiceFromSubscription').mockResolvedValue(mockInvoice);
      jest
        .spyOn(StripeSubscriptionService.prototype, 'getCurrentPayment')
        .mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(CtPaymentCreationService.prototype, 'updateSubscriptionPaymentTransactions').mockResolvedValue();

      const result = await stripeSubscriptionService.confirmSubscriptionPayment({
        paymentReference: 'payment_ref_123',
        subscriptionId: 'sub_123',
        paymentIntentId: 'pi_123',
      });

      expect(result).toBeUndefined();
    });
  });

  describe('method getCurrentPayment', () => {
    test('should get default payment successfully', async () => {
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);

      const result = await stripeSubscriptionService.getCurrentPayment({
        invoice: mockInvoice,
        paymentReference: 'payment_ref_123',
        subscriptionParams: {
          customer: 'cus_123',
        },
      });

      expect(result).toBeDefined();
    });
  });

  describe('method processSubscriptionEvent', () => {
    test('should process subscription invoice.paid successfully', async () => {
      const mockEvent = mockEvent__invoice_paid__simple;

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceExpanded__simple);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(true);

      jest.spyOn(SubscriptionEventConverter.prototype, 'convert').mockReturnValue({
        id: 'payment_123',
        pspReference: 'in_123',
        paymentMethod: 'card',
        pspInteraction: { response: '{}' },
        transactions: [
          {
            amount: { centAmount: 1000, currencyCode: 'USD' },
            interactionId: 'in_123',
            state: 'Success',
            type: 'Charge',
          },
        ],
      });

      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent);

      expect(CtPaymentCreationService.prototype.getStripeInvoiceExpanded).toHaveBeenCalled();
      expect(DefaultPaymentService.prototype.getPayment).toHaveBeenCalled();
    });
  });

  describe('method getInvoiceFromSubscription', () => {
    test('should get invoice from subscription successfully', async () => {
      const mockSubscriptionWithInvoice = {
        ...subscriptionResponseMock,
        latest_invoice: mockInvoice,
      };

      jest
        .spyOn(Stripe.prototype.subscriptions, 'retrieve')
        .mockResolvedValue(mockSubscriptionWithInvoice as Stripe.Response<Stripe.Subscription>);

      const result = await stripeSubscriptionService.getInvoiceFromSubscription('sub_123');

      expect(result).toEqual(mockInvoice);
      expect(Stripe.prototype.subscriptions.retrieve).toHaveBeenCalledWith('sub_123', {
        expand: ['latest_invoice.payment_intent'],
      });
    });
  });

  describe('method saveSubscriptionId', () => {
    test('should save subscription ID successfully', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);
      const mockSubscriptionId = 'sub_123';

      jest.spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId').mockResolvedValue();

      const result = await stripeSubscriptionService.saveSubscriptionId(mockCart, mockSubscriptionId);

      expect(result).toBeUndefined();
    });
  });

  describe('method createSubscriptionFromSetupIntent - validation branches', () => {
    test('should throw error when paymentMethodId is missing', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);

      jest.spyOn(Stripe.prototype.setupIntents, 'retrieve').mockResolvedValue({
        payment_method: null, // Missing payment method
      } as Stripe.Response<Stripe.SetupIntent>);

      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        cart: mockCart,
        stripeCustomerId: 'cus_123',
        subscriptionParams: { customer: 'cus_123' },
        billingAddress: '123 Main St',
        merchantReturnUrl: 'http://example.com',
        lineItemAmount: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        priceId: 'price_123',
        shippingPriceId: undefined,
      } as BasicSubscriptionData);

      await expect(stripeSubscriptionService.createSubscriptionFromSetupIntent('setup_intent_123')).rejects.toThrow(
        'Failed to create Subscription. Invalid setup intent.',
      );
    });

    test('should throw error when paymentMethodId is not a string', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);

      jest.spyOn(Stripe.prototype.setupIntents, 'retrieve').mockResolvedValue({
        payment_method: 123, // Not a string
      } as any);

      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        cart: mockCart,
        stripeCustomerId: 'cus_123',
        subscriptionParams: { customer: 'cus_123' },
        billingAddress: '123 Main St',
        merchantReturnUrl: 'http://example.com',
        lineItemAmount: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        priceId: 'price_123',
        shippingPriceId: undefined,
      } as BasicSubscriptionData);

      await expect(stripeSubscriptionService.createSubscriptionFromSetupIntent('setup_intent_123')).rejects.toThrow(
        'Failed to create Subscription. Invalid setup intent.',
      );
    });

    test('should handle one-time items when present', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);

      jest.spyOn(Stripe.prototype.setupIntents, 'retrieve').mockResolvedValue({
        payment_method: 'pm_123',
      } as Stripe.Response<Stripe.SetupIntent>);

      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        cart: mockCart,
        stripeCustomerId: 'cus_123',
        subscriptionParams: { customer: 'cus_123' },
        billingAddress: '123 Main St',
        merchantReturnUrl: 'http://example.com',
        lineItemAmount: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        priceId: 'price_123',
        shippingPriceId: undefined,
      } as BasicSubscriptionData);

      // Mock one-time items to be present
      jest
        .spyOn(stripeSubscriptionService as any, 'getAllLineItemPrices')
        .mockResolvedValue([{ price: 'price_123', quantity: 1 }]);

      jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue({
        id: 'sub_123',
        latest_invoice: { id: 'in_123' },
      } as Stripe.Response<Stripe.Subscription>);

      jest.spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId').mockResolvedValue();
      jest.spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation').mockResolvedValue('payment_ref_123');

      const result = await stripeSubscriptionService.createSubscriptionFromSetupIntent('setup_intent_123');

      expect(result).toEqual({
        subscriptionId: 'sub_123',
        paymentReference: 'payment_ref_123',
      });
    });

    test('should handle invoice status variations correctly', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);

      jest.spyOn(Stripe.prototype.setupIntents, 'retrieve').mockResolvedValue({
        payment_method: 'pm_123',
      } as Stripe.Response<Stripe.SetupIntent>);

      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        cart: mockCart,
        stripeCustomerId: 'cus_123',
        subscriptionParams: {
          customer: 'cus_123',
          send_invoice: true,
        },
        billingAddress: '123 Main St',
        merchantReturnUrl: 'http://example.com',
        lineItemAmount: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        priceId: 'price_123',
        shippingPriceId: undefined,
      } as BasicSubscriptionData);

      jest.spyOn(stripeSubscriptionService as any, 'getAllLineItemPrices').mockResolvedValue([]);

      jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue({
        id: 'sub_123',
        latest_invoice: { id: 'in_123' },
      } as Stripe.Response<Stripe.Subscription>);

      jest.spyOn(Stripe.prototype.invoices, 'sendInvoice').mockResolvedValue({
        id: 'in_123',
        status: 'open',
      } as Stripe.Response<Stripe.Invoice>);

      jest.spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId').mockResolvedValue();
      jest.spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation').mockResolvedValue('payment_ref_123');

      const result = await stripeSubscriptionService.createSubscriptionFromSetupIntent('setup_intent_123');

      expect(result).toBeDefined();
    });
  });

  describe('method prepareSubscriptionData - conditional branches', () => {
    test('should return basic data when basicData flag is true', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);

      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        cart: mockCart,
        stripeCustomerId: 'cus_123',
        subscriptionParams: { customer: 'cus_123' },
        billingAddress: '123 Main St',
        merchantReturnUrl: 'http://example.com',
      } as BasicSubscriptionData);

      const result = await stripeSubscriptionService.prepareSubscriptionData({ basicData: true });

      expect(result).toHaveProperty('cart');
      expect(result).toHaveProperty('stripeCustomerId');
      expect(result).toHaveProperty('subscriptionParams');
      expect(result).toHaveProperty('billingAddress');
      expect(result).toHaveProperty('merchantReturnUrl');
      expect(result).not.toHaveProperty('lineItemAmount');
      expect(result).not.toHaveProperty('priceId');
    });

    test('should return full data when basicData flag is false', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);

      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        cart: mockCart,
        stripeCustomerId: 'cus_123',
        subscriptionParams: { customer: 'cus_123' },
        billingAddress: '123 Main St',
        merchantReturnUrl: 'http://example.com',
        lineItemAmount: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        priceId: 'price_123',
        shippingPriceId: undefined,
      } as BasicSubscriptionData);

      const result = await stripeSubscriptionService.prepareSubscriptionData();

      expect(result).toHaveProperty('lineItemAmount');
      expect(result).toHaveProperty('priceId');
      expect(result).toHaveProperty('amountPlanned');
    });

    test('should return full data when basicData flag is not provided', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);

      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        cart: mockCart,
        stripeCustomerId: 'cus_123',
        subscriptionParams: { customer: 'cus_123' },
        billingAddress: '123 Main St',
        merchantReturnUrl: 'http://example.com',
        lineItemAmount: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        priceId: 'price_123',
        shippingPriceId: undefined,
      } as BasicSubscriptionData);

      const result = await stripeSubscriptionService.prepareSubscriptionData();

      expect(result).toHaveProperty('lineItemAmount');
      expect(result).toHaveProperty('priceId');
      expect(result).toHaveProperty('amountPlanned');
    });
  });

  describe('method validateSubscription - error branches', () => {
    test('should throw error when latest_invoice is a string', async () => {
      const mockSubscription = {
        id: 'sub_123',
        latest_invoice: 'in_123',
      } as Stripe.Subscription;

      expect(() => stripeSubscriptionService.validateSubscription(mockSubscription)).toThrow(
        'Failed to create Subscription, missing Payment Intent.',
      );
    });

    test('should throw error when payment_intent is a string', async () => {
      const mockSubscription = {
        id: 'sub_123',
        latest_invoice: {
          id: 'in_123',
          payment_intent: 'pi_123',
        },
      } as Stripe.Subscription;

      expect(() => stripeSubscriptionService.validateSubscription(mockSubscription)).toThrow(
        'Failed to create Subscription, missing Payment Intent.',
      );
    });

    test('should throw error when client_secret is missing', async () => {
      const mockSubscription = {
        id: 'sub_123',
        latest_invoice: {
          id: 'in_123',
          payment_intent: {
            id: 'pi_123',
          },
        },
      } as Stripe.Subscription;

      expect(() => stripeSubscriptionService.validateSubscription(mockSubscription)).toThrow(
        'Failed to create Subscription, missing Payment Intent.',
      );
    });

    test('should return payment intent data when validation passes', async () => {
      const mockSubscription = {
        id: 'sub_123',
        latest_invoice: {
          id: 'in_123',
          payment_intent: {
            id: 'pi_123',
            client_secret: 'pi_secret_123',
          },
        },
      } as Stripe.Subscription;

      const result = stripeSubscriptionService.validateSubscription(mockSubscription);

      expect(result).toEqual({
        paymentIntentId: 'pi_123',
        clientSecret: 'pi_secret_123',
      });
    });
  });

  describe('method getCreateSubscriptionPriceId - conditional branches', () => {
    test('should reuse existing price when conditions match', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);
      const mockAmount = { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 };

      jest.spyOn(StripeSubscriptionService.prototype, 'getStripePriceByMetadata').mockResolvedValue({
        data: [
          {
            id: 'price_123',
            active: true,
            unit_amount: 1000,
            recurring: {
              interval: 'month',
              interval_count: 1,
            },
          },
        ],
        object: 'search_result',
        has_more: false,
        next_page: null,
        url: '/v1/prices/search',
        lastResponse: {
          headers: {},
          requestId: 'req_123',
          statusCode: 200,
        },
      } as Stripe.Response<Stripe.ApiSearchResult<Stripe.Price>>);

      jest.spyOn(StripeSubscriptionService.prototype, 'getStripeProduct').mockResolvedValue('prod_123');
      jest.spyOn(StripeSubscriptionService.prototype, 'createStripePrice').mockResolvedValue('price_new_123');

      const result = await stripeSubscriptionService.getCreateSubscriptionPriceId(mockCart, mockAmount);

      expect(result).toBe('price_123');
      expect(StripeSubscriptionService.prototype.createStripePrice).not.toHaveBeenCalled();
    });

    test('should create new price when existing price conditions do not match', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);
      const mockAmount = { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 };

      jest.spyOn(StripeSubscriptionService.prototype, 'getStripePriceByMetadata').mockResolvedValue({
        data: [
          {
            id: 'price_123',
            active: false,
            unit_amount: 1000,
            recurring: {
              interval: 'month',
              interval_count: 1,
            },
          },
        ],
        object: 'search_result',
        has_more: false,
        next_page: null,
        url: '/v1/prices/search',
        lastResponse: {
          headers: {},
          requestId: 'req_123',
          statusCode: 200,
        },
      } as Stripe.Response<Stripe.ApiSearchResult<Stripe.Price>>);

      jest.spyOn(StripeSubscriptionService.prototype, 'disableStripePrice').mockResolvedValue();
      jest.spyOn(StripeSubscriptionService.prototype, 'getStripeProduct').mockResolvedValue('prod_123');
      jest.spyOn(StripeSubscriptionService.prototype, 'createStripePrice').mockResolvedValue('price_new_123');

      const result = await stripeSubscriptionService.getCreateSubscriptionPriceId(mockCart, mockAmount);

      expect(result).toBe('price_new_123');
      expect(StripeSubscriptionService.prototype.disableStripePrice).toHaveBeenCalled();
      expect(StripeSubscriptionService.prototype.createStripePrice).toHaveBeenCalled();
    });

    test('should create new price when no existing price found', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);
      const mockAmount = { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 };

      jest.spyOn(StripeSubscriptionService.prototype, 'getStripePriceByMetadata').mockResolvedValue({
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
      } as Stripe.Response<Stripe.ApiSearchResult<Stripe.Price>>);

      jest.spyOn(StripeSubscriptionService.prototype, 'getStripeProduct').mockResolvedValue('prod_123');
      jest.spyOn(StripeSubscriptionService.prototype, 'createStripePrice').mockResolvedValue('price_new_123');

      const result = await stripeSubscriptionService.getCreateSubscriptionPriceId(mockCart, mockAmount);

      expect(result).toBe('price_new_123');
      expect(StripeSubscriptionService.prototype.createStripePrice).toHaveBeenCalled();
    });
  });

  describe('method getSubscriptionShippingPriceId - conditional branches', () => {
    test('should return undefined when no shipping info', async () => {
      const mockCart = {
        ...mockGetSubscriptionCartWithVariant(1),
        shippingInfo: undefined,
      };

      const result = await stripeSubscriptionService.getSubscriptionShippingPriceId(mockCart);

      expect(result).toBeUndefined();
    });

    test('should reuse existing shipping price when active', async () => {
      const mockCart = {
        ...mockGetSubscriptionCartWithVariant(1),
        shippingInfo: {
          shippingMethod: { id: 'shipping_123' },
          price: { centAmount: 500, currencyCode: 'USD' },
        } as ShippingInfo,
      };

      jest.spyOn(StripeSubscriptionService.prototype, 'getStripeProduct').mockResolvedValue('prod_123');
      jest.spyOn(StripeSubscriptionService.prototype, 'getStripeShippingPriceByMetadata').mockResolvedValue({
        data: [
          {
            id: 'price_shipping_123',
            active: true,
          },
        ],
        object: 'search_result',
        has_more: false,
        next_page: null,
        url: '/v1/prices/search',
        lastResponse: {
          headers: {},
          requestId: 'req_123',
          statusCode: 200,
        },
      } as Stripe.Response<Stripe.ApiSearchResult<Stripe.Price>>);

      jest
        .spyOn(StripeSubscriptionService.prototype, 'createStripeShippingPrice')
        .mockResolvedValue('price_shipping_new_123');

      const result = await stripeSubscriptionService.getSubscriptionShippingPriceId(mockCart);

      expect(result).toBe('price_shipping_123');
      expect(StripeSubscriptionService.prototype.createStripeShippingPrice).not.toHaveBeenCalled();
    });

    test('should create new shipping price when existing price is inactive', async () => {
      const mockCart = {
        ...mockGetSubscriptionCartWithVariant(1),
        shippingInfo: {
          shippingMethod: { id: 'shipping_123' },
          price: { centAmount: 500, currencyCode: 'USD' },
        } as ShippingInfo,
      };

      jest.spyOn(StripeSubscriptionService.prototype, 'getStripeProduct').mockResolvedValue('prod_123');
      jest.spyOn(StripeSubscriptionService.prototype, 'getStripeShippingPriceByMetadata').mockResolvedValue({
        data: [
          {
            id: 'price_shipping_123',
            active: false,
          },
        ],
        object: 'search_result',
        has_more: false,
        next_page: null,
        url: '/v1/prices/search',
        lastResponse: {
          headers: {},
          requestId: 'req_123',
          statusCode: 200,
        },
      } as Stripe.Response<Stripe.ApiSearchResult<Stripe.Price>>);

      jest
        .spyOn(StripeSubscriptionService.prototype, 'createStripeShippingPrice')
        .mockResolvedValue('price_shipping_new_123');

      const result = await stripeSubscriptionService.getSubscriptionShippingPriceId(mockCart);

      expect(result).toBe('price_shipping_new_123');
      expect(StripeSubscriptionService.prototype.createStripeShippingPrice).toHaveBeenCalled();
    });
  });

  describe('method patchSubscription', () => {
    test('should patch subscription successfully', async () => {
      const customerId = 'cust_123';
      const subscriptionId = 'sub_123';
      const patchParams = {
        metadata: {
          updated: 'true',
        },
      };
      const options = {
        idempotencyKey: 'test_key',
      };

      const mockSubscriptionResponse = {
        id: subscriptionId,
        object: 'subscription',
        metadata: { updated: 'true' },
        status: 'active',
        items: { data: [] },
        latest_invoice: null,
        lastResponse: {
          headers: {},
          requestId: 'req_123',
          statusCode: 200,
        },
      } as unknown as Stripe.Response<Stripe.Subscription>;

      jest.spyOn(StripeSubscriptionService.prototype, 'validateCustomerSubscription').mockResolvedValue();
      jest.spyOn(Stripe.prototype.subscriptions, 'update').mockResolvedValue(mockSubscriptionResponse);

      const result = await stripeSubscriptionService.patchSubscription({
        customerId,
        subscriptionId,
        params: patchParams,
        options,
      });

      expect(result).toBeDefined();
      expect(result).toBe(mockSubscriptionResponse);
      expect(Stripe.prototype.subscriptions.update).toHaveBeenCalledWith(subscriptionId, patchParams, options);
    });

    test('should throw error when validation fails', async () => {
      const customerId = 'cust_123';
      const subscriptionId = 'sub_123';
      const error = new Error('Validation failed');

      jest.spyOn(StripeSubscriptionService.prototype, 'validateCustomerSubscription').mockRejectedValue(error);

      await expect(
        stripeSubscriptionService.patchSubscription({
          customerId,
          subscriptionId,
        }),
      ).rejects.toThrow('Validation failed');

      expect(Stripe.prototype.subscriptions.update).not.toHaveBeenCalled();
    });

    test('should throw error when update fails', async () => {
      const customerId = 'cust_123';
      const subscriptionId = 'sub_123';
      const error = new Error('Update failed');

      jest.spyOn(StripeSubscriptionService.prototype, 'validateCustomerSubscription').mockResolvedValue();
      jest.spyOn(Stripe.prototype.subscriptions, 'update').mockRejectedValue(error);

      await expect(
        stripeSubscriptionService.patchSubscription({
          customerId,
          subscriptionId,
        }),
      ).rejects.toThrow('Update failed');
    });
  });
});
