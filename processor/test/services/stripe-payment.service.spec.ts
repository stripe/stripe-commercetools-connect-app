import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import * as StatusHandler from '@commercetools/connect-payments-sdk/dist/api/handlers/status.handler';
import { DefaultPaymentService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-payment.service';
import { DefaultCartService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-cart.service';
import { HealthCheckResult, Money } from '@commercetools/connect-payments-sdk';
import { Cart } from '@commercetools/platform-sdk';
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
} from '../utils/mock-payment-results';
import {
  mockEvent__invoice_paid__Expanded_Paymnet_intent__amount_paid,
  mockFindPaymentsByInterfaceId__Charge_Failure,
  mockStripeInvoicesRetrievedExpanded,
} from '../utils/mock-subscription-data';
import {
  mockEvent__charge_succeeded_notCaptured,
  mockEvent__paymentIntent_succeeded_captureMethodManual,
} from '../utils/mock-routes-data';
import { mockGetCartResult, orderMock } from '../utils/mock-cart-data';
import { PaymentStatus, StripePaymentServiceOptions } from '../../src/services/types/stripe-payment.type';
import { AbstractPaymentService } from '../../src/services/abstract-payment.service';
import { StripePaymentService } from '../../src/services/stripe-payment.service';
import { SupportedPaymentComponentsSchemaDTO } from '../../src/dtos/operations/payment-componets.dto';
import { StripeEventConverter } from '../../src/services/converters/stripeEventConverter';
import { PaymentTransactions } from '../../src/dtos/operations/payment-intents.dto';
import * as Config from '../../src/config/config';
import * as Logger from '../../src/libs/logger/index';
import { CtPaymentCreationService } from '../../src/services/ct-payment-creation.service';
import { StripeSubscriptionService } from '../../src/services/stripe-subscription.service';
import * as CartClient from '../../src/services/commerce-tools/cart-client';
import * as OrderClient from '../../src/services/commerce-tools/order-client';
import { StripeCustomerService } from '../../src/services/stripe-customer.service';
import { mockCtCustomerData } from '../utils/mock-customer-data';
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
    subscriptions: {
      update: jest
        .fn<() => Promise<Stripe.Response<Stripe.Subscription>>>()
        .mockResolvedValue({} as Stripe.Response<Stripe.Subscription>),
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
    Stripe.prototype.subscriptions = {
      update: jest.fn(),
    } as unknown as Stripe.SubscriptionsResource;
    Stripe.prototype.charges = {
      retrieve: jest.fn(),
    } as unknown as Stripe.ChargesResource;
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
      expect(updatePaymentMock).toHaveBeenCalledTimes(1);
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
      expect(updatePaymentMock).toHaveBeenCalledTimes(0);
      expect(stripeApiMock).toHaveBeenCalled();
    });

    test('should cancel a payment successfully', async () => {
      const modifyPaymentOpts: ModifyPayment = {
        paymentId: 'dummy-paymentId',
        data: {
          actions: [
            {
              action: 'reversePayment',
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
      const mockHasTransactionInState = jest
        .spyOn(DefaultPaymentService.prototype, 'hasTransactionInState')
        .mockImplementation(({ payment, transactionType, states }) => {
          if (transactionType === PaymentTransactions.CHARGE) {
            return false;
          } else if (transactionType === PaymentTransactions.REFUND) {
            return false;
          } else if (transactionType === PaymentTransactions.CANCEL_AUTHORIZATION) {
            return false;
          } else if (transactionType === PaymentTransactions.AUTHORIZATION) {
            return true;
          }
          console.log(`${payment} ${transactionType} ${states}`);
          return false;
        });

      const result = await paymentService.modifyPayment(modifyPaymentOpts);
      expect(result?.outcome).toStrictEqual('approved');
      expect(getPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(1);
      expect(stripeApiMock).toHaveBeenCalled();
      expect(mockHasTransactionInState).toHaveBeenCalledTimes(4);
    });

    test('should cancel a payment rejected', async () => {
      const modifyPaymentOpts: ModifyPayment = {
        paymentId: 'dummy-paymentId',
        data: {
          actions: [
            {
              action: 'reversePayment',
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
      const mockHasTransactionInState = jest
        .spyOn(DefaultPaymentService.prototype, 'hasTransactionInState')
        .mockImplementation(({ payment, transactionType, states }) => {
          if (transactionType === PaymentTransactions.CHARGE) {
            return false;
          } else if (transactionType === PaymentTransactions.REFUND) {
            return false;
          } else if (transactionType === PaymentTransactions.CANCEL_AUTHORIZATION) {
            return false;
          } else if (transactionType === PaymentTransactions.AUTHORIZATION) {
            return true;
          }
          console.log(`${payment} ${transactionType} ${states}`);
          return false;
        });

      const result = await paymentService.modifyPayment(modifyPaymentOpts);
      expect(result?.outcome).toStrictEqual('rejected');
      expect(getPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(0);
      expect(stripeApiMock).toHaveBeenCalled();
      expect(mockHasTransactionInState).toHaveBeenCalledTimes(4);
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
      expect(updatePaymentMock).toHaveBeenCalledTimes(1);
      expect(stripeApiMock).toHaveBeenCalled();
    });

    test('should capture a payment requires_action', async () => {
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
        .mockReturnValue(Promise.resolve({ ...mockStripeCapturePaymentResult, status: 'requires_capture' }));

      const result = await paymentService.modifyPayment(modifyPaymentOpts);
      expect(result?.outcome).toStrictEqual('rejected');
      expect(getPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(0);
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
      expect(updatePaymentMock).toHaveBeenCalledTimes(0);
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
      expect(updatePaymentMock).toHaveBeenCalledTimes(1);
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
      expect(updatePaymentMock).toHaveBeenCalledTimes(0);
      expect(stripeApiMock).toHaveBeenCalled();
    });

    test('should reverse refund a payment successfully', async () => {
      const modifyPaymentOpts: ModifyPayment = {
        paymentId: 'dummy-paymentId',
        data: {
          actions: [
            {
              action: 'reversePayment',
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
      const mockHasTransactionInState = jest
        .spyOn(DefaultPaymentService.prototype, 'hasTransactionInState')
        .mockImplementation(({ payment, transactionType, states }) => {
          if (transactionType === PaymentTransactions.CHARGE) {
            return true;
          } else if (transactionType === PaymentTransactions.REFUND) {
            return false;
          } else if (transactionType === PaymentTransactions.CANCEL_AUTHORIZATION) {
            return false;
          }
          console.log(`${payment} ${transactionType} ${states}`);
          return false;
        });

      const result = await paymentService.modifyPayment(modifyPaymentOpts);
      expect(result?.outcome).toStrictEqual('received');
      expect(getPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(1);
      expect(stripeApiMock).toHaveBeenCalled();
      expect(mockHasTransactionInState).toHaveBeenCalledTimes(3);
    });

    test('should reverse refund a payment rejected', async () => {
      const modifyPaymentOpts: ModifyPayment = {
        paymentId: 'dummy-paymentId',
        data: {
          actions: [
            {
              action: 'reversePayment',
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
      const mockHasTransactionInState = jest
        .spyOn(DefaultPaymentService.prototype, 'hasTransactionInState')
        .mockImplementation(({ payment, transactionType, states }) => {
          if (transactionType === PaymentTransactions.CHARGE) {
            return true;
          } else if (transactionType === PaymentTransactions.REFUND) {
            return false;
          } else if (transactionType === PaymentTransactions.CANCEL_AUTHORIZATION) {
            return false;
          }
          console.log(`${payment} ${transactionType} ${states}`);
          return false;
        });

      const result = await paymentService.modifyPayment(modifyPaymentOpts);
      expect(result?.outcome).toStrictEqual('rejected');
      expect(getPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(0);
      expect(stripeApiMock).toHaveBeenCalled();
      expect(mockHasTransactionInState).toHaveBeenCalledTimes(3);
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

    test('should catch error ', async () => {
      const mockError = new Error('Cart retrieval failed');
      const getCartMock = jest.spyOn(DefaultCartService.prototype, 'getCart').mockImplementation(() => {
        throw mockError;
      });

      const getPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await stripePaymentService.updatePaymentIntentStripeSuccessful('paymentId', 'paymentReference');

      expect(getCartMock).toHaveBeenCalled();
      expect(getPaymentMock).not.toHaveBeenCalled();
      expect(updatePaymentMock).not.toHaveBeenCalled();
    });
  });

  describe('method createPaymentIntentStripe', () => {
    test('should createPaymentIntent successful', async () => {
      const getCartMock = jest.spyOn(DefaultCartService.prototype, 'getCart').mockResolvedValue(mockGetCartResult());
      const getCtCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'getCtCustomer')
        .mockResolvedValue(mockCtCustomerData);
      const getPaymentAmountMock = jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockResolvedValue(mockGetPaymentAmount);
      const stripeCreatePaymentIntentMock = jest
        .spyOn(Stripe.prototype.paymentIntents, 'create')
        .mockReturnValue(Promise.resolve(mockStripeCreatePaymentResult));
      const handleCtPaymentCreationMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation')
        .mockResolvedValue(mockGetPaymentResult.id);

      const result = await stripePaymentService.createPaymentIntent();

      expect(result.clientSecret).toStrictEqual(mockStripeCreatePaymentResult.client_secret);
      expect(result).toBeDefined();
      expect(getCartMock).toHaveBeenCalled();
      expect(getCtCustomerMock).toHaveBeenCalled();
      expect(getPaymentAmountMock).toHaveBeenCalled();
      expect(stripeCreatePaymentIntentMock).toHaveBeenCalled();
      expect(handleCtPaymentCreationMock).toHaveBeenCalled();
    });

    test('should fail to create the payment intent', async () => {
      const error = new Error('Unexpected error calling Stripe API');
      const getCartMock = jest.spyOn(DefaultCartService.prototype, 'getCart').mockResolvedValue(mockGetCartResult());
      const getCtCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'getCtCustomer')
        .mockResolvedValue(mockCtCustomerData);
      const getPaymentAmountMock = jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockResolvedValue(mockGetPaymentAmount);
      const stripeApiMock = jest.spyOn(Stripe.prototype.paymentIntents, 'create').mockImplementation(() => {
        throw error;
      });
      const wrapStripeError = jest.spyOn(StripeClient, 'wrapStripeError').mockReturnValue(error);

      try {
        await stripePaymentService.createPaymentIntent();
      } catch (e) {
        expect(wrapStripeError).toHaveBeenCalledWith(e);
      }

      expect(getCartMock).toHaveBeenCalled();
      expect(getCtCustomerMock).toHaveBeenCalled();
      expect(getPaymentAmountMock).toHaveBeenCalled();
      expect(stripeApiMock).toHaveBeenCalled();
    });
  });

  describe('method initializeCartPayment', () => {
    test('should return the configuration element and create in the cart a payment "Authorization" as "Initial"', async () => {
      const getCartMock = jest.spyOn(CartClient, 'getCartExpanded').mockResolvedValue(mockGetCartResult());
      const getPaymentAmountMock = jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockResolvedValue(mockGetPaymentAmount);
      const paymentModeMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'getPaymentMode')
        .mockReturnValue('payment');
      const result = await stripePaymentService.initializeCartPayment('paymentElement');

      expect(result.cartInfo.currency).toStrictEqual(mockGetPaymentAmount.currencyCode);
      expect(result.cartInfo.amount).toStrictEqual(mockGetPaymentAmount.centAmount);
      expect(result).toBeDefined();

      // Or check that the relevant mocks have been called
      expect(getCartMock).toHaveBeenCalled();
      expect(getPaymentAmountMock).toHaveBeenCalled();
      expect(paymentModeMock).toHaveBeenCalled();
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

    test('should update payment for charge succeeded with empty transactions', async () => {
      const mockEvent: Stripe.Event = {
        ...mockEvent__charge_succeeded_notCaptured,
      };

      const mockUpdateData = {
        id: 'paymentId',
        pspReference: 'paymentIntentId',
        paymentMethod: 'payment',
        transactions: [],
      };

      const mockStripeEventConverter = jest
        .spyOn(StripeEventConverter.prototype, 'convert')
        .mockReturnValue(mockUpdateData);

      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValueOnce(Promise.resolve(mockGetPaymentResult))
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      const hasTransactionInStateMock = jest
        .spyOn(DefaultPaymentService.prototype, 'hasTransactionInState')
        .mockReturnValue(true);

      await stripePaymentService.processStripeEvent(mockEvent);

      expect(mockStripeEventConverter).toHaveBeenCalledWith(mockEvent);
      expect(updatePaymentMock).toHaveBeenCalled();
      expect(hasTransactionInStateMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalledWith('Payment information updated', expect.any(Object));
    });

    test('should update payment for charge succeeded with empty transactions but no initial auth', async () => {
      // Mock a charge succeeded event
      const mockEvent: Stripe.Event = {
        ...mockEvent__charge_succeeded_notCaptured,
      };

      // Mock empty transactions to trigger the specific branch
      const mockUpdateData = {
        id: 'paymentId',
        pspReference: 'chargeId',
        paymentMethod: 'payment',
        transactions: [], // Empty transactions to trigger the if branch
      };

      // Set up mocks
      const mockStripeEventConverter = jest
        .spyOn(StripeEventConverter.prototype, 'convert')
        .mockReturnValue(mockUpdateData);

      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      const hasTransactionInStateMock = jest
        .spyOn(DefaultPaymentService.prototype, 'hasTransactionInState')
        .mockReturnValue(false); // No initial authorization present

      // Execute the method
      await stripePaymentService.processStripeEvent(mockEvent);

      // Verify mocks were called
      expect(mockStripeEventConverter).toHaveBeenCalledWith(mockEvent);
      expect(updatePaymentMock).toHaveBeenCalledTimes(1);
      expect(hasTransactionInStateMock).toHaveBeenCalled();

      // Verify we don't call updatePayment a second time
      expect(updatePaymentMock.mock.calls[0][0]).toEqual(mockUpdateData);

      expect(Logger.log.info).toHaveBeenCalledWith('Payment information updated', expect.any(Object));
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
  });

  describe('method createOrder', () => {
    test('should create an order and update the payment intent and subscription metadata', async () => {
      const mockCreateOrder = jest.spyOn(OrderClient, 'createOrderFromCart').mockResolvedValue(orderMock);
      await stripePaymentService.createOrder({
        cart: mockGetCartResult(),
        paymentIntentId: 'paymentIntentId',
        subscriptionId: 'subscriptionId',
      });
      expect(mockCreateOrder).toHaveBeenCalled();
    });
  });

  describe('method processSubscriptionEvent', () => {
    test('should process subscription invoice.paid successfully updating the payment state', async () => {
      const mockEvent: Stripe.Event = mockEvent__invoice_paid__Expanded_Paymnet_intent__amount_paid;
      const mockedCart = mockGetCartResult();
      const spiedStripeInvoiceExpandedMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
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
        .spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentSubscription')
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
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
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
        .spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentSubscription')
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
        interactionId: mockedPaymentIntent.id,
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
      }
    });

    test('should process subscription invoice.paid successfully creating a update in the current payment', async () => {
      const mockEvent: Stripe.Event = mockEvent__invoice_paid__Expanded_Paymnet_intent__amount_paid;
      const mockedCart = mockGetCartResult();
      const spiedStripeInvoiceExpandedMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
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
        .spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentSubscription')
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
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
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
        .spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentSubscription')
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

  describe('updateCartAddress method', () => {
    test('should update cart address using shipping details when available', async () => {
      // Mock event with payment intent containing charge
      const mockEvent = {
        data: {
          object: {
            latest_charge: 'ch_123456',
          },
        },
      } as Stripe.Event;

      const mockCart = mockGetCartResult();

      // Mock shipping details in the Stripe charge
      const mockCharge = {
        billing_details: {
          name: 'John Doe Billing',
          address: {
            country: 'US',
            city: 'NYC',
            postal_code: '10001',
            state: 'NY',
            line1: '123 Billing St',
          },
        },
        shipping: {
          name: 'John Doe Shipping',
          address: {
            country: 'GB',
            city: 'London',
            postal_code: 'SW1A 1AA',
            state: 'Greater London',
            line1: '10 Downing Street',
          },
        },
      };

      // Mock the expected cart update actions
      const expectedActions = [
        {
          action: 'setShippingAddress',
          address: {
            key: 'John Doe Shipping',
            country: 'GB',
            city: 'London',
            postalCode: 'SW1A 1AA',
            state: 'Greater London',
            streetName: '10 Downing Street',
          },
        },
      ];

      // Mock Stripe API charge retrieval
      const stripeChargeRetrieveMock = jest.spyOn(Stripe.prototype.charges, 'retrieve').mockResolvedValue({
        ...mockCharge,
        lastResponse: {
          headers: {},
          requestId: 'req_mock',
          statusCode: 200,
          apiVersion: '2020-08-27',
        },
      } as Stripe.Response<Stripe.Charge>);

      // Mock updateCartById function
      const updateCartByIdMock = jest
        .spyOn(CartClient, 'updateCartById')
        .mockResolvedValue({ ...mockCart, shippingAddress: expectedActions[0].address });

      // Call the method
      const result = await stripePaymentService.updateCartAddress(mockEvent, mockCart);

      // Verify Stripe API was called correctly
      expect(stripeChargeRetrieveMock).toHaveBeenCalledWith('ch_123456');

      // Verify cart update was called with correct actions
      expect(updateCartByIdMock).toHaveBeenCalledWith(mockCart, expectedActions);

      // Verify returned cart
      expect(result).toEqual({ ...mockCart, shippingAddress: expectedActions[0].address });
    });

    test('should use billing details when shipping is not available', async () => {
      // Mock event with payment intent containing charge
      const mockEvent = {
        data: {
          object: {
            latest_charge: 'ch_123456',
          },
        },
      } as Stripe.Event;

      const mockCart = mockGetCartResult();

      // Mock charge with only billing details (no shipping)
      const mockCharge = {
        billing_details: {
          name: 'Jane Smith',
          address: {
            country: 'US',
            city: 'Chicago',
            postal_code: '60601',
            state: 'IL',
            line1: '456 Billing Ave',
          },
        },
        // No shipping property
      };

      // Mock the expected cart update actions using billing details
      const expectedActions = [
        {
          action: 'setShippingAddress',
          address: {
            key: 'Jane Smith',
            country: 'US',
            city: 'Chicago',
            postalCode: '60601',
            state: 'IL',
            streetName: '456 Billing Ave',
          },
        },
      ];

      const stripeChargeRetrieveMock = jest.spyOn(Stripe.prototype.charges, 'retrieve').mockResolvedValue({
        ...mockCharge,
        lastResponse: {
          headers: {},
          requestId: 'req_mock',
          statusCode: 200,
          apiVersion: '2020-08-27',
        },
      } as Stripe.Response<Stripe.Charge>);

      // Mock updateCartById function
      const updateCartByIdMock = jest
        .spyOn(CartClient, 'updateCartById')
        .mockResolvedValue({ ...mockCart, shippingAddress: expectedActions[0].address });

      // Call the method
      const result = await stripePaymentService.updateCartAddress(mockEvent, mockCart);

      // Verify Stripe API was called correctly
      expect(stripeChargeRetrieveMock).toHaveBeenCalledWith('ch_123456');

      // Verify cart update was called with correct actions
      expect(updateCartByIdMock).toHaveBeenCalledWith(mockCart, expectedActions);

      // Verify returned cart
      expect(result).toEqual({ ...mockCart, shippingAddress: expectedActions[0].address });
    });

    test('should use fallback values when address details are missing', async () => {
      // Mock event with payment intent containing charge
      const mockEvent = {
        data: {
          object: {
            latest_charge: 'ch_123456',
          },
        },
      } as Stripe.Event;

      const mockCart = mockGetCartResult();

      // Mock charge with minimal details
      const mockCharge = {
        billing_details: {
          // No name
          address: {
            // No details
          },
        },
        // No shipping property
      };

      // Mock the expected cart update actions using fallback values
      const expectedActions = [
        {
          action: 'setShippingAddress',
          address: {
            key: 'mockName',
            country: 'US',
            city: 'mockCity',
            postalCode: 'mockPostalCode',
            state: 'mockState',
            streetName: 'mockStreenName',
          },
        },
      ];

      const stripeChargeRetrieveMock = jest.spyOn(Stripe.prototype.charges, 'retrieve').mockResolvedValue({
        ...mockCharge,
        lastResponse: {
          headers: {},
          requestId: 'req_mock',
          statusCode: 200,
          apiVersion: '2020-08-27',
        },
      } as Stripe.Response<Stripe.Charge>);

      // Mock updateCartById function
      const updateCartByIdMock = jest
        .spyOn(CartClient, 'updateCartById')
        .mockResolvedValue({ ...mockCart, shippingAddress: expectedActions[0].address });

      // Call the method
      const result = await stripePaymentService.updateCartAddress(mockEvent, mockCart);

      // Verify Stripe API was called correctly
      expect(stripeChargeRetrieveMock).toHaveBeenCalledWith('ch_123456');

      // Verify cart update was called with correct actions
      expect(updateCartByIdMock).toHaveBeenCalledWith(mockCart, expectedActions);

      // Verify returned cart
      expect(result).toEqual({ ...mockCart, shippingAddress: expectedActions[0].address });
    });
  });
});
