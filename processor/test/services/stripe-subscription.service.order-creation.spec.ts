/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-require-imports */
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
import {
  mockEvent__invoice_paid__simple,
  mockEvent__charge_succeeded__with_invoice,
  mockInvoiceExpanded__simple,
} from '../utils/mock-subscription-data';
import { mockPayment__subscription_success } from '../utils/mock-payment-results';
import { DefaultPaymentService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-payment.service';
import * as Config from '../../src/config/config';
import Stripe from 'stripe';
import { METADATA_PAYMENT_ID_FIELD, METADATA_CUSTOMER_ID_FIELD, METADATA_CART_ID_FIELD } from '../../src/constants';

jest.mock('../../src/libs/logger', () => ({
  log: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { log } from '../../src/libs/logger';
const mockLog = log as jest.Mocked<typeof log>;

jest.mock('../../src/services/commerce-tools/customer-client', () => ({
  getCustomerById: jest.fn(),
}));

jest.mock('../../src/services/commerce-tools/cart-client', () => ({
  createCartFromDraft: jest.fn(),
  getCartExpanded: jest.fn(),
  updateCartById: jest.fn(),
  freezeCart: jest.fn(),
  isCartFrozen: jest.fn().mockReturnValue(true),
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

describe('Subscription Order Creation Fixes (SUB-ORDER-FIX-05)', () => {
  const opts = {
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
    ctOrderService: paymentSDK.ctOrderService,
  };
  const stripeSubscriptionService = new StripeSubscriptionService(opts);

  beforeEach(async () => {
    jest.setTimeout(10000);
    jest.resetAllMocks();

    // Restore isCartFrozen default
    const cartClient = require('../../src/services/commerce-tools/cart-client');
    cartClient.isCartFrozen.mockReturnValue(true);

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

    Stripe.prototype.subscriptions = {
      create: jest.fn(),
      retrieve: jest.fn(),
      update: jest.fn(),
      list: jest.fn(),
      cancel: jest.fn(),
    } as unknown as Stripe.SubscriptionsResource;

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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Race condition handling (invoice.paid vs charge.succeeded)', () => {
    test('should log info (not error) when version conflict occurs during order creation', async () => {
      // Simulate: first handler created the order, second handler hits version conflict
      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;
      const mockInvoiceWithCharge = {
        ...mockInvoiceExpanded__simple,
        subscription: {
          ...mockInvoiceExpanded__simple.subscription,
          metadata: {
            [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
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

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithCharge as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      // isPaymentChargePending = true so tail block runs
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(true);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment__subscription_success);

      // Mock cart returned by getCartByPaymentId - cart is Active (not yet ordered)
      jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Active',
        version: 1,
      } as any);

      // Mock updateCartAddress succeeds
      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Active',
        version: 2,
      } as any);

      // Mock createOrder throws version conflict (race condition - other handler already created order)
      jest
        .spyOn(StripePaymentService.prototype, 'createOrder')
        .mockRejectedValue(new Error('ConcurrentModification: version mismatch'));

      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent);

      // Key assertion: version conflict should be logged as info, not error
      const infoLogCalls = mockLog.info.mock.calls.map((call: any[]) => call[0]);
      const hasVersionConflictInfoLog = infoLogCalls.some(
        (msg: string) => typeof msg === 'string' && msg.includes('version conflict'),
      );
      expect(hasVersionConflictInfoLog).toBe(true);

      // Verify it was NOT logged as error (the outer catch should not have been reached)
      const errorLogCalls = mockLog.error.mock.calls.map((call: any[]) => call[0]);
      const hasVersionConflictErrorLog = errorLogCalls.some(
        (msg: string) => typeof msg === 'string' && msg.includes('ConcurrentModification'),
      );
      expect(hasVersionConflictErrorLog).toBe(false);
    });

    test('should rethrow non-version-conflict errors from createOrder', async () => {
      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;
      const mockInvoiceWithCharge = {
        ...mockInvoiceExpanded__simple,
        subscription: {
          ...mockInvoiceExpanded__simple.subscription,
          metadata: {
            [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
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

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithCharge as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(true);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment__subscription_success);

      jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Active',
        version: 1,
      } as any);
      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Active',
        version: 2,
      } as any);

      // Non-version-conflict error
      jest.spyOn(StripePaymentService.prototype, 'createOrder').mockRejectedValue(new Error('Network error'));

      // The outer catch in processSubscriptionEventPaid will catch it and log as error
      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent);

      const errorLogCalls = mockLog.error.mock.calls.map((call: any[]) => call[0]);
      const hasProcessingErrorLog = errorLogCalls.some(
        (msg: string) => typeof msg === 'string' && msg.includes('Error processing Subscription'),
      );
      expect(hasProcessingErrorLog).toBe(true);
    });

    test('should skip order creation when cart is already Ordered', async () => {
      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;
      const mockInvoiceWithCharge = {
        ...mockInvoiceExpanded__simple,
        subscription: {
          ...mockInvoiceExpanded__simple.subscription,
          metadata: {
            [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
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

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithCharge as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(true);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment__subscription_success);

      // Cart is already ordered (first handler won the race)
      jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Ordered',
        version: 3,
      } as any);

      const createOrderSpy = jest.spyOn(StripePaymentService.prototype, 'createOrder');

      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent);

      // createOrder should not have been called since cart was already Ordered
      expect(createOrderSpy).not.toHaveBeenCalled();

      // Should have logged that the cart was already ordered
      const infoLogCalls = mockLog.info.mock.calls;
      const hasAlreadyOrderedLog = infoLogCalls.some(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('Cart already ordered'),
      );
      expect(hasAlreadyOrderedLog).toBe(true);
    });
  });

  describe('processSubscriptionEventFailed creates order with paymentState Failed', () => {
    test('should pass paymentState Failed to createSubscriptionOrderFromCart for first payment failures', async () => {
      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;
      const failedPayment = {
        ...mockPayment__subscription_success,
        id: 'failed_payment_123',
        transactions: [{ type: 'Charge', state: 'Failure', amount: { centAmount: 1000, currencyCode: 'USD' } }],
      };
      const mockInvoiceWithCharge = {
        ...mockInvoiceExpanded__simple,
        subscription: {
          ...mockInvoiceExpanded__simple.subscription,
          metadata: {
            [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
          },
        },
        payment_intent: {
          id: 'pi_123',
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

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithCharge as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      // findPaymentsByInterfaceId returns a failed payment => isPaymentFailed = true
      // This skips config branching but still fires the tail block
      jest
        .spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId')
        .mockResolvedValue([failedPayment] as any);
      // isPaymentChargePending = false, but isPaymentFailed = true => tail block still fires
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(failedPayment as any);

      jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Active',
        version: 1,
      } as any);

      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Active',
        version: 2,
      } as any);

      const createOrderSpy = jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue(undefined);

      await stripeSubscriptionService.processSubscriptionEventFailed(mockEvent);

      // Verify createOrder was called with paymentState 'Failed'
      expect(createOrderSpy).toHaveBeenCalled();
      const createOrderCall = createOrderSpy.mock.calls[0][0] as any;
      expect(createOrderCall.paymentState).toBe('Failed');
    });

    test('should pass paymentState Failed to handleSubscriptionPaymentCreateNewOrder for recurring failures', async () => {
      setupMockConfig({
        subscriptionPaymentHandling: 'createOrder',
      });

      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;
      const mockInvoiceWithCustomerId = {
        ...mockInvoiceExpanded__simple,
        subscription: {
          ...mockInvoiceExpanded__simple.subscription,
          metadata: {
            [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
          },
        },
        subscription_details: {
          metadata: {
            [METADATA_CUSTOMER_ID_FIELD]: 'ct_customer_123',
          },
        },
        payment_intent: null,
        charge: null,
      };

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithCustomerId as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      // isPaymentFailed = false, isPaymentChargePending = false => config branching runs
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment__subscription_success);

      // Mock handleSubscriptionPaymentCreateNewOrder
      const handleNewOrderSpy = jest
        .spyOn(StripeSubscriptionService.prototype as any, 'handleSubscriptionPaymentCreateNewOrder')
        .mockRejectedValue(new Error('Customer ID not found in invoice metadata'));

      // Cart is already ordered from first payment
      jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Ordered',
        version: 3,
      } as any);

      await stripeSubscriptionService.processSubscriptionEventFailed(mockEvent);

      // Verify handleSubscriptionPaymentCreateNewOrder was called with paymentState 'Failed'
      expect(handleNewOrderSpy).toHaveBeenCalled();
      const lastArg = handleNewOrderSpy.mock.calls[0][3];
      expect(lastArg).toBe('Failed');
    });
  });

  describe('processSubscriptionEventCharged respects subscriptionPaymentHandling config', () => {
    const mockInvoiceWithConfig = {
      ...mockInvoiceExpanded__simple,
      subscription: {
        ...mockInvoiceExpanded__simple.subscription,
        metadata: {
          [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
        },
      },
      subscription_details: {
        metadata: {
          [METADATA_CART_ID_FIELD]: 'cart_123',
          [METADATA_CUSTOMER_ID_FIELD]: 'ct_customer_123',
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

    test('should call handleSubscriptionPaymentCreateNewOrder when config is createOrder and not charge pending', async () => {
      setupMockConfig({
        subscriptionPaymentHandling: 'createOrder',
      });

      const mockEvent: Stripe.Event = mockEvent__charge_succeeded__with_invoice;

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithConfig as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      // isPaymentChargePending = false => config branching runs
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment__subscription_success);

      const handleNewOrderSpy = jest
        .spyOn(StripeSubscriptionService.prototype as any, 'handleSubscriptionPaymentCreateNewOrder')
        .mockResolvedValue('new_payment_ref');

      // Tail block will also run, mock cart as Ordered so it skips
      jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Ordered',
        version: 3,
      } as any);

      await stripeSubscriptionService.processSubscriptionEventCharged(mockEvent);

      expect(handleNewOrderSpy).toHaveBeenCalled();
      // Verify paymentState 'Paid' is passed
      const paymentStateArg = handleNewOrderSpy.mock.calls[0][3];
      expect(paymentStateArg).toBe('Paid');
    });

    test('should call handlePaidSubscriptionPaymentWithCart when config is addPaymentToOrder and not charge pending', async () => {
      setupMockConfig({
        subscriptionPaymentHandling: 'addPaymentToOrder',
      });

      const mockEvent: Stripe.Event = mockEvent__charge_succeeded__with_invoice;

      const mockInvoiceForAddPayment = {
        ...mockInvoiceWithConfig,
        amount_paid: 1000,
        currency: 'usd',
      };

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceForAddPayment as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      // isPaymentChargePending = false => config branching runs
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment__subscription_success);

      // Mock the addPaymentToOrder path
      jest.spyOn(paymentSDK.ctCartService, 'getCart').mockResolvedValue({
        id: 'cart_123',
        lineItems: [],
        totalPrice: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
      } as any);
      jest.spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentSubscription').mockResolvedValue('new_pay_123');
      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue({
        id: 'cart_123',
        version: 2,
      } as any);
      jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue(undefined);
      jest.spyOn(StripePaymentService.prototype, 'addPaymentToOrder').mockResolvedValue(undefined);

      // Tail block mock
      jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Ordered',
        version: 3,
      } as any);

      const handleNewOrderSpy = jest
        .spyOn(StripeSubscriptionService.prototype as any, 'handleSubscriptionPaymentCreateNewOrder')
        .mockResolvedValue('new_payment_ref');

      await stripeSubscriptionService.processSubscriptionEventCharged(mockEvent);

      // handleSubscriptionPaymentCreateNewOrder should NOT be called
      expect(handleNewOrderSpy).not.toHaveBeenCalled();
      // handlePaidSubscriptionPaymentWithCart uses getCart to get the cart by ID
      expect(paymentSDK.ctCartService.getCart).toHaveBeenCalledWith({ id: 'cart_123' });
    });

    test('should skip config branching when isPaymentChargePending is true (first payment)', async () => {
      setupMockConfig({
        subscriptionPaymentHandling: 'createOrder',
      });

      const mockEvent: Stripe.Event = mockEvent__charge_succeeded__with_invoice;

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithConfig as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      // isPaymentChargePending = true => skip config branching, run tail block
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(true);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment__subscription_success);

      const handleNewOrderSpy = jest
        .spyOn(StripeSubscriptionService.prototype as any, 'handleSubscriptionPaymentCreateNewOrder')
        .mockResolvedValue('new_payment_ref');

      // Tail block runs for first payment
      jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Active',
        version: 1,
      } as any);
      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue({
        id: 'cart_123',
        version: 2,
      } as any);
      jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue(undefined);

      await stripeSubscriptionService.processSubscriptionEventCharged(mockEvent);

      // Config branching should NOT have run (it's first payment)
      expect(handleNewOrderSpy).not.toHaveBeenCalled();
    });
  });

  describe('Unfrozen cart warning in createSubscriptionOrderFromCart', () => {
    test('should log warning when cart is not frozen', async () => {
      const cartClient = require('../../src/services/commerce-tools/cart-client');
      cartClient.isCartFrozen.mockReturnValue(false);

      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;
      const mockInvoiceWithCharge = {
        ...mockInvoiceExpanded__simple,
        subscription: {
          ...mockInvoiceExpanded__simple.subscription,
          metadata: {
            [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
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

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithCharge as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(true);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment__subscription_success);

      jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Active',
        version: 1,
      } as any);
      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Active',
        version: 2,
      } as any);
      jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue(undefined);

      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent);

      // Should have warned about unfrozen cart
      const warnCalls = mockLog.warn.mock.calls;
      const hasUnfrozenWarning = warnCalls.some(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('unfrozen cart'),
      );
      expect(hasUnfrozenWarning).toBe(true);
    });
  });

  describe('processSubscriptionEventPaid tail block guard', () => {
    test('should NOT run tail block when isPaymentChargePending is false and isPaymentFailed is false (recurring payment)', async () => {
      setupMockConfig({
        subscriptionPaymentHandling: 'addPaymentToOrder',
      });

      const mockEvent: Stripe.Event = mockEvent__invoice_paid__simple;
      const mockInvoiceWithCartId = {
        ...mockInvoiceExpanded__simple,
        subscription: {
          ...mockInvoiceExpanded__simple.subscription,
          metadata: {
            [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
          },
        },
        subscription_details: {
          metadata: {
            [METADATA_CART_ID_FIELD]: 'cart_123',
          },
        },
        amount_paid: 1000,
        currency: 'usd',
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

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(mockInvoiceWithCartId as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      // Both false => recurring payment, config branching handles it
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment__subscription_success);

      jest.spyOn(paymentSDK.ctCartService, 'getCart').mockResolvedValue({
        id: 'cart_123',
        lineItems: [],
        totalPrice: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
      } as any);
      jest.spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentSubscription').mockResolvedValue('new_pay_123');
      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue({
        id: 'cart_123',
        version: 2,
      } as any);
      jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue(undefined);
      jest.spyOn(StripePaymentService.prototype, 'addPaymentToOrder').mockResolvedValue(undefined);

      // The tail block uses getCartByPaymentId - if it runs, it would call this
      const getCartByPaymentIdSpy = jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Ordered',
        version: 3,
      } as any);

      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent);

      // Tail block should NOT have run because isPaymentChargePending=false and isPaymentFailed=false
      expect(getCartByPaymentIdSpy).not.toHaveBeenCalled();
    });
  });
});
