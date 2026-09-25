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

  const mockChargeWithAddress = {
    id: 'ch_123',
    billing_details: {
      address: { city: 'Test City', country: 'US', line1: '123 Test St', postal_code: '12345', state: 'CA' },
    },
  };

  /**
   * An expanded invoice in the configuration the underpayment guard hard-blocks: first cycle,
   * charge_automatically, no trial, real money collected. Override a single field to step outside it
   * and assert the log-only behaviour instead. `trial_end` is lifted onto the subscription, which is
   * where the guard reads it.
   */
  /** `sealedTotal` omitted → the subscription carries no seal (created before the guard shipped). */
  type GuardedInvoiceOverrides = Record<string, unknown> & {
    trial_end?: number;
    sealedTotal?: number;
    sealedCurrency?: string;
  };

  const guardedInvoice = (overrides: Record<string, unknown> = {}) => {
    const { trial_end, sealedTotal, sealedCurrency, ...invoiceOverrides } = overrides as GuardedInvoiceOverrides;
    return {
      ...mockInvoiceExpanded__simple,
      billing_reason: 'subscription_create',
      collection_method: 'charge_automatically',
      amount_paid: 2000,
      currency: 'usd',
      parent: {
        subscription_details: {
          subscription: {
            ...mockInvoiceExpanded__simple.parent.subscription_details.subscription,
            metadata: {
              [METADATA_PAYMENT_ID_FIELD]: 'ct_payment_123',
              // Opt-in: no seal unless the test asks for one, so every pre-existing test keeps
              // exercising the amount guard alone (a subscription created before the seal shipped).
              ...(sealedTotal === undefined
                ? {}
                : {
                    ct_cart_total_amount: String(sealedTotal),
                    ct_cart_total_currency: sealedCurrency ?? 'USD',
                  }),
            },
            trial_end: trial_end ?? null,
          },
          metadata: mockInvoiceExpanded__simple.parent.subscription_details.metadata,
        },
      },
      charge: mockChargeWithAddress,
      ...invoiceOverrides,
    };
  };

  /** Cart the order would be minted from. `centAmount` is what the guard compares against. */
  const guardedCart = ({
    centAmount,
    version = 1,
    cartState = 'Active',
    discountCodes = [] as object[],
  }: {
    centAmount: number;
    version?: number;
    cartState?: string;
    discountCodes?: object[];
  }) => ({
    id: 'cart_123',
    cartState,
    version,
    discountCodes,
    totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount, fractionDigits: 2 },
  });

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
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 1000, fractionDigits: 2 },
        discountCodes: [],
        version: 1,
      } as any);

      // Mock updateCartAddress succeeds
      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Active',
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 1000, fractionDigits: 2 },
        discountCodes: [],
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
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 1000, fractionDigits: 2 },
        discountCodes: [],
        version: 1,
      } as any);
      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Active',
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 1000, fractionDigits: 2 },
        discountCodes: [],
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
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 1000, fractionDigits: 2 },
        discountCodes: [],
        version: 1,
      } as any);

      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Active',
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 1000, fractionDigits: 2 },
        discountCodes: [],
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
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 1000, fractionDigits: 2 },
        discountCodes: [],
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
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 1000, fractionDigits: 2 },
        discountCodes: [],
        version: 1,
      } as any);
      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue({
        id: 'cart_123',
        cartState: 'Active',
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 1000, fractionDigits: 2 },
        discountCodes: [],
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

    // This case used to assert warn-AND-CONTINUE: an unfrozen, enlarged cart still minted a Paid
    // order. That is the reported vulnerability (KI-054), so the expectation is now warn-AND-BLOCK.
    // The warning stays — it is a useful signal — but it is no longer the only reaction.
    test('should warn AND block the order when an unfrozen cart no longer matches what was collected', async () => {
      const cartClient = require('../../src/services/commerce-tools/cart-client');
      cartClient.isCartFrozen.mockReturnValue(false);

      jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockResolvedValue(guardedInvoice() as any);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(true);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment__subscription_success);

      // The exploit: €20.00 collected, then the cart is enlarged to €70.00 before invoice.paid lands.
      jest
        .spyOn(paymentSDK.ctCartService, 'getCartByPaymentId')
        .mockResolvedValue(guardedCart({ centAmount: 7000 }) as any);
      jest
        .spyOn(StripePaymentService.prototype, 'updateCartAddress')
        .mockResolvedValue(guardedCart({ centAmount: 7000, version: 2 }) as any);
      const createOrderSpy = jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue(undefined);

      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent__invoice_paid__simple);

      expect(createOrderSpy).not.toHaveBeenCalled();
      expect(
        mockLog.warn.mock.calls.some((call: any[]) => typeof call[0] === 'string' && call[0].includes('unfrozen cart')),
      ).toBe(true);
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining('subscription underpayment guard'),
        expect.objectContaining({ stripeAmountPaid: 2000, cartTotalCentAmount: 7000 }),
      );
    });
  });

  describe('Subscription underpayment guard (KI-054)', () => {
    beforeEach(() => {
      const cartClient = require('../../src/services/commerce-tools/cart-client');
      cartClient.isCartFrozen.mockReturnValue(true);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(true);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment__subscription_success);
    });

    /** Runs invoice.paid with the given invoice and cart, and reports what the guard did. */
    const runPaidEvent = async (invoice: object, cart: object) => {
      jest.spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded').mockResolvedValue(invoice as any);
      jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue(cart as any);
      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue(cart as any);
      const createOrderSpy = jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue(undefined);

      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent__invoice_paid__simple);
      return createOrderSpy;
    };

    test('creates the order when the collected amount matches the cart total', async () => {
      const createOrderSpy = await runPaidEvent(guardedInvoice(), guardedCart({ centAmount: 2000 }));

      expect(createOrderSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentState: 'Paid' }));
      expect(mockLog.error).not.toHaveBeenCalledWith(
        expect.stringContaining('subscription underpayment guard'),
        expect.anything(),
      );
    });

    test('pins the validated cart version so a cart that moved after validation cannot mint an order', async () => {
      const createOrderSpy = await runPaidEvent(guardedInvoice(), guardedCart({ centAmount: 2000, version: 7 }));

      expect(createOrderSpy).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 7 }));
    });

    test('blocks the order when less was collected than the cart total', async () => {
      const createOrderSpy = await runPaidEvent(guardedInvoice(), guardedCart({ centAmount: 7000 }));

      expect(createOrderSpy).not.toHaveBeenCalled();
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining('order NOT created'),
        expect.objectContaining({ stripeAmountPaid: 2000, cartTotalCentAmount: 7000 }),
      );
    });

    test('blocks the order when the currency does not match', async () => {
      const createOrderSpy = await runPaidEvent(guardedInvoice({ currency: 'eur' }), guardedCart({ centAmount: 2000 }));

      expect(createOrderSpy).not.toHaveBeenCalled();
    });

    // The legitimate-divergence matrix. In each of these a first invoice may differ from the cart
    // total by design, so the guard must log and still create the order — blocking here would reject
    // honest business, which is the KI-047 failure mode.
    test.each([
      ['a trial subscription', guardedInvoice({ trial_end: 1800000000 })],
      ['a recurring cycle', guardedInvoice({ billing_reason: 'subscription_cycle' })],
      ['send_invoice collection', guardedInvoice({ collection_method: 'send_invoice' })],
      ['a zero first invoice (free anchor days)', guardedInvoice({ amount_paid: 0 })],
    ])('logs but still creates the order for %s', async (_case, invoice) => {
      const createOrderSpy = await runPaidEvent(invoice, guardedCart({ centAmount: 7000 }));

      expect(createOrderSpy).toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('flagged for reconciliation'),
        expect.anything(),
      );
    });

    test('logs but still creates the order when the INVOICE itself carries a discount', async () => {
      const createOrderSpy = await runPaidEvent(
        guardedInvoice({ total_discount_amounts: [{ amount: 500, discount: 'di_1' }] }),
        guardedCart({ centAmount: 7000 }),
      );

      expect(createOrderSpy).toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('flagged for reconciliation'),
        expect.anything(),
      );
    });

    // Regression: the discount exemption must be read from the invoice, never from the cart. Reading it
    // from `cart.discountCodes` was shopper-controlled at exactly the moment of the attack — the same
    // CT call that enlarges the unfrozen cart can add a discount code, which switched the guard off and
    // re-opened the hole. An undiscounted invoice must still block, whatever the cart now claims.
    test('still blocks when the cart gained a discount code but the invoice carries none', async () => {
      const createOrderSpy = await runPaidEvent(
        guardedInvoice(),
        guardedCart({ centAmount: 7000, discountCodes: [{ discountCode: { id: 'dc_1', typeId: 'discount-code' } }] }),
      );

      expect(createOrderSpy).not.toHaveBeenCalled();
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining('order NOT created'),
        expect.objectContaining({ stripeAmountPaid: 2000, cartTotalCentAmount: 7000 }),
      );
    });

    test('leaves the already-Ordered idempotency skip untouched (guard never runs)', async () => {
      const createOrderSpy = await runPaidEvent(
        guardedInvoice(),
        guardedCart({ centAmount: 7000, cartState: 'Ordered' }),
      );

      expect(createOrderSpy).not.toHaveBeenCalled();
      expect(mockLog.error).not.toHaveBeenCalledWith(
        expect.stringContaining('subscription underpayment guard'),
        expect.anything(),
      );
      expect(mockLog.info).toHaveBeenCalledWith('Cart already ordered, skipping subscription order creation', {
        ctCartId: 'cart_123',
        invoiceId: 'in_123',
      });
    });
  });

  describe('Cart drift guard — the discount exemption is not attacker-selectable', () => {
    beforeEach(() => {
      const cartClient = require('../../src/services/commerce-tools/cart-client');
      cartClient.isCartFrozen.mockReturnValue(false); // shopper released it via /shipping-methods/remove
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockPayment__subscription_success);
      jest.spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId').mockResolvedValue([]);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(true);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue(mockPayment__subscription_success);
    });

    const runPaidEvent = async (invoice: object, cart: object) => {
      jest.spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded').mockResolvedValue(invoice as any);
      jest.spyOn(paymentSDK.ctCartService, 'getCartByPaymentId').mockResolvedValue(cart as any);
      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue(cart as any);
      const createOrderSpy = jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue(undefined);
      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent__invoice_paid__simple);
      return createOrderSpy;
    };

    // The reported chain (CONNECTORS-3365), plus the one extra step that used to defeat it: apply any
    // valid discount code first, so the invoice carries `discounts` and the amount guard exempts it.
    // Priced at EUR 20.00, cart enlarged to EUR 70.00 — the reporter's own figures.
    test('BLOCKS the enlarged cart even though the invoice carries a discount', async () => {
      const createOrderSpy = await runPaidEvent(
        guardedInvoice({ discounts: ['di_legit_10pct'], sealedTotal: 2000 }),
        guardedCart({ centAmount: 7000 }),
      );

      expect(createOrderSpy).not.toHaveBeenCalled();
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining('cart drift guard'),
        expect.objectContaining({ pricedCartTotal: 2000, currentCartTotal: 7000, hasInvoiceDiscount: true }),
      );
    });

    test('BLOCKS an enlarged cart on a trial subscription, which the amount guard also exempts', async () => {
      const createOrderSpy = await runPaidEvent(
        guardedInvoice({ trial_end: 1800000000, sealedTotal: 2000 }),
        guardedCart({ centAmount: 7000 }),
      );

      expect(createOrderSpy).not.toHaveBeenCalled();
    });

    test('BLOCKS when the cart currency changed under an equal amount', async () => {
      const createOrderSpy = await runPaidEvent(
        guardedInvoice({ sealedTotal: 2000, sealedCurrency: 'EUR' }),
        guardedCart({ centAmount: 2000 }), // guardedCart is USD
      );

      expect(createOrderSpy).not.toHaveBeenCalled();
    });

    test('creates the order when the cart still matches what was priced', async () => {
      const createOrderSpy = await runPaidEvent(
        guardedInvoice({ sealedTotal: 2000 }),
        guardedCart({ centAmount: 2000 }),
      );

      expect(createOrderSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentState: 'Paid' }));
    });

    // The drift guard must not swallow the legitimate-divergence matrix: with an honest cart, a
    // discounted invoice whose amount differs from the cart total still creates the order.
    test('still allows a discounted invoice to diverge in AMOUNT when the cart has not moved', async () => {
      const createOrderSpy = await runPaidEvent(
        guardedInvoice({ discounts: ['di_legit_10pct'], sealedTotal: 7000 }),
        guardedCart({ centAmount: 7000 }),
      );

      expect(createOrderSpy).toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('flagged for reconciliation'),
        expect.anything(),
      );
    });

    // Rule 7 is evaluated on the cart as read at webhook time, BEFORE updateCartAddress. The seal predates
    // any address, so a shipping rate that legitimately changes once the destination is known must not
    // read as drift. Every other test here returns the same cart from updateCartAddress, so without this
    // one the check could move after the address write and the suite would stay green.
    test('does not treat a total that moves only on the address write as drift', async () => {
      const invoice = guardedInvoice({ discounts: ['di_legit_10pct'], sealedTotal: 2000 });
      jest.spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded').mockResolvedValue(invoice as any);
      jest
        .spyOn(paymentSDK.ctCartService, 'getCartByPaymentId')
        .mockResolvedValue(guardedCart({ centAmount: 2000 }) as any);
      jest
        .spyOn(StripePaymentService.prototype, 'updateCartAddress')
        .mockResolvedValue(guardedCart({ centAmount: 2500, version: 2 }) as any);
      const createOrderSpy = jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue(undefined);

      await stripeSubscriptionService.processSubscriptionEventPaid(mockEvent__invoice_paid__simple);

      expect(mockLog.error).not.toHaveBeenCalledWith(expect.stringContaining('cart drift guard'), expect.anything());
      expect(createOrderSpy).toHaveBeenCalled();
    });

    // Subscriptions created before this shipped carry no seal. They must keep their previous
    // behaviour rather than being blocked wholesale on their next invoice.
    test('falls back to the previous behaviour when the subscription carries no seal', async () => {
      const createOrderSpy = await runPaidEvent(
        guardedInvoice({ discounts: ['di_legit_10pct'] }),
        guardedCart({ centAmount: 7000 }),
      );

      expect(createOrderSpy).toHaveBeenCalled();
    });

    // amount_paid === 0 is one of the amount guard's exemptions (free anchor days). Drift is a
    // separate question and must still be asked, or the exemption list stays attacker-reachable.
    test('BLOCKS a drifted cart on a zero first invoice, which the amount guard exempts', async () => {
      const createOrderSpy = await runPaidEvent(
        guardedInvoice({ sealedTotal: 2000, amount_paid: 0 }),
        guardedCart({ centAmount: 7000 }),
      );

      expect(createOrderSpy).not.toHaveBeenCalled();
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('cart drift guard'), expect.anything());
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
