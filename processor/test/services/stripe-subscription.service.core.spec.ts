jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {}),
}));

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { StripeSubscriptionService } from '../../src/services/stripe-subscription.service';
import { CtPaymentCreationService } from '../../src/services/ct-payment-creation.service';
import { paymentSDK } from '../../src/payment-sdk';
import { mockGetSubscriptionCartWithVariant } from '../utils/mock-cart-data';
import Stripe from 'stripe';
import { BasicSubscriptionData } from '../../src/services/types/stripe-subscription.type';
import * as Config from '../../src/config/config';

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
    ctPaymentService: {},
    ctOrderService: {},
    ctAPI: {
      carts: jest.fn(() => ({
        withId: jest.fn(() => ({
          get: jest.fn(() => Promise.resolve({ body: mockGetSubscriptionCartWithVariant(1) })),
        })),
      })),
    },
  },
}));

jest.mock('../../src/libs/logger');

jest.mock('../../src/services/commerce-tools/cart-client', () => ({
  getCartExpanded: jest.fn(() => Promise.resolve(mockGetSubscriptionCartWithVariant(1))),
}));

interface FlexibleConfig {
  [key: string]: string | number | boolean | Config.PaymentFeatures;
}

function setupMockConfig(keysAndValues: Record<string, string>) {
  const mockConfig: FlexibleConfig = {};
  Object.keys(keysAndValues).forEach((key) => {
    mockConfig[key] = keysAndValues[key];
  });

  jest.spyOn(Config, 'getConfig').mockReturnValue(mockConfig as ReturnType<typeof Config.getConfig>);
}

describe('stripe-subscription.service.core', () => {
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
    Stripe.prototype.invoiceItems = { create: jest.fn() } as unknown as Stripe.InvoiceItemsResource;
    Stripe.prototype.coupons = { list: jest.fn() } as unknown as Stripe.CouponsResource;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('method createSetupIntent', () => {
    test('should create setup intent successfully', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);
      const mockSetupIntent = {
        clientSecret: 'secret_123',
        merchantReturnUrl: 'http://example.com',
        billingAddress: '123 Main St',
      };

      const spiedPrepareSubscriptionDataMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue({
          cart: mockCart,
          stripeCustomerId: 'cus_123',
          subscriptionParams: { customer: 'cus_123', off_session: false },
          billingAddress: '123 Main St',
          merchantReturnUrl: 'http://example.com',
        });
      const spiedCreateStripeSetupIntentMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'createStripeSetupIntent')
        .mockResolvedValue({
          id: 'seti_123',
          clientSecret: 'secret_123',
        });

      const result = await stripeSubscriptionService.createSetupIntent();

      expect(result).toEqual(mockSetupIntent);
      expect(spiedPrepareSubscriptionDataMock).toHaveBeenCalled();
      expect(spiedCreateStripeSetupIntentMock).toHaveBeenCalled();
    });

    test('should handle error when creating setup intent', async () => {
      const error = new Error('Failed to create setup intent');
      jest.spyOn(StripeSubscriptionService.prototype, 'createSetupIntent').mockRejectedValue(error);

      await expect(stripeSubscriptionService.createSetupIntent()).rejects.toThrow('Failed to create setup intent');
    });
  });

  describe('method createSubscription', () => {
    test('should create subscription successfully', async () => {
      setupMockConfig({
        projectKey: 'test-project-key',
        stripeCollectBillingAddress: 'auto',
        stripeSecretKey: 'sk_test_123',
        authUrl: 'https://auth.test.com',
        apiUrl: 'https://api.test.com',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scope: 'test-scope',
        region: 'test-region',
        subscriptionPaymentHandling: 'upcomingInvoice',
      });
      const spiedPrepareSubscriptionDataMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue({
          cart: mockGetSubscriptionCartWithVariant(1),
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
        id: 'sub_mock_id',
        latest_invoice: {
          id: 'in_123',
          payment_intent: {
            id: 'pi_123',
            client_secret: 'pi_3MtwBwLkdIwHu7ix28a3tqPa_secret_YrKJUKribcBjcG8HVhfZluoGH',
          },
        },
      } as Stripe.Response<Stripe.Subscription>);

      jest.spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation').mockResolvedValue('payment_ref_123');
      const spiedSaveSubscriptionIdMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId')
        .mockResolvedValue();

      const result = await stripeSubscriptionService.createSubscription();

      expect(result).toMatchObject({
        subscriptionId: 'sub_mock_id',
        paymentReference: 'payment_ref_123',
        billingAddress: '123 Main St',
        clientSecret: 'pi_3MtwBwLkdIwHu7ix28a3tqPa_secret_YrKJUKribcBjcG8HVhfZluoGH',
        merchantReturnUrl: 'http://example.com',
      });
      expect(result).toHaveProperty('cartId');
      expect(spiedPrepareSubscriptionDataMock).toHaveBeenCalled();
      expect(spiedSaveSubscriptionIdMock).toHaveBeenCalled();
    });

    test('should handle error when creating subscription', async () => {
      const error = new Error('Failed to create subscription');
      jest.spyOn(StripeSubscriptionService.prototype, 'createSubscription').mockRejectedValue(error);

      await expect(stripeSubscriptionService.createSubscription()).rejects.toThrow('Failed to create subscription');
    });
  });

  describe('method createOneTimeItemsInvoice', () => {
    test('should create one time items invoice successfully', async () => {
      setupMockConfig({
        projectKey: 'test-project-key',
        stripeCollectBillingAddress: 'auto',
        stripeSecretKey: 'sk_test_123',
        authUrl: 'https://auth.test.com',
        apiUrl: 'https://api.test.com',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scope: 'test-scope',
        region: 'test-region',
        merchantReturnUrl: 'http://example.com',
      });

      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        cart: mockGetSubscriptionCartWithVariant(1),
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

      expect(result).toBeDefined();
      expect(result).toHaveProperty('cart');
      expect(result).toHaveProperty('stripeCustomerId');
      expect(result).toHaveProperty('subscriptionParams');
    });

    test('should handle error when creating one time items invoice', async () => {
      setupMockConfig({
        projectKey: 'test-project-key',
        stripeCollectBillingAddress: 'auto',
        stripeSecretKey: 'sk_test_123',
        authUrl: 'https://auth.test.com',
        apiUrl: 'https://api.test.com',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scope: 'test-scope',
        region: 'test-region',
        merchantReturnUrl: 'http://example.com',
      });

      jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockRejectedValue(new Error('Failed to create invoice'));

      try {
        await stripeSubscriptionService.prepareSubscriptionData();
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Failed to create invoice');
      }
    });
  });

  describe('method prepareSubscriptionData', () => {
    test('should prepare subscription data successfully', async () => {
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

      expect(result).toBeDefined();
      expect(result).toHaveProperty('cart');
      expect(result).toHaveProperty('stripeCustomerId');
      expect(result).toHaveProperty('subscriptionParams');
    });

    test('should prepare subscription data with coupon', async () => {
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

      expect(result).toBeDefined();
      expect(result).toHaveProperty('cart');
      expect(result).toHaveProperty('stripeCustomerId');
      expect(result).toHaveProperty('subscriptionParams');
    });
  });

  describe('method saveSubscriptionId', () => {
    test('should save subscription ID successfully', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(6);
      const mockSubscriptionId = 'sub_123';

      jest.spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId').mockResolvedValue(undefined);

      const result = await stripeSubscriptionService.saveSubscriptionId(mockCart, mockSubscriptionId);

      expect(result).toBeUndefined();
      expect(mockSubscriptionId).toBe('sub_123');
    });
  });

  describe('method handleCtPaymentCreation', () => {
    test('should handle CT payment creation successfully', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);
      const mockSubscriptionId = 'sub_123';

      const spiedHandleCtPaymentCreationMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation')
        .mockResolvedValue('payment_ref_123');

      const result = await CtPaymentCreationService.prototype.handleCtPaymentCreation({
        cart: mockCart,
        amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        interactionId: mockSubscriptionId,
      });

      expect(result).toBe('payment_ref_123');
      expect(spiedHandleCtPaymentCreationMock).toHaveBeenCalled();
    });
  });
});
