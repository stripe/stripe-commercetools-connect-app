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

      await stripeSubscriptionService.processSubscriptionEvent(mockEvent);

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
});
