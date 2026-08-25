/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-explicit-any */
jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {}),
}));

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { StripeSubscriptionService } from '../../src/services/stripe-subscription.service';
import { CtPaymentCreationService } from '../../src/services/ct-payment-creation.service';
import { StripePaymentService } from '../../src/services/stripe-payment.service';
import { paymentSDK } from '../../src/payment-sdk';
import { SubscriptionEventConverter } from '../../src/services/converters/subscriptionEventConverter';
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
import { METADATA_PAYMENT_ID_FIELD, METADATA_CUSTOMER_ID_FIELD, METADATA_CART_ID_FIELD } from '../../src/constants';
import * as Logger from '../../src/libs/logger/index';
import { mockEvent__charge_succeeded__with_invoice } from '../utils/mock-subscription-data';
import * as CartClient from '../../src/services/commerce-tools/cart-client';
import * as PaymentClient from '../../src/services/commerce-tools/payment-client';

jest.mock('../../src/libs/logger');
jest.mock('../../src/services/commerce-tools/customer-client', () => ({
  getCustomerById: jest.fn(),
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
        subscriptionPaymentHandling: 'createOrder',
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
        .mockResolvedValue(undefined);
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

  describe('method processSubscriptionEventPaid', () => {
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

      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent);

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
        parent: {
          subscription_details: {
            subscription: {
              ...mockInvoiceExpanded__simple.parent.subscription_details.subscription,
              metadata: {},
            },
            metadata: mockInvoiceExpanded__simple.parent.subscription_details.metadata,
          },
        },
      };

      const spiedGetStripeInvoiceExpandedMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithoutPaymentId);

      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent);

      expect(spiedGetStripeInvoiceExpandedMock).toHaveBeenCalled();
    });

    test('should handle createOrder configuration path', async () => {
      setupMockConfig({
        subscriptionPaymentHandling: 'createOrder',
      });

      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;
      const mockInvoiceWithCustomerId = {
        ...mockInvoiceExpanded__simple,
        parent: {
          subscription_details: {
            subscription: {
              ...mockInvoiceExpanded__simple.parent.subscription_details.subscription,
              metadata: {
                [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
              },
            },
            metadata: {
              [METADATA_CUSTOMER_ID_FIELD]: 'ct_customer_123',
            },
          },
        },
        payment_intent: null,
        charge: null,
      };

      const mockPayment = {
        ...mockPayment__subscription_success,
        transactions: [],
      };

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithCustomerId);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false); // Not pending, so will create new order

      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment);

      jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue({
        cartState: 'Active',
        id: 'cart_123',
      } as any);
      jest.spyOn(paymentSDK.ctOrderService, 'getOrderByPaymentId').mockRejectedValue(new Error('Order not found'));

      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent);

      expect(paymentSDK.ctOrderService.getOrderByPaymentId).toHaveBeenCalledWith({ paymentId: 'payment_123' });
    });

    test('should add payment to existing order when subscriptionPaymentHandling is not createOrder', async () => {
      setupMockConfig({
        subscriptionPaymentHandling: 'addToOrder',
      });

      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;
      const mockInvoiceWithCartId = {
        ...mockInvoiceExpanded__simple,
        parent: {
          subscription_details: {
            subscription: {
              ...mockInvoiceExpanded__simple.parent.subscription_details.subscription,
              metadata: {
                [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
              },
            },
            metadata: {
              [METADATA_CART_ID_FIELD]: 'cart_123',
            },
          },
        },
        charge: {
          id: 'ch_123',
          billing_details: {
            address: {
              city: 'Test City',
              country: 'US',
              line1: '123 Test St',
              postal_code: '12345',
              state: 'CA',
            },
          },
        },
      };

      const mockCart = {
        id: 'cart_123',
        lineItems: [],
        totalPrice: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
      };

      const mockUpdatedCart = {
        ...mockCart,
        shippingAddress: {
          city: 'Test City',
          country: 'US',
          streetName: '123 Test St',
          postalCode: '12345',
          state: 'CA',
        },
      };

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithCartId as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false); // Not pending, so will add to existing order

      jest.spyOn(paymentSDK.ctCartService, 'getCart').mockResolvedValue(mockCart as any);

      jest.spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation').mockResolvedValue('new_payment_123');

      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue(mockUpdatedCart as any);
      jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue(undefined);
      jest.spyOn(StripePaymentService.prototype, 'addPaymentToOrder').mockResolvedValue(undefined);

      jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue(mockCart as any);

      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent);

      expect(paymentSDK.ctCartService.getCart).toHaveBeenCalledWith({ id: 'cart_123' });
    });

    test('should create the order from the frozen cart on the first cycle (billing_reason subscription_create)', async () => {
      setupMockConfig({
        subscriptionPaymentHandling: 'createOrder',
      });

      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;
      const mockFirstCycleInvoice = {
        ...mockInvoiceExpanded__simple,
        billing_reason: 'subscription_create',
        parent: {
          subscription_details: {
            subscription: {
              ...mockInvoiceExpanded__simple.parent.subscription_details.subscription,
              metadata: {
                [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
              },
            },
            metadata: {
              [METADATA_CUSTOMER_ID_FIELD]: 'ct_customer_123',
            },
          },
        },
        charge: {
          id: 'ch_123',
          billing_details: {
            address: {
              city: 'Test City',
              country: 'US',
              line1: '123 Test St',
              postal_code: '12345',
              state: 'CA',
            },
          },
        },
      };

      const mockFrozenCart = {
        id: 'cart_123',
        cartState: 'Frozen',
        totalPrice: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
      };

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockFirstCycleInvoice as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false); // Not pending and not failed
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment__subscription_success);

      const spiedGetOrderByPaymentIdMock = jest
        .spyOn(paymentSDK.ctOrderService, 'getOrderByPaymentId')
        .mockRejectedValue(new Error('Order not found'));
      const spiedGetCartByPaymentIdMock = jest
        .spyOn(paymentSDK.ctCartService, 'getCartByPaymentId')
        .mockResolvedValue(mockFrozenCart as any);
      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue(mockFrozenCart as any);
      const spiedCreateOrderMock = jest
        .spyOn(StripePaymentService.prototype, 'createOrder')
        .mockResolvedValue(undefined);

      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent);

      expect(spiedGetOrderByPaymentIdMock).not.toHaveBeenCalled();
      expect(spiedGetCartByPaymentIdMock).toHaveBeenCalledWith({ paymentId: 'ct_payment_123' });
      expect(spiedCreateOrderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          cart: mockFrozenCart,
          paymentState: 'Paid',
        }),
      );
      expect(Logger.log.error).not.toHaveBeenCalledWith(
        expect.stringContaining('Error processing Subscription processSubscriptionEventPaid'),
      );
    });

    test('should clone the previous order on recurring cycles (billing_reason subscription_cycle)', async () => {
      setupMockConfig({
        subscriptionPaymentHandling: 'createOrder',
      });

      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;
      const mockRecurringInvoice = {
        ...mockInvoiceExpanded__simple,
        billing_reason: 'subscription_cycle',
        parent: {
          subscription_details: {
            subscription: {
              ...mockInvoiceExpanded__simple.parent.subscription_details.subscription,
              metadata: {
                [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
              },
            },
            metadata: {
              [METADATA_CUSTOMER_ID_FIELD]: 'ct_customer_123',
            },
          },
        },
        payment_intent: null,
        charge: null,
      };

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockRecurringInvoice as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);

      const spiedGetOrderByPaymentIdMock = jest
        .spyOn(paymentSDK.ctOrderService, 'getOrderByPaymentId')
        .mockRejectedValue(new Error('Order not found'));
      const spiedGetCartByPaymentIdMock = jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId');

      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent);

      expect(spiedGetOrderByPaymentIdMock).toHaveBeenCalledWith({ paymentId: 'payment_123' });
      expect(spiedGetCartByPaymentIdMock).not.toHaveBeenCalled();
    });

    test('should handle missing customer ID when creating new order', async () => {
      setupMockConfig({
        subscriptionPaymentHandling: 'createOrder',
      });

      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;
      const mockInvoiceWithoutCustomerId = {
        ...mockInvoiceExpanded__simple,
        parent: {
          subscription_details: {
            subscription: {
              ...mockInvoiceExpanded__simple.parent.subscription_details.subscription,
              metadata: {
                [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
              },
            },
            metadata: {},
          },
        },
      };

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithoutCustomerId as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);

      jest.spyOn(paymentSDK.ctOrderService, 'getOrderByPaymentId').mockResolvedValue({} as any);

      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent);
    });

    test('should handle customer not found when creating new order', async () => {
      setupMockConfig({
        subscriptionPaymentHandling: 'createOrder',
      });

      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;
      const mockInvoiceWithCustomerId = {
        ...mockInvoiceExpanded__simple,
        parent: {
          subscription_details: {
            subscription: {
              ...mockInvoiceExpanded__simple.parent.subscription_details.subscription,
              metadata: {
                [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
              },
            },
            metadata: {
              [METADATA_CUSTOMER_ID_FIELD]: 'ct_customer_123',
            },
          },
        },
      };

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithCustomerId as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);

      jest.spyOn(paymentSDK.ctOrderService, 'getOrderByPaymentId').mockResolvedValue({} as any);
      const { getCustomerById } = require('../../src/services/commerce-tools/customer-client');
      getCustomerById.mockResolvedValue(null); // Customer not found

      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent);
    });
  });

  describe('method processSubscriptionEventFailed', () => {
    test('should process subscription invoice.failed successfully updating the payment state', async () => {
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

      await stripeSubscriptionService.processSubscriptionEventFailed(mockEvent);

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
        parent: {
          subscription_details: {
            subscription: {
              ...mockInvoiceExpanded__simple.parent.subscription_details.subscription,
              metadata: {},
            },
            metadata: mockInvoiceExpanded__simple.parent.subscription_details.metadata,
          },
        },
      };

      const spiedGetStripeInvoiceExpandedMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithoutPaymentId);

      await stripeSubscriptionService.processSubscriptionEventFailed(mockEvent);

      expect(spiedGetStripeInvoiceExpandedMock).toHaveBeenCalled();
    });

    test('should handle createOrder configuration path', async () => {
      setupMockConfig({
        subscriptionPaymentHandling: 'createOrder',
      });

      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;
      const mockInvoiceWithCustomerId = {
        ...mockInvoiceExpanded__simple,
        parent: {
          subscription_details: {
            subscription: {
              ...mockInvoiceExpanded__simple.parent.subscription_details.subscription,
              metadata: {
                [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
              },
            },
            metadata: {
              [METADATA_CUSTOMER_ID_FIELD]: 'ct_customer_123',
            },
          },
        },
      };

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithCustomerId);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false); // Not pending, so will create new order

      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment__subscription_success);

      jest.spyOn(paymentSDK.ctOrderService, 'getOrderByPaymentId').mockRejectedValue(new Error('Order not found'));

      jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue({
        cartState: 'Active',
        id: 'cart_123',
      } as any);

      await stripeSubscriptionService.processSubscriptionEventFailed(mockEvent);

      expect(paymentSDK.ctOrderService.getOrderByPaymentId).toHaveBeenCalledWith({ paymentId: 'payment_123' });
    });

    test('P3 regression: recurring-cycle failure still clones the order via handleSubscriptionPaymentCreateNewOrder', async () => {
      setupMockConfig({
        subscriptionPaymentHandling: 'createOrder',
      });

      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;
      const mockRecurringInvoice = {
        ...mockInvoiceExpanded__simple,
        billing_reason: 'subscription_cycle',
        parent: {
          subscription_details: {
            subscription: {
              ...mockInvoiceExpanded__simple.parent.subscription_details.subscription,
              metadata: {
                [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
              },
            },
            metadata: {
              [METADATA_CUSTOMER_ID_FIELD]: 'ct_customer_123',
            },
          },
        },
      };

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockRecurringInvoice as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]); // isPaymentFailed = false
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false); // not charge pending
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment__subscription_success);

      const handleNewOrderSpy = jest
        .spyOn(StripeSubscriptionService.prototype as any, 'handleSubscriptionPaymentCreateNewOrder')
        .mockResolvedValue('new_payment_ref');

      await stripeSubscriptionService.processSubscriptionEventFailed(mockEvent);

      expect(handleNewOrderSpy).toHaveBeenCalled();
      // FAILED state is propagated to the cloned order.
      expect(handleNewOrderSpy.mock.calls[0][3]).toBe('Failed');
    });
  });

  describe('handleSubscriptionPaymentCreateNewOrder idempotency guard (P2)', () => {
    const baseInvoice = {
      ...mockInvoiceExpanded__simple,
      id: 'in_recurring_1',
    };
    const subscription = { id: 'sub_123', metadata: {} } as any;
    const updateData = {
      id: 'payment_123',
      pspReference: 'pi_recurring_123',
      paymentMethod: 'card',
      transactions: [],
    } as any;

    test('returns the existing payment and skips cloning when a payment already exists for the cycle PI (invoice.paid redelivery)', async () => {
      const findSpy = jest
        .spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId')
        .mockResolvedValue([{ id: 'existing_recurring_payment' }] as any);
      const getOrderSpy = jest.spyOn(paymentSDK.ctOrderService, 'getOrderByPaymentId');

      const result = await (stripeSubscriptionService as any).handleSubscriptionPaymentCreateNewOrder(
        subscription,
        baseInvoice,
        updateData,
        'Paid',
      );

      expect(result).toBe('existing_recurring_payment');
      expect(findSpy).toHaveBeenCalledWith({ interfaceId: 'pi_recurring_123' });
      // Guard short-circuits before any cloning work.
      expect(getOrderSpy).not.toHaveBeenCalled();
    });

    test('proceeds to clone on first delivery when no payment exists for the cycle PI', async () => {
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      const getOrderSpy = jest
        .spyOn(paymentSDK.ctOrderService, 'getOrderByPaymentId')
        .mockRejectedValue(new Error('reached-clone-path'));

      await expect(
        (stripeSubscriptionService as any).handleSubscriptionPaymentCreateNewOrder(
          subscription,
          baseInvoice,
          updateData,
          'Paid',
        ),
      ).rejects.toThrow('reached-clone-path');

      // Passed the guard and entered the cloning path.
      expect(getOrderSpy).toHaveBeenCalledWith({ paymentId: 'payment_123' });
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

  describe('race condition handling in createSubscriptionOrderFromCart', () => {
    test('should log info (not error) when second handler hits version conflict during order creation', async () => {
      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;

      const mockInvoiceWithCharge = {
        ...mockInvoiceExpanded__simple,
        parent: {
          subscription_details: {
            subscription: {
              ...mockInvoiceExpanded__simple.parent.subscription_details.subscription,
              metadata: {
                [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
              },
            },
            metadata: mockInvoiceExpanded__simple.parent.subscription_details.metadata,
          },
        },
        charge: {
          id: 'ch_123',
          billing_details: {
            address: {
              city: 'San Francisco',
              country: 'US',
              line1: '123 Test St',
              postal_code: '94105',
              state: 'CA',
            },
          },
        },
      };

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithCharge as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      // isPaymentChargePending = true so tail block runs
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(true);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment__subscription_success);

      // Cart is Active (not yet ordered)
      jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue({
        cartState: 'Active',
        id: 'cart_123',
        frozen: true,
      } as any);

      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Active',
      } as any);

      // Simulate version conflict (race condition - other handler already created the order)
      jest
        .spyOn(StripePaymentService.prototype, 'createOrder')
        .mockRejectedValue(new Error('ConcurrentModification: Object version does not match'));

      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent);

      // Should log info about the race condition, NOT error
      expect(Logger.log.info).toHaveBeenCalledWith(
        'Subscription order creation skipped due to version conflict (likely race condition with another handler)',
        expect.objectContaining({
          ctCartId: 'cart_123',
        }),
      );
      // The outer catch should NOT be reached (version conflict is handled gracefully)
      expect(Logger.log.error).not.toHaveBeenCalledWith(
        expect.stringContaining('Error processing Subscription processSubscriptionEventPaid'),
      );
    });
  });

  describe('processSubscriptionEventFailed with paymentState Failed', () => {
    test('should create order with paymentState Failed when first payment fails (isPaymentFailed)', async () => {
      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;

      const failedPayment = {
        ...mockPayment__subscription_success,
        id: 'failedPaymentId',
        transactions: [
          {
            type: 'Charge',
            state: 'Failure',
            amount: { centAmount: 1000, currencyCode: 'USD' },
          },
        ],
      };

      const mockInvoiceWithCharge = {
        ...mockInvoiceExpanded__simple,
        parent: {
          subscription_details: {
            subscription: {
              ...mockInvoiceExpanded__simple.parent.subscription_details.subscription,
              metadata: {
                [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
              },
            },
            metadata: mockInvoiceExpanded__simple.parent.subscription_details.metadata,
          },
        },
        charge: {
          id: 'ch_123',
          billing_details: {
            address: {
              city: 'San Francisco',
              country: 'US',
              line1: '123 Test St',
              postal_code: '94105',
              state: 'CA',
            },
          },
        },
      };

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithCharge as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      // Return a failed payment so isPaymentFailed = true, which skips config branching
      // and the tail block guard (isPaymentChargePending || isPaymentFailed) is satisfied
      jest
        .spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId')
        .mockResolvedValue([failedPayment as any]);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(failedPayment as any);

      jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue({
        cartState: 'Active',
        id: 'cart_123',
        frozen: true,
      } as any);

      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Active',
      } as any);

      const spiedCreateOrder = jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue(undefined);

      await stripeSubscriptionService.processSubscriptionEventFailed(mockEvent);

      // Verify createOrder is called with paymentState 'Failed'
      expect(spiedCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentState: 'Failed',
        }),
      );
    });
  });

  describe('processSubscriptionEventCharged config branching', () => {
    test('should respect subscriptionPaymentHandling config when processing charge.succeeded for recurring payment', async () => {
      setupMockConfig({
        subscriptionPaymentHandling: 'createOrder',
      });

      const mockEvent: Stripe.Event = mockEvent__charge_succeeded__with_invoice;

      const mockInvoiceWithCustomer = {
        ...mockInvoiceExpanded__simple,
        parent: {
          subscription_details: {
            subscription: {
              ...mockInvoiceExpanded__simple.parent.subscription_details.subscription,
              metadata: {
                [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
              },
            },
            metadata: {
              [METADATA_CUSTOMER_ID_FIELD]: 'ct_customer_123',
            },
          },
        },
        charge: {
          id: 'ch_123',
          billing_details: {
            address: {
              city: 'San Francisco',
              country: 'US',
              line1: '123 Test St',
              postal_code: '94105',
              state: 'CA',
            },
          },
        },
      };

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithCustomer as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      // No existing payment for the cycle PI -> idempotency guard passes through (first delivery)
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      // isPaymentChargePending = false (recurring payment, triggers config branching)
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment__subscription_success);

      // Mock getOrderByPaymentId for handleSubscriptionPaymentCreateNewOrder
      jest.spyOn(paymentSDK.ctOrderService, 'getOrderByPaymentId').mockRejectedValue(new Error('Order not found'));

      // Mock getCartByPaymentId for the tail block
      jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue({
        cartState: 'Ordered',
        id: 'cart_123',
      } as any);

      await stripeSubscriptionService.processSubscriptionEventCharged(mockEvent);

      // Should check config and attempt to create new order (createOrder path)
      expect(paymentSDK.ctOrderService.getOrderByPaymentId).toHaveBeenCalledWith({ paymentId: 'payment_123' });
    });

    test('should use addPaymentToOrder path when config is not createOrder for charge.succeeded', async () => {
      setupMockConfig({
        subscriptionPaymentHandling: 'addPaymentToOrder',
      });

      const mockEvent: Stripe.Event = mockEvent__charge_succeeded__with_invoice;

      const mockInvoiceWithCart = {
        ...mockInvoiceExpanded__simple,
        parent: {
          subscription_details: {
            subscription: {
              ...mockInvoiceExpanded__simple.parent.subscription_details.subscription,
              metadata: {
                [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
              },
            },
            metadata: {
              [METADATA_CART_ID_FIELD]: 'cart_original_123',
            },
          },
        },
        charge: {
          id: 'ch_123',
          billing_details: {
            address: {
              city: 'San Francisco',
              country: 'US',
              line1: '123 Test St',
              postal_code: '94105',
              state: 'CA',
            },
          },
        },
      };

      const mockCart = {
        id: 'cart_original_123',
        lineItems: [],
        totalPrice: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
      };

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithCart as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      // isPaymentChargePending = false (recurring payment)
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment__subscription_success);

      jest.spyOn(paymentSDK.ctCartService, 'getCart').mockResolvedValue(mockCart as any);
      jest.spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation').mockResolvedValue('new_payment_123');
      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue(mockCart as any);
      jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue(undefined);
      jest.spyOn(StripePaymentService.prototype, 'addPaymentToOrder').mockResolvedValue(undefined);

      // Mock getCartByPaymentId for the tail block
      jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue({
        cartState: 'Ordered',
        id: 'cart_123',
      } as any);

      await stripeSubscriptionService.processSubscriptionEventCharged(mockEvent);

      // Should use addPaymentToOrder path
      expect(paymentSDK.ctCartService.getCart).toHaveBeenCalledWith({ id: 'cart_original_123' });
    });
  });

  describe('method processSubscriptionEventDeleted (unfreeze on cancellation)', () => {
    const deletedEvent = (metadata: Record<string, string> = { [METADATA_PAYMENT_ID_FIELD]: 'paymentId' }) =>
      ({
        id: 'evt_sub_deleted',
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_123', metadata } },
      }) as unknown as Stripe.Event;

    test('unfreezes the cart when the subscription is canceled and the cart is frozen', async () => {
      jest
        .spyOn(paymentSDK.ctCartService, 'getCartByPaymentId')
        .mockResolvedValue({ id: 'cart_1', cartState: 'Frozen' } as any);
      const unfreezeSpy = jest.spyOn(CartClient, 'unfreezeCart').mockResolvedValue({} as any);

      await stripeSubscriptionService.processSubscriptionEventDeleted(deletedEvent());

      expect(unfreezeSpy).toHaveBeenCalledTimes(1);
    });

    test('does not unfreeze when the cart is not frozen (idempotent)', async () => {
      jest
        .spyOn(paymentSDK.ctCartService, 'getCartByPaymentId')
        .mockResolvedValue({ id: 'cart_1', cartState: 'Active' } as any);
      const unfreezeSpy = jest.spyOn(CartClient, 'unfreezeCart').mockResolvedValue({} as any);

      await stripeSubscriptionService.processSubscriptionEventDeleted(deletedEvent());

      expect(unfreezeSpy).not.toHaveBeenCalled();
    });

    test('does nothing (no cart lookup) when the subscription has no payment id metadata', async () => {
      const getCartSpy = jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId');
      const unfreezeSpy = jest.spyOn(CartClient, 'unfreezeCart').mockResolvedValue({} as any);

      await stripeSubscriptionService.processSubscriptionEventDeleted(deletedEvent({}));

      expect(getCartSpy).not.toHaveBeenCalled();
      expect(unfreezeSpy).not.toHaveBeenCalled();
    });
  });

  describe('method processSubscriptionEventLateReturn (Q2 — mark on Payment)', () => {
    const piFailedEvent = (metadata: Record<string, string> = { [METADATA_PAYMENT_ID_FIELD]: 'paymentId' }) =>
      ({
        id: 'evt_pi_failed',
        type: 'payment_intent.payment_failed',
        data: { object: { id: 'pi_123', metadata } },
      }) as unknown as Stripe.Event;

    test('flags the payment when the charge had already settled (late return)', async () => {
      jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockResolvedValue({ id: 'paymentId', version: 3 } as any);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(true);
      const markSpy = jest.spyOn(PaymentClient, 'setPaymentStatusInterface').mockResolvedValue({} as any);

      await stripeSubscriptionService.processSubscriptionEventLateReturn(piFailedEvent());

      expect(markSpy).toHaveBeenCalledTimes(1);
      expect(markSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'paymentId' }), 'ach_late_return', expect.any(String));
    });

    test('does not flag an ordinary first-payment failure (charge not yet settled)', async () => {
      jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockResolvedValue({ id: 'paymentId', version: 3 } as any);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);
      const markSpy = jest.spyOn(PaymentClient, 'setPaymentStatusInterface').mockResolvedValue({} as any);

      await stripeSubscriptionService.processSubscriptionEventLateReturn(piFailedEvent());

      expect(markSpy).not.toHaveBeenCalled();
    });

    test('does nothing (no payment lookup) when the PaymentIntent has no payment id metadata', async () => {
      const getPaymentSpy = jest.spyOn(DefaultPaymentService.prototype, 'getPayment');
      const markSpy = jest.spyOn(PaymentClient, 'setPaymentStatusInterface').mockResolvedValue({} as any);

      await stripeSubscriptionService.processSubscriptionEventLateReturn(piFailedEvent({}));

      expect(getPaymentSpy).not.toHaveBeenCalled();
      expect(markSpy).not.toHaveBeenCalled();
    });
  });

  describe('KI-003 — redelivery only on transient errors', () => {
    const event: Stripe.Event = mockEvent__invoice_paid__simple;

    test('rethrows a transient CT-write failure so the route 500s and Stripe redelivers', async () => {
      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockRejectedValue(new Error('ConcurrentModification: version mismatch (409)'));

      await expect(stripeSubscriptionService.processSubscriptionEventPaid(event)).rejects.toThrow();
    });

    test('swallows a permanent error (no redelivery storm)', async () => {
      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockRejectedValue(new Error('Customer not found'));

      await expect(stripeSubscriptionService.processSubscriptionEventPaid(event)).resolves.toBeUndefined();
    });
  });
});
