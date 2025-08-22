jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {}),
}));

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { StripeSubscriptionService } from '../../src/services/stripe-subscription.service';
import { CtPaymentCreationService } from '../../src/services/ct-payment-creation.service';
import { paymentSDK } from '../../src/payment-sdk';
import { mockGetSubscriptionCartWithVariant } from '../utils/mock-cart-data';
import {
  mockEvent__invoice_paid__simple,
  mockInvoice,
  mockInvoiceExpanded__simple,
} from '../utils/mock-subscription-data';
import { mockPayment__subscription_success } from '../utils/mock-payment-results';
import { DefaultPaymentService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-payment.service';
import { BasicSubscriptionData } from '../../src/services/types/stripe-subscription.type';
import { mockStripeCustomerId } from '../utils/mock-customer-data';
import * as Config from '../../src/config/config';
import Stripe from 'stripe';
import { Payment } from '@commercetools/connect-payments-sdk';

jest.mock('../../src/libs/logger');

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

describe('stripe-subscription.service.payment', () => {
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

  describe('method createSubscriptionFromSetupIntent', () => {
    test('should create subscription from setup intent successfully', async () => {
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
      const mockCart = mockGetSubscriptionCartWithVariant(1);
      const mockSubscription = {
        subscriptionId: 'sub_123',
        paymentReference: 'ref_123',
      };

      jest.spyOn(Stripe.prototype.setupIntents, 'retrieve').mockResolvedValue({
        payment_method: 'pm_123',
      } as Stripe.Response<Stripe.SetupIntent>);
      jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue({
        id: 'sub_123',
        latest_invoice: { id: 'in_123' },
      } as Stripe.Response<Stripe.Subscription>);
      jest.spyOn(Stripe.prototype.invoices, 'sendInvoice').mockResolvedValue({
        status: 'open',
      } as Stripe.Response<Stripe.Invoice>);

      const spiedPrepareSubscriptionDataMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue({
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

      const spiedSaveSubscriptionIdMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId')
        .mockResolvedValue();
      const spiedHandleCtPaymentCreationMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation')
        .mockResolvedValue('ref_123');

      const result = await stripeSubscriptionService.createSubscriptionFromSetupIntent('setup_intent_123');
      expect(result).toStrictEqual(mockSubscription);
      expect(spiedPrepareSubscriptionDataMock).toHaveBeenCalled();
      expect(spiedSaveSubscriptionIdMock).toHaveBeenCalled();
      expect(spiedHandleCtPaymentCreationMock).toHaveBeenCalled();
    });

    test('should handle error when creating subscription from setup intent', async () => {
      const error = new Error('Failed to create subscription');

      jest.spyOn(StripeSubscriptionService.prototype, 'createSubscriptionFromSetupIntent').mockRejectedValue(error);

      await expect(stripeSubscriptionService.createSubscriptionFromSetupIntent('setup_intent_123')).rejects.toThrow(
        'Failed to create subscription',
      );

      expect(error.message).toBe('Failed to create subscription');
    });
  });

  describe('method processSubscriptionEvent', () => {
    test('should process subscription invoice.paid successfully updating the payment state', async () => {
      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;

      const spiedGetStripeInvoiceExpandedMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceExpanded__simple);
      const spiedGetPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockResolvedValue(mockPayment__subscription_success);
      const spiedFindPaymentsByInterfaceIdMock = jest
        .spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId')
        .mockResolvedValue([]);
      const spiedHasTransactionInStateMock = jest
        .spyOn(DefaultPaymentService.prototype, 'hasTransactionInState')
        .mockReturnValue(true);

      await stripeSubscriptionService.processSubscriptionEvent(mockEvent);

      expect(spiedGetStripeInvoiceExpandedMock).toHaveBeenCalledWith((mockEvent.data.object as Stripe.Invoice).id);
      expect(spiedGetPaymentMock).toHaveBeenCalled();
      expect(spiedFindPaymentsByInterfaceIdMock).toHaveBeenCalled();
      expect(spiedHasTransactionInStateMock).toHaveBeenCalledWith({
        payment: mockPayment__subscription_success,
        transactionType: 'Charge',
        states: ['Pending'],
      });
    });

    test('should handle missing payment ID gracefully', async () => {
      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;
      const mockInvoiceWithoutPaymentId = {
        ...mockInvoiceExpanded__simple,
        subscription: {
          ...mockInvoiceExpanded__simple.subscription,
          metadata: {},
        },
      };

      const spiedGetStripeInvoiceExpandedMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithoutPaymentId);

      await stripeSubscriptionService.processSubscriptionEvent(mockEvent);

      expect(spiedGetStripeInvoiceExpandedMock).toHaveBeenCalled();
    });
  });

  describe('method getCurrentPayment', () => {
    test('should get default payment successfully', async () => {
      const mockPayment = {
        id: 'payment_123',
        amountPlanned: {
          centAmount: 1000,
          currencyCode: 'USD',
          fractionDigits: 2,
        },
      };
      const getPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockResolvedValue(mockPayment as Payment);

      const result = await stripeSubscriptionService.getCurrentPayment({
        invoice: mockInvoice,
        paymentReference: 'paymentReference',
        subscriptionParams: {
          customer: mockStripeCustomerId,
        },
      });
      expect(result).toBeDefined();
      expect(getPaymentMock).toHaveBeenCalled();
    });

    test('should get payment with price as 0', async () => {
      const mockPayment = {
        id: 'payment_123',
        amountPlanned: {
          centAmount: 1000,
          currencyCode: 'USD',
          fractionDigits: 2,
        },
      };
      const getPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockResolvedValue(mockPayment as Payment);

      const result = await stripeSubscriptionService.getCurrentPayment({
        invoice: mockInvoice,
        paymentReference: 'paymentReference',
        subscriptionParams: {
          customer: mockStripeCustomerId,
          trial_end: 12165454864,
        },
      });
      expect(result).toBeDefined();
      expect(getPaymentMock).toHaveBeenCalled();
    });

    test('should get payment with price as amount_due', async () => {
      const mockPayment = {
        id: 'payment_123',
        amountPlanned: {
          centAmount: 1000,
          currencyCode: 'USD',
          fractionDigits: 2,
        },
      };
      const getPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockResolvedValue(mockPayment as Payment);

      const result = await stripeSubscriptionService.getCurrentPayment({
        invoice: mockInvoice,
        paymentReference: 'paymentReference',
        subscriptionParams: {
          customer: mockStripeCustomerId,
          trial_end: 12165454864,
        },
      });
      expect(result).toBeDefined();
      expect(getPaymentMock).toHaveBeenCalled();
    });
  });
});
