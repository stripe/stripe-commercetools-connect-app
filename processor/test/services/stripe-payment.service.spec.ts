import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import * as StatusHandler from '@commercetools/connect-payments-sdk/dist/api/handlers/status.handler';
import { DefaultPaymentService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-payment.service';
import { DefaultCartService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-cart.service';
import { HealthCheckResult, Money } from '@commercetools/connect-payments-sdk';
import { ClientResponse, Order, Cart } from '@commercetools/platform-sdk';
import { ConfigResponse, ModifyPayment, StatusResponse } from '../../src/services/types/operation.type';
import { paymentSDK } from '../../src/payment-sdk';
import {
  mockGetPaymentAmount,
  mockGetPaymentResult,
  mockStripeCancelPaymentResult,
  mockStripeCapturePaymentResult,
  mockStripeCreatePaymentResult,
  mockStripeCreateRefundResult,
  mockStripePaymentMethodsList,
  mockStripeRetrievePaymentResult,
  mockStripeUpdatePaymentResult,
  mockUpdatePaymentResult,
  mockPaymentResult,
} from '../utils/mock-payment-results';
import {
  mockEvent__invoice_paid__Expanded_Paymnet_intent__amount_paid,
  mockFindPaymentsByInterfaceId__Charge_Failure,
  mockStripeInvoicesRetrievedExpanded,
} from '../utils/mock-subscription-data';
import { mockEvent__paymentIntent_succeeded_captureMethodManual } from '../utils/mock-routes-data';
import { mockGetCartResult, mockGetSubscriptionCart } from '../utils/mock-cart-data';
import { PaymentStatus, StripePaymentServiceOptions } from '../../src/services/types/stripe-payment.type';
import { AbstractPaymentService } from '../../src/services/abstract-payment.service';
import { StripePaymentService } from '../../src/services/stripe-payment.service';
import { SupportedPaymentComponentsSchemaDTO } from '../../src/dtos/operations/payment-componets.dto';
import { StripeEventConverter } from '../../src/services/converters/stripeEventConverter';
import { PaymentTransactions } from '../../src/dtos/operations/payment-intents.dto';
import * as Config from '../../src/config/config';
import * as Logger from '../../src/libs/logger/index';
import { StripeCreatePaymentService } from '../../src/services/stripe-create-payment.service';
import * as StripeClient from '../../src/clients/stripe.client';

jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    paymentIntents: {
      cancel: jest
        .fn<() => Promise<Stripe.Response<Stripe.PaymentIntent>>>()
        .mockResolvedValue(mockStripeCancelPaymentResult),
      retrieve: jest
        .fn<() => Promise<Stripe.Response<Stripe.PaymentIntent>>>()
        .mockResolvedValue(mockStripeRetrievePaymentResult),
      create: jest
        .fn<() => Promise<Stripe.Response<Stripe.PaymentIntent>>>()
        .mockResolvedValue(mockStripeCreatePaymentResult),
      update: jest
        .fn<() => Promise<Stripe.Response<Stripe.PaymentIntent>>>()
        .mockResolvedValue(mockStripeUpdatePaymentResult),
      capture: jest
        .fn<() => Promise<Stripe.Response<Stripe.PaymentIntent>>>()
        .mockResolvedValue(mockStripeCapturePaymentResult),
    },
    refunds: {
      create: jest.fn<() => Promise<Stripe.Response<Stripe.Refund>>>().mockResolvedValue(mockStripeCreateRefundResult),
    },
    paymentMethods: {
      list: jest
        .fn<() => Promise<Stripe.ApiList<Stripe.PaymentMethod>>>()
        .mockResolvedValue(mockStripePaymentMethodsList),
    },
    invoices: {
      retrieve: jest
        .fn<() => Promise<Stripe.Response<Stripe.Invoice>>>()
        .mockResolvedValue(mockStripeInvoicesRetrievedExpanded),
    },
  })),
}));
jest.mock('../../src/libs/logger');

interface FlexibleConfig {
  [key: string]: string | number | Config.PaymentFeatures;
}

function setupMockConfig(keysAndValues: Record<string, string>) {
  const mockConfig: FlexibleConfig = {};
  Object.keys(keysAndValues).forEach((key) => {
    mockConfig[key] = keysAndValues[key];
  });

  jest.spyOn(Config, 'getConfig').mockReturnValue(mockConfig as ReturnType<typeof Config.getConfig>);
}

describe('stripe-payment.service', () => {
  const opts: StripePaymentServiceOptions = {
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
    ctOrderService: paymentSDK.ctOrderService,
  };
  const paymentService: AbstractPaymentService = new StripePaymentService(opts);
  const stripePaymentService: StripePaymentService = new StripePaymentService(opts);

  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
    Stripe.prototype.paymentIntents = {
      create: jest.fn(),
      update: jest.fn(),
      cancel: jest.fn(),
      capture: jest.fn(),
    } as unknown as Stripe.PaymentIntentsResource;
    Stripe.prototype.refunds = {
      create: jest.fn(),
    } as unknown as Stripe.RefundsResource;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('method getConfig', () => {
    test('should return the Stripe configuration successfully', async () => {
      // Setup mock config for a system using `clientKey`
      setupMockConfig({ stripePublishableKey: '', mockEnvironment: 'TEST' });

      const result: ConfigResponse = await paymentService.config();

      // Assertions can remain the same or be adapted based on the abstracted access
      expect(result?.publishableKey).toStrictEqual('');
      expect(result?.environment).toStrictEqual('TEST');
    });
  });

  describe('method getSupportedPaymentComponents', () => {
    test('should return supported payment components successfully', async () => {
      const result: SupportedPaymentComponentsSchemaDTO = await paymentService.getSupportedPaymentComponents();
      expect(result?.dropins).toHaveLength(1);
      expect(result?.dropins[0]?.type).toStrictEqual('embedded');
    });
  });

  describe('method status', () => {
    test('should return Stripe status successfully', async () => {
      const mockHealthCheckFunction: () => Promise<HealthCheckResult> = async () => {
        const result: HealthCheckResult = {
          name: 'CoCo Permissions',
          status: 'DOWN',
          message: 'CoCo Permissions are not available',
          details: {},
        };
        return result;
      };
      Stripe.prototype.paymentMethods = {
        list: jest
          .fn<() => Promise<Stripe.ApiList<Stripe.PaymentMethod>>>()
          .mockResolvedValue(mockStripePaymentMethodsList),
      } as unknown as Stripe.PaymentMethodsResource;

      jest.spyOn(StatusHandler, 'healthCheckCommercetoolsPermissions').mockReturnValue(mockHealthCheckFunction);
      const paymentService: AbstractPaymentService = new StripePaymentService(opts);
      const result: StatusResponse = await paymentService.status();

      expect(result?.status).toBeDefined();
      expect(result?.checks).toHaveLength(2);
      expect(result?.status).toStrictEqual('Partially Available');
      expect(result?.checks[0]?.name).toStrictEqual('CoCo Permissions');
      expect(result?.checks[0]?.status).toStrictEqual('DOWN');
      expect(result?.checks[0]?.details).toStrictEqual({});
      expect(result?.checks[0]?.message).toBeDefined();
      expect(result?.checks[1]?.name).toStrictEqual('Stripe Status check');
      expect(result?.checks[1]?.status).toStrictEqual('UP');
      expect(result?.checks[1]?.details).toBeDefined();
      expect(result?.checks[1]?.message).toBeDefined();
    });
  });

  describe('method modifyPayment', () => {
    test('should cancel a payment successfully', async () => {
      const modifyPaymentOpts: ModifyPayment = {
        paymentId: 'dummy-paymentId',
        data: {
          actions: [
            {
              action: 'cancelPayment',
            },
          ],
        },
      };

      const getPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));
      const stripeApiMock = jest
        .spyOn(Stripe.prototype.paymentIntents, 'cancel')
        .mockReturnValue(Promise.resolve(mockStripeCancelPaymentResult));

      const result = await paymentService.modifyPayment(modifyPaymentOpts);
      expect(result?.outcome).toStrictEqual('approved');
      expect(getPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(2);
      expect(stripeApiMock).toHaveBeenCalled();
    });

    test('should cancel a payment rejected', async () => {
      const modifyPaymentOpts: ModifyPayment = {
        paymentId: 'dummy-paymentId',
        data: {
          actions: [
            {
              action: 'cancelPayment',
            },
          ],
        },
      };

      const getPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));
      const stripeApiMock = jest.spyOn(Stripe.prototype.paymentIntents, 'cancel').mockImplementation(() => {
        throw new Error('Unexpected error calling Stripe API');
      });

      const result = await paymentService.modifyPayment(modifyPaymentOpts);
      expect(result?.outcome).toStrictEqual('rejected');
      expect(getPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(2);
      expect(stripeApiMock).toHaveBeenCalled();
    });

    test('should capture a payment successfully', async () => {
      //Given
      const modifyPaymentOpts: ModifyPayment = {
        paymentId: 'dummy-paymentId',
        data: {
          actions: [
            {
              action: 'capturePayment',
              amount: {
                centAmount: 150000,
                currencyCode: 'USD',
              },
            },
          ],
        },
      };

      const getPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const stripeApiMock = jest
        .spyOn(Stripe.prototype.paymentIntents, 'capture')
        .mockReturnValue(Promise.resolve(mockStripeCapturePaymentResult));

      const result = await paymentService.modifyPayment(modifyPaymentOpts);
      expect(result?.outcome).toStrictEqual('approved');
      expect(getPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(2);
      expect(stripeApiMock).toHaveBeenCalled();
    });

    test('should capture a payment rejected', async () => {
      //Given
      const modifyPaymentOpts: ModifyPayment = {
        paymentId: 'dummy-paymentId',
        data: {
          actions: [
            {
              action: 'capturePayment',
              amount: {
                centAmount: 150000,
                currencyCode: 'USD',
              },
            },
          ],
        },
      };

      const getPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const stripeApiMock = jest.spyOn(Stripe.prototype.paymentIntents, 'capture').mockImplementation(() => {
        throw new Error('Unexpected error calling Stripe API');
      });

      const result = await paymentService.modifyPayment(modifyPaymentOpts);
      expect(result?.outcome).toStrictEqual('rejected');
      expect(getPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(2);
      expect(stripeApiMock).toHaveBeenCalled();
    });

    test('should refund a payment successfully', async () => {
      const modifyPaymentOpts: ModifyPayment = {
        paymentId: 'dummy-paymentId',
        data: {
          actions: [
            {
              action: 'refundPayment',
              amount: {
                centAmount: 150000,
                currencyCode: 'USD',
              },
            },
          ],
        },
      };

      const getPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));
      const stripeApiMock = jest
        .spyOn(Stripe.prototype.refunds, 'create')
        .mockReturnValue(Promise.resolve(mockStripeCreateRefundResult));

      const result = await paymentService.modifyPayment(modifyPaymentOpts);
      expect(result?.outcome).toStrictEqual('received');
      expect(getPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(2);
      expect(stripeApiMock).toHaveBeenCalled();
    });

    test('should refund a payment rejected', async () => {
      const modifyPaymentOpts: ModifyPayment = {
        paymentId: 'dummy-paymentId',
        data: {
          actions: [
            {
              action: 'refundPayment',
              amount: {
                centAmount: 150000,
                currencyCode: 'USD',
              },
            },
          ],
        },
      };

      const getPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));
      const stripeApiMock = jest.spyOn(Stripe.prototype.refunds, 'create').mockImplementation(() => {
        throw new Error('Unexpected error calling Stripe API');
      });

      const result = await paymentService.modifyPayment(modifyPaymentOpts);
      expect(result?.outcome).toStrictEqual('rejected');
      expect(getPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(2);
      expect(stripeApiMock).toHaveBeenCalled();
    });
  });

  describe('method updatePaymentIntentStripeSuccessful', () => {
    test('should update the commercetools payment "Authorization" from "Initial" to "Success"', async () => {
      const getCartMock = jest
        .spyOn(DefaultCartService.prototype, 'getCart')
        .mockReturnValue(Promise.resolve(mockGetCartResult()));
      const getPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await stripePaymentService.updatePaymentIntentStripeSuccessful('paymentId', 'paymentReference');

      expect(getCartMock).toHaveBeenCalled();
      expect(getPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalled();
    });
  });

  describe('method initializeCartPayment', () => {
    test('should return the configuration element and create in the cart a payment "Authorization" as "Initial"', async () => {
      const getCartMock = jest
        .spyOn(DefaultCartService.prototype, 'getCart')
        .mockReturnValue(Promise.resolve(mockGetCartResult()));
      const getPaymentAmountMock = jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockResolvedValue(mockGetPaymentAmount);

      const result = await stripePaymentService.initializeCartPayment('paymentElement');

      expect(result.cartInfo.currency).toStrictEqual(mockGetPaymentAmount.currencyCode);
      expect(result.cartInfo.amount).toStrictEqual(mockGetPaymentAmount.centAmount);
      expect(result).toBeDefined();

      // Or check that the relevant mocks have been called
      expect(getCartMock).toHaveBeenCalled();
      expect(getPaymentAmountMock).toHaveBeenCalled();
      expect(Logger.log.info).toBeCalled();
    });
  });

  describe('method processStripeEvent', () => {
    test('should call updatePayment for a payment_intent succeeded manual event', async () => {
      const mockEvent: Stripe.Event = mockEvent__paymentIntent_succeeded_captureMethodManual;

      const test = {
        id: 'paymentId',
        pspReference: 'paymentIntentId',
        paymentMethod: 'payment',
        transactions: [
          {
            type: PaymentTransactions.AUTHORIZATION,
            state: PaymentStatus.FAILURE,
            amount: {
              centAmount: 1232,
              currencyCode: 'USD',
            },
          },
        ],
      };
      const mockStripeEventConverter = jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(test);
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await stripePaymentService.processStripeEvent(mockEvent);

      expect(mockStripeEventConverter).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(1);
    });

    test('should NOT call updatePayment for a payment_intent succeeded manual event', async () => {
      const mockEvent: Stripe.Event = mockEvent__paymentIntent_succeeded_captureMethodManual;

      const test = {
        id: 'paymentId',
        pspReference: 'paymentIntentId',
        paymentMethod: 'payment',
        transactions: [],
      };
      const mockCart = {
        id: 'mock-cart-id',
        version: 1,
      } as Cart;

      const mockStripeEventConverter = jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(test);
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      jest.spyOn(DefaultCartService.prototype, 'getCartByPaymentId').mockResolvedValue(mockCart);
      jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue();

      await stripePaymentService.processStripeEvent(mockEvent);

      expect(mockStripeEventConverter).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(0);
    });

    describe('method createOrder', () => {
      test('should create an order and update the payment intent metadata', async () => {
        const mockCart: Cart = {
          id: 'mock-cart-id',
          version: 1,
        } as Cart;

        const mockOrderResponse: ClientResponse<Order> = {
          body: {
            id: 'mock-order-id',
            version: 1,
            orderState: 'Open',
            paymentState: 'Paid',
          } as Order,
          statusCode: 201,
          headers: {},
        };

        const executeMock = jest.fn().mockReturnValue(mockOrderResponse);
        const client = paymentSDK.ctAPI.client;
        client.orders = jest.fn(() => ({
          post: jest.fn(() => ({
            execute: executeMock,
          })),
        })) as never;
        const stripeUpdateMock = jest
          .spyOn(Stripe.prototype.paymentIntents, 'update')
          .mockResolvedValue({} as Stripe.Response<Stripe.PaymentIntent>);

        await stripePaymentService.createOrder(mockCart, 'mockPaymentIntent');

        expect(executeMock).toHaveBeenCalled();
        expect(stripeUpdateMock).toHaveBeenCalled();
      });
    });
  });

  describe('method handlePaymentCreation', () => {
    test('should subscription successful', async () => {
      const getCartMock = jest
        .spyOn(StripePaymentService.prototype, 'getCartExpanded')
        .mockResolvedValue(mockGetSubscriptionCart);
      const mockCreateSubscription = jest
        .spyOn(StripeCreatePaymentService.prototype, 'createSubscription')
        .mockResolvedValue(mockPaymentResult);

      const result = await stripePaymentService.handlePaymentCreation();

      expect(result.clientSecret).toStrictEqual(mockPaymentResult.clientSecret);
      expect(result).toBeDefined();
      expect(getCartMock).toHaveBeenCalled();
      expect(mockCreateSubscription).toHaveBeenCalled();
    });

    test('should createPaymentIntent successful', async () => {
      const getCartMock = jest
        .spyOn(StripePaymentService.prototype, 'getCartExpanded')
        .mockReturnValue(Promise.resolve(mockGetCartResult()));
      const mockCreatePaymentIntent = jest
        .spyOn(StripeCreatePaymentService.prototype, 'createPaymentIntent')
        .mockResolvedValue(mockPaymentResult);

      const result = await stripePaymentService.handlePaymentCreation();

      expect(result.clientSecret).toStrictEqual(mockPaymentResult.clientSecret);
      expect(result).toBeDefined();
      expect(getCartMock).toHaveBeenCalled();
      expect(mockCreatePaymentIntent).toHaveBeenCalled();
    });

    test('should fail to create the payment', async () => {
      const error = new Error('Unexpected error calling Stripe API');
      const getCartMock = jest
        .spyOn(StripePaymentService.prototype, 'getCartExpanded')
        .mockReturnValue(Promise.resolve(mockGetCartResult()));
      const mockCreatePaymentIntent = jest
        .spyOn(StripeCreatePaymentService.prototype, 'createPaymentIntent')
        .mockImplementation(() => {
          throw error;
        });
      const wrapStripeError = jest.spyOn(StripeClient, 'wrapStripeError').mockReturnValue(error);

      try {
        await stripePaymentService.handlePaymentCreation();
      } catch (e) {
        expect(wrapStripeError).toHaveBeenCalledWith(e);
      }
      expect(getCartMock).toHaveBeenCalled();
      expect(mockCreatePaymentIntent).toHaveBeenCalled();
    });
  });

  describe('method getCartExpanded', () => {
    test('should get the cart expanded successfully', async () => {
      const mockCart = mockGetSubscriptionCart;
      const mockUpdatedCartResponse: ClientResponse<Cart> = {
        body: mockCart,
        statusCode: 200,
        headers: {},
      };
      const executeMock = jest.fn().mockReturnValue(mockUpdatedCartResponse);
      const client = paymentSDK.ctAPI.client;
      client.carts = jest.fn(() => ({
        withId: jest.fn(() => ({
          get: jest.fn(() => ({
            execute: executeMock,
          })),
        })),
      })) as never;

      const result = await stripePaymentService.getCartExpanded();

      expect(executeMock).toHaveBeenCalled();
      expect(result).toEqual(mockCart);
    });
  });

  describe('method processSubscriptionEvent', () => {
    test('should process subscription invoice.paid successfully updating the payment state', async () => {
      const mockEvent: Stripe.Event = mockEvent__invoice_paid__Expanded_Paymnet_intent__amount_paid;
      const mockedCart = mockGetCartResult();
      const spiedStripeInvoiceExpandedMock = jest
        .spyOn(StripeCreatePaymentService.prototype, 'getStripeInvoiceExpanded')
        .mockReturnValue(Promise.resolve(mockStripeInvoicesRetrievedExpanded));
      const spiedPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const spiedFindPaymentInterfaceIdMock = jest
        .spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId')
        .mockResolvedValue([]);
      const spiedHasTransactionInState = jest
        .spyOn(DefaultPaymentService.prototype, 'hasTransactionInState')
        .mockReturnValue(true);
      const spiedGetCartMock = jest.spyOn(DefaultCartService.prototype, 'getCart').mockResolvedValue(mockedCart);
      const spiedHandleCtPaymentSubscription = jest
        .spyOn(StripeCreatePaymentService.prototype, 'handleCtPaymentSubscription')
        .mockResolvedValue('paymentIdUpdated');
      const spiedGetOrderByPaymentId = jest
        .spyOn(StripePaymentService.prototype, 'addPaymentToOrder')
        .mockResolvedValue(undefined);
      const spiedUpdatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await stripePaymentService.processSubscriptionEvent(mockEvent);

      const mockedInvoice = mockEvent.data.object as Stripe.Invoice;
      const mockedSubscription = mockedInvoice.subscription as Stripe.Subscription;
      const mockedPaymentIntent = mockedInvoice.payment_intent as Stripe.PaymentIntent;
      expect(spiedStripeInvoiceExpandedMock).toHaveBeenCalled();

      expect(spiedPaymentMock).toHaveBeenCalled();
      expect(spiedPaymentMock).toHaveBeenCalledWith({
        id: mockedSubscription.metadata.ct_payment_id,
      });

      expect(spiedFindPaymentInterfaceIdMock).toHaveBeenCalled();
      expect(spiedFindPaymentInterfaceIdMock).toHaveBeenCalledWith({
        interfaceId: mockedPaymentIntent.id,
      });
      expect(spiedFindPaymentInterfaceIdMock).toHaveBeenCalled();
      expect(await spiedFindPaymentInterfaceIdMock.mock.results[0].value).toEqual([]);

      expect(spiedHasTransactionInState).toHaveBeenCalled();
      const calls = spiedHasTransactionInState.mock.calls;
      expect(calls).toContainEqual([
        {
          payment: mockGetPaymentResult,
          transactionType: PaymentTransactions.CHARGE,
          states: [PaymentStatus.PENDING],
        },
      ]);
      expect(spiedHasTransactionInState.mock.results[0].value).toBe(true);

      expect(spiedGetCartMock).toHaveBeenCalledTimes(0);

      expect(spiedHandleCtPaymentSubscription).toHaveBeenCalledTimes(0);
      expect(spiedHandleCtPaymentSubscription).toHaveBeenCalledTimes(0);

      expect(spiedGetOrderByPaymentId).toHaveBeenCalledTimes(0);

      for (const call of spiedUpdatePaymentMock.mock.calls) {
        const updateData = call[0];
        expect(updateData.pspReference).toMatch(/^(in_|sub_|pi_)/);
        if (updateData.transaction) {
          expect(updateData.transaction).toHaveProperty('type');
          expect(updateData.transaction).toHaveProperty('state');
          expect(updateData.transaction).toHaveProperty('amount');
          expect(updateData.transaction.amount.centAmount).toBe(mockedInvoice.amount_paid);
          expect(updateData.transaction).toHaveProperty('interactionId');
          expect(updateData.transaction.interactionId).toMatch(/^(in_)/);
          expect(
            (updateData.transaction.type === PaymentTransactions.AUTHORIZATION &&
              updateData.transaction.state === PaymentStatus.SUCCESS) ||
              (updateData.transaction.type === PaymentTransactions.CHARGE &&
                updateData.transaction.state === PaymentStatus.SUCCESS),
          ).toBe(true);
        }
      }
    });

    test('should process subscription invoice.paid successfully creating a new payment in the order', async () => {
      const mockEvent: Stripe.Event = mockEvent__invoice_paid__Expanded_Paymnet_intent__amount_paid;
      const mockedCart = mockGetCartResult();
      const spiedStripeInvoiceExpandedMock = jest
        .spyOn(StripeCreatePaymentService.prototype, 'getStripeInvoiceExpanded')
        .mockReturnValue(Promise.resolve(mockStripeInvoicesRetrievedExpanded));
      const spiedPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const spiedFindPaymentInterfaceIdMock = jest
        .spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId')
        .mockResolvedValue([]);
      const spiedHasTransactionInState = jest
        .spyOn(DefaultPaymentService.prototype, 'hasTransactionInState')
        .mockReturnValue(false);
      const spiedGetCartMock = jest.spyOn(DefaultCartService.prototype, 'getCart').mockResolvedValue(mockedCart);
      const spiedHandleCtPaymentSubscription = jest
        .spyOn(StripeCreatePaymentService.prototype, 'handleCtPaymentSubscription')
        .mockResolvedValue('paymentIdUpdated');
      const spiedGetOrderByPaymentId = jest
        .spyOn(StripePaymentService.prototype, 'addPaymentToOrder')
        .mockResolvedValue(undefined);
      const spiedUpdatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await stripePaymentService.processSubscriptionEvent(mockEvent);

      const mockedInvoice = mockEvent.data.object as Stripe.Invoice;
      const mockedSubscription = mockedInvoice.subscription as Stripe.Subscription;
      const mockedPaymentIntent = mockedInvoice.payment_intent as Stripe.PaymentIntent;
      expect(spiedStripeInvoiceExpandedMock).toHaveBeenCalled();

      expect(spiedPaymentMock).toHaveBeenCalled();
      expect(spiedPaymentMock).toHaveBeenCalledWith({
        id: mockedSubscription.metadata.ct_payment_id,
      });

      expect(spiedFindPaymentInterfaceIdMock).toHaveBeenCalled();
      expect(spiedFindPaymentInterfaceIdMock).toHaveBeenCalledWith({
        interfaceId: mockedPaymentIntent.id,
      });
      expect(spiedFindPaymentInterfaceIdMock).toHaveBeenCalled();
      expect(await spiedFindPaymentInterfaceIdMock.mock.results[0].value).toEqual([]);

      expect(spiedHasTransactionInState).toHaveBeenCalled(); // mockGetPaymentResult.payment.id
      const calls = spiedHasTransactionInState.mock.calls;
      expect(calls).toContainEqual([
        {
          payment: mockGetPaymentResult,
          transactionType: PaymentTransactions.CHARGE,
          states: [PaymentStatus.PENDING],
        },
      ]);
      expect(spiedHasTransactionInState.mock.results[0].value).toBe(false);

      expect(spiedGetCartMock).toHaveBeenCalled();

      expect(spiedHandleCtPaymentSubscription).toHaveBeenCalled();
      const amountPlanned: Money = {
        currencyCode: mockedInvoice.currency.toUpperCase(),
        centAmount: mockedInvoice.amount_paid,
      };
      expect(spiedHandleCtPaymentSubscription).toHaveBeenCalledWith({
        cart: mockedCart,
        amountPlanned,
        paymentIntentId: mockedPaymentIntent.id,
      });

      expect(spiedGetOrderByPaymentId).toHaveBeenCalled();

      for (const call of spiedUpdatePaymentMock.mock.calls) {
        const updateData = call[0];
        expect(updateData.pspReference).toMatch(/^(in_|sub_|pi_)/);
        if (updateData.transaction) {
          expect(updateData.transaction).toHaveProperty('type');
          expect(updateData.transaction).toHaveProperty('state');
          expect(updateData.transaction).toHaveProperty('amount');
          expect(updateData.transaction.amount.centAmount).toBe(mockedInvoice.amount_paid);
          expect(updateData.transaction).toHaveProperty('interactionId');

          expect(updateData.transaction.interactionId).toMatch(/^(pi_)/);
          expect(
            (updateData.transaction.type === PaymentTransactions.AUTHORIZATION &&
              updateData.transaction.state === PaymentStatus.SUCCESS) ||
              (updateData.transaction.type === PaymentTransactions.CHARGE &&
                updateData.transaction.state === PaymentStatus.SUCCESS),
          ).toBe(true);
        }
        console.log({ updateData });
      }
    });

    test('should process subscription invoice.paid successfully creating a update in the current payment', async () => {
      const mockEvent: Stripe.Event = mockEvent__invoice_paid__Expanded_Paymnet_intent__amount_paid;
      const mockedCart = mockGetCartResult();
      const spiedStripeInvoiceExpandedMock = jest
        .spyOn(StripeCreatePaymentService.prototype, 'getStripeInvoiceExpanded')
        .mockReturnValue(Promise.resolve(mockStripeInvoicesRetrievedExpanded));
      const spiedPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const spiedFindPaymentInterfaceIdMock = jest
        .spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId')
        .mockResolvedValue([]);
      const spiedHasTransactionInState = jest
        .spyOn(DefaultPaymentService.prototype, 'hasTransactionInState')
        .mockReturnValue(false);
      const spiedGetCartMock = jest.spyOn(DefaultCartService.prototype, 'getCart').mockResolvedValue(mockedCart);
      const spiedHandleCtPaymentSubscription = jest
        .spyOn(StripeCreatePaymentService.prototype, 'handleCtPaymentSubscription')
        .mockResolvedValue('paymentIdUpdated');
      const spiedGetOrderByPaymentId = jest
        .spyOn(StripePaymentService.prototype, 'addPaymentToOrder')
        .mockResolvedValue(undefined);
      const spiedUpdatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await stripePaymentService.processSubscriptionEvent(mockEvent);

      const mockedInvoice = mockEvent.data.object as Stripe.Invoice;
      const mockedSubscription = mockedInvoice.subscription as Stripe.Subscription;
      const mockedPaymentIntent = mockedInvoice.payment_intent as Stripe.PaymentIntent;
      expect(spiedStripeInvoiceExpandedMock).toHaveBeenCalled();

      expect(spiedPaymentMock).toHaveBeenCalled();
      expect(spiedPaymentMock).toHaveBeenCalledWith({
        id: mockedSubscription.metadata.ct_payment_id,
      });

      expect(spiedFindPaymentInterfaceIdMock).toHaveBeenCalled();
      expect(spiedFindPaymentInterfaceIdMock).toHaveBeenCalledWith({
        interfaceId: mockedPaymentIntent.id,
      });
      expect(spiedFindPaymentInterfaceIdMock).toHaveBeenCalled();
      expect(await spiedFindPaymentInterfaceIdMock.mock.results[0].value).toEqual([]);

      expect(spiedHasTransactionInState).toHaveBeenCalled();
      expect(spiedHasTransactionInState.mock.calls[0][0]).toMatchObject({
        payment: {
          id: '123456',
          transactions: [],
        },
        transactionType: 'Charge',
        states: ['Pending'],
      });
      expect(spiedHasTransactionInState.mock.results[0].value).toBe(false);

      expect(spiedGetCartMock).toHaveBeenCalled();

      expect(spiedHandleCtPaymentSubscription).toHaveBeenCalled();
      expect(spiedHandleCtPaymentSubscription).toHaveBeenCalled();
      expect(spiedGetOrderByPaymentId).toHaveBeenCalled();

      for (const call of spiedUpdatePaymentMock.mock.calls) {
        const updateData = call[0];
        expect(updateData.pspReference).toMatch(/^(in_|sub_|pi_)/);
        if (updateData.transaction) {
          expect(updateData.transaction).toHaveProperty('type');
          expect(updateData.transaction).toHaveProperty('state');
          expect(updateData.transaction).toHaveProperty('amount');
          expect(updateData.transaction.amount.centAmount).toBe(mockedInvoice.amount_paid);
          expect(updateData.transaction).toHaveProperty('interactionId');
          expect(updateData.transaction.interactionId).toMatch(/^(pi_)/);
          expect(
            (updateData.transaction.type === PaymentTransactions.AUTHORIZATION &&
              updateData.transaction.state === PaymentStatus.SUCCESS) ||
              (updateData.transaction.type === PaymentTransactions.CHARGE &&
                updateData.transaction.state === PaymentStatus.SUCCESS),
          ).toBe(true);
        }
      }
    });

    test('should process subscription invoice.payment_failed successfully creating an update in the failed payment', async () => {
      const mockEvent: Stripe.Event = mockEvent__invoice_paid__Expanded_Paymnet_intent__amount_paid;
      const mockedCart = mockGetCartResult();
      const spiedStripeInvoiceExpandedMock = jest
        .spyOn(StripeCreatePaymentService.prototype, 'getStripeInvoiceExpanded')
        .mockReturnValue(Promise.resolve(mockStripeInvoicesRetrievedExpanded));
      const spiedPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const spiedFindPaymentInterfaceIdMock = jest
        .spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId')
        .mockResolvedValue(mockFindPaymentsByInterfaceId__Charge_Failure);
      const spiedHasTransactionInState = jest
        .spyOn(DefaultPaymentService.prototype, 'hasTransactionInState')
        .mockReturnValue(false);
      const spiedGetCartMock = jest.spyOn(DefaultCartService.prototype, 'getCart').mockResolvedValue(mockedCart);
      const spiedHandleCtPaymentSubscription = jest
        .spyOn(StripeCreatePaymentService.prototype, 'handleCtPaymentSubscription')
        .mockResolvedValue('paymentIdUpdated');
      const spiedGetOrderByPaymentId = jest
        .spyOn(StripePaymentService.prototype, 'addPaymentToOrder')
        .mockResolvedValue(undefined);
      const spiedUpdatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await stripePaymentService.processSubscriptionEvent(mockEvent);

      const mockedInvoice = mockEvent.data.object as Stripe.Invoice;
      const mockedSubscription = mockedInvoice.subscription as Stripe.Subscription;
      const mockedPaymentIntent = mockedInvoice.payment_intent as Stripe.PaymentIntent;
      expect(spiedStripeInvoiceExpandedMock).toHaveBeenCalled();

      expect(spiedPaymentMock).toHaveBeenCalled();
      expect(spiedPaymentMock).toHaveBeenCalledWith({
        id: mockedSubscription.metadata.ct_payment_id,
      });

      expect(spiedFindPaymentInterfaceIdMock).toHaveBeenCalled();
      expect(spiedFindPaymentInterfaceIdMock).toHaveBeenCalledWith({
        interfaceId: mockedPaymentIntent.id,
      });
      expect(spiedFindPaymentInterfaceIdMock).toHaveBeenCalled();
      expect(await spiedFindPaymentInterfaceIdMock.mock.results[0].value).toEqual(
        mockFindPaymentsByInterfaceId__Charge_Failure,
      );

      expect(spiedHasTransactionInState).toHaveBeenCalled();
      expect(spiedHasTransactionInState.mock.calls[0][0]).toMatchObject({
        payment: {
          id: 'failedPaymentId',
          transactions: expect.arrayContaining([
            expect.objectContaining({
              type: 'Charge',
              state: 'Failure',
            }),
          ]),
        },
        transactionType: 'Charge',
        states: ['Pending'],
      });
      expect(spiedHasTransactionInState.mock.results[0].value).toBe(false);
      expect(spiedGetCartMock).toHaveBeenCalledTimes(0);
      expect(spiedHandleCtPaymentSubscription).toHaveBeenCalledTimes(0);
      expect(spiedHandleCtPaymentSubscription).toHaveBeenCalledTimes(0);
      expect(spiedGetOrderByPaymentId).toHaveBeenCalledTimes(0);

      for (const call of spiedUpdatePaymentMock.mock.calls) {
        const updateData = call[0];
        expect(updateData.pspReference).toMatch(/^(in_|sub_|pi_)/);
        if (updateData.transaction) {
          expect(updateData.transaction).toHaveProperty('type');
          expect(updateData.transaction).toHaveProperty('state');
          expect(updateData.transaction).toHaveProperty('amount');
          expect(updateData.transaction.amount.centAmount).toBe(mockedInvoice.amount_paid);
          expect(updateData.transaction).toHaveProperty('interactionId');
          expect(updateData.transaction.interactionId).toMatch(/^(pi_)/);
          expect(
            (updateData.transaction.type === PaymentTransactions.AUTHORIZATION &&
              updateData.transaction.state === PaymentStatus.SUCCESS) ||
              (updateData.transaction.type === PaymentTransactions.CHARGE &&
                updateData.transaction.state === PaymentStatus.SUCCESS),
          ).toBe(true);
        }
      }
    });
  });
});
