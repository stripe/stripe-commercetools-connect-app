/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {}),
}));

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { StripeSubscriptionService } from '../../src/services/stripe-subscription.service';
import { SubscriptionOutcome } from '../../src/dtos/stripe-payment.dto';
import { paymentSDK } from '../../src/payment-sdk';
import { mockCtCustomerData } from '../utils/mock-customer-data';
import { subscriptionResponseMock } from '../utils/mock-subscription-response';
import { StripeSubscriptionServiceOptions } from '../../src/services/types/stripe-subscription.type';
import Stripe from 'stripe';
import * as Config from '../../src/config/config';

jest.mock('../../src/libs/logger', () => ({
  log: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../src/config/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    projectKey: 'test-project-key',
    stripeSecretKey: 'sk_test_123',
    authUrl: 'https://auth.test.com',
    apiUrl: 'https://api.test.com',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    scope: 'test-scope',
    region: 'test-region',
  }),
}));

jest.mock('../../src/payment-sdk', () => ({
  paymentSDK: {
    ctCartService: {},
    ctPaymentService: {},
    ctOrderService: {},
    ctAPI: {},
  },
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

describe('stripe-subscription.service.lifecycle', () => {
  const opts: StripeSubscriptionServiceOptions = {
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

  describe('method getCustomerSubscriptions', () => {
    test('should get customer subscriptions successfully', async () => {
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
        subscriptionPaymentHandling: 'createOrder',
      });
      const customerId = 'customer_123';
      const mockSubscriptions = [subscriptionResponseMock];
      const getCustomerByIdMock = jest
        .spyOn(require('../../src/services/commerce-tools/customer-client'), 'getCustomerById')
        .mockResolvedValue({
          ...mockCtCustomerData,
          custom: {
            type: { typeId: 'type', id: 'mock-type-id' },
            fields: {
              stripeConnector_stripeCustomerId: 'cus_123',
            },
          },
        });

      const stripeSubscriptionsListMock = jest.spyOn(Stripe.prototype.subscriptions, 'list').mockResolvedValue({
        data: mockSubscriptions,
        has_more: false,
        object: 'list',
        url: '',
        lastResponse: {
          headers: {},
          requestId: 'req_123',
          statusCode: 200,
        },
      } as Stripe.Response<Stripe.ApiList<Stripe.Subscription>>);

      const result = await stripeSubscriptionService.getCustomerSubscriptions(customerId);

      expect(result).toStrictEqual(mockSubscriptions);
      expect(getCustomerByIdMock).toHaveBeenCalledWith(customerId);
      expect(stripeSubscriptionsListMock).toHaveBeenCalled();
    });
  });

  describe('method cancelSubscription', () => {
    test('should cancel subscription successfully', async () => {
      const customerId = 'customer_123';
      const subscriptionId = 'sub_mock_id';
      const getCustomerByIdMock = jest
        .spyOn(require('../../src/services/commerce-tools/customer-client'), 'getCustomerById')
        .mockResolvedValue({
          ...mockCtCustomerData,
          custom: {
            type: { typeId: 'type', id: 'mock-type-id' },
            fields: {
              stripeConnector_stripeCustomerId: 'cus_123',
            },
          },
        });

      const stripeSubscriptionsListMock = jest.spyOn(Stripe.prototype.subscriptions, 'list').mockResolvedValue({
        data: [subscriptionResponseMock],
        has_more: false,
        object: 'list',
        url: '',
        lastResponse: {
          headers: {},
          requestId: 'req_123',
          statusCode: 200,
        },
      } as Stripe.Response<Stripe.ApiList<Stripe.Subscription>>);

      const stripeCancelSubscriptionMock = jest.spyOn(Stripe.prototype.subscriptions, 'cancel').mockResolvedValue({
        ...subscriptionResponseMock,
        status: 'canceled',
      });

      const result = await stripeSubscriptionService.cancelSubscription({ customerId, subscriptionId });

      expect(result.id).toStrictEqual('sub_mock_id');
      expect(result.status).toStrictEqual('canceled');
      expect(result.outcome).toStrictEqual(SubscriptionOutcome.CANCELED);
      expect(getCustomerByIdMock).toHaveBeenCalledWith(customerId);
      expect(stripeCancelSubscriptionMock).toHaveBeenCalled();
      expect(stripeSubscriptionsListMock).toHaveBeenCalled();
    });

    test('should fail to cancel subscription', async () => {
      const customerId = 'customer_123';
      const subscriptionId = 'sub_mock_id';
      const getCustomerByIdMock = jest
        .spyOn(require('../../src/services/commerce-tools/customer-client'), 'getCustomerById')
        .mockResolvedValue({
          ...mockCtCustomerData,
          custom: {
            type: { typeId: 'type', id: 'mock-type-id' },
            fields: {
              stripeConnector_stripeCustomerId: 'cus_123',
            },
          },
        });

      const stripeSubscriptionsListMock = jest.spyOn(Stripe.prototype.subscriptions, 'list').mockResolvedValue({
        data: [subscriptionResponseMock],
        has_more: false,
        object: 'list',
        url: '',
        lastResponse: {
          headers: {},
          requestId: 'req_123',
          statusCode: 200,
        },
      } as Stripe.Response<Stripe.ApiList<Stripe.Subscription>>);

      const error = new Error('Failed to cancel subscription');
      const stripeCancelSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'cancel')
        .mockRejectedValue(error);

      try {
        await stripeSubscriptionService.cancelSubscription({ customerId, subscriptionId });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Failed to cancel subscription');
      }

      expect(getCustomerByIdMock).toHaveBeenCalledWith(customerId);
      expect(stripeCancelSubscriptionMock).toHaveBeenCalled();
      expect(stripeSubscriptionsListMock).toHaveBeenCalled();
    });
  });

  describe('method updateSubscription', () => {
    test('should update subscription successfully', async () => {
      const customerId = 'customer_123';
      const subscriptionId = 'sub_mock_id';
      const mockUpdatedSubscription = {
        ...subscriptionResponseMock,
        status: 'active' as Stripe.Subscription.Status,
      };

      const getCustomerByIdMock = jest
        .spyOn(require('../../src/services/commerce-tools/customer-client'), 'getCustomerById')
        .mockResolvedValue({
          ...mockCtCustomerData,
          custom: {
            type: { typeId: 'type', id: 'mock-type-id' },
            fields: {
              stripeConnector_stripeCustomerId: 'cus_123',
            },
          },
        });

      const stripeSubscriptionsListMock = jest.spyOn(Stripe.prototype.subscriptions, 'list').mockResolvedValue({
        data: [subscriptionResponseMock],
        has_more: false,
        object: 'list',
        url: '',
        lastResponse: {
          headers: {},
          requestId: 'req_123',
          statusCode: 200,
        },
      } as Stripe.Response<Stripe.ApiList<Stripe.Subscription>>);

      const stripeUpdateSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'update')
        .mockResolvedValue(mockUpdatedSubscription);

      const result = await stripeSubscriptionService.updateSubscription({ customerId, subscriptionId });

      expect(result).toStrictEqual(mockUpdatedSubscription);
      expect(getCustomerByIdMock).toHaveBeenCalledWith(customerId);
      expect(stripeUpdateSubscriptionMock).toHaveBeenCalled();
      expect(stripeSubscriptionsListMock).toHaveBeenCalled();
    });

    test('should fail to update subscription', async () => {
      const customerId = 'customer_123';
      const subscriptionId = 'sub_mock_id';

      const getCustomerByIdMock = jest
        .spyOn(require('../../src/services/commerce-tools/customer-client'), 'getCustomerById')
        .mockResolvedValue({
          ...mockCtCustomerData,
          custom: {
            type: { typeId: 'type', id: 'mock-type-id' },
            fields: {
              stripeConnector_stripeCustomerId: 'cus_123',
            },
          },
        });

      const stripeSubscriptionsListMock = jest.spyOn(Stripe.prototype.subscriptions, 'list').mockResolvedValue({
        data: [subscriptionResponseMock],
        has_more: false,
        object: 'list',
        url: '',
        lastResponse: {
          headers: {},
          requestId: 'req_123',
          statusCode: 200,
        },
      } as Stripe.Response<Stripe.ApiList<Stripe.Subscription>>);

      const error = new Error('Failed to update subscription');
      const stripeUpdateSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'update')
        .mockRejectedValue(error);

      try {
        await stripeSubscriptionService.updateSubscription({ customerId, subscriptionId });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Failed to update subscription');
      }

      expect(getCustomerByIdMock).toHaveBeenCalledWith(customerId);
      expect(stripeUpdateSubscriptionMock).toHaveBeenCalled();
      expect(stripeSubscriptionsListMock).toHaveBeenCalled();
    });
  });

  describe('method validateCustomerSubscription', () => {
    test('should validate customer subscription successfully', async () => {
      const customerId = 'customer_123';
      const subscriptionId = 'sub_123';

      const spiedGetCustomerSubscriptionsMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'getCustomerSubscriptions')
        .mockResolvedValue([{ id: subscriptionId } as Stripe.Subscription]);

      await stripeSubscriptionService.validateCustomerSubscription(customerId, subscriptionId);

      expect(spiedGetCustomerSubscriptionsMock).toHaveBeenCalledWith(customerId);
    });

    test('should throw error when subscription not found for customer', async () => {
      const customerId = 'customer_123';
      const subscriptionId = 'sub_123';

      const spiedGetCustomerSubscriptionsMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'getCustomerSubscriptions')
        .mockResolvedValue([{ id: 'different_sub' } as Stripe.Subscription]);

      await expect(stripeSubscriptionService.validateCustomerSubscription(customerId, subscriptionId)).rejects.toThrow(
        `Subscription ${subscriptionId} does not belong to customer ${customerId}`,
      );

      expect(spiedGetCustomerSubscriptionsMock).toHaveBeenCalledWith(customerId);
    });
  });
});
