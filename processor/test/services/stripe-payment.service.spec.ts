import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { ConfigResponse, ModifyPayment, StatusResponse } from '../../src/services/types/operation.type';
import { paymentSDK } from '../../src/payment-sdk';
import { DefaultPaymentService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-payment.service';
import { DefaultCartService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-cart.service';
import {
  mockGetPaymentAmount,
  mockGetPaymentResult,
  mockStripeCancelPaymentResult,
  mockStripeCreatePaymentResult,
  mockStripeCreateRefundResult,
  mockStripePaymentMethodsList,
  mockStripeRetrievePaymentResult,
  mockStripeUpdatePaymentResult,
  mockUpdatePaymentResult,
} from '../utils/mock-payment-results';
import {
  mockEvent__charge_refund_captured,
  mockEvent__charge_refund_notCaptured,
  mockEvent__paymentIntent_canceled,
  mockEvent__paymentIntent_succeeded_captureMethodManual,
  mockEvent__paymentIntent_succeeded_captureMethodAutomatic,
  mockEvent__charge_succeeded_notCaptured,
  mockEvent__charge_succeeded_captured,
} from '../utils/mock-routes-data';
import { mockGetCartResult } from '../utils/mock-cart-data';
import * as Config from '../../src/config/config';
import { StripePaymentServiceOptions } from '../../src/services/types/stripe-payment.type';
import { AbstractPaymentService } from '../../src/services/abstract-payment.service';
import { StripePaymentService } from '../../src/services/stripe-payment.service';
import * as StatusHandler from '@commercetools/connect-payments-sdk/dist/api/handlers/status.handler';
import { HealthCheckResult } from '@commercetools/connect-payments-sdk';
import * as Logger from '../../src/libs/logger/index';

import Stripe from 'stripe';
import * as StripeClient from '../../src/clients/stripe.client';
import { SupportedPaymentComponentsSchemaDTO } from '../../src/dtos/operations/payment-componets.dto';

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
    },
    refunds: {
      create: jest.fn<() => Promise<Stripe.Response<Stripe.Refund>>>().mockResolvedValue(mockStripeCreateRefundResult),
    },
    paymentMethods: {
      list: jest
        .fn<() => Promise<Stripe.ApiList<Stripe.PaymentMethod>>>()
        .mockResolvedValue(mockStripePaymentMethodsList),
    },
  })),
}));
jest.mock('../../src/libs/logger');

interface FlexibleConfig {
  [key: string]: string; // Adjust the type according to your config values
}

function setupMockConfig(keysAndValues: Record<string, string>) {
  const mockConfig: FlexibleConfig = {};
  Object.keys(keysAndValues).forEach((key) => {
    mockConfig[key] = keysAndValues[key];
  });

  jest.spyOn(Config, 'getConfig').mockReturnValue(mockConfig as any);
}

describe('stripe-payment.service', () => {
  const opts: StripePaymentServiceOptions = {
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
  };
  const paymentService: AbstractPaymentService = new StripePaymentService(opts);

  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getConfig', () => {
    test('should return the Stripe configuration successfully', async () => {
      // Setup mock config for a system using `clientKey`
      setupMockConfig({ stripeSecretKey: 'stripeSecretKey', mockEnvironment: 'TEST' });

      const result: ConfigResponse = await paymentService.config();

      // Assertions can remain the same or be adapted based on the abstracted access
      expect(result?.clientKey).toStrictEqual('stripeSecretKey');
      expect(result?.environment).toStrictEqual('TEST');
    });
  });

  describe('getSupportedPaymentComponents', () => {
    test('should return supported payment components successfully', async () => {
      const result: SupportedPaymentComponentsSchemaDTO = await paymentService.getSupportedPaymentComponents();
      expect(result?.components).toHaveLength(2);
      expect(result?.components[0]?.type).toStrictEqual('payment');
      expect(result?.components[1]?.type).toStrictEqual('expressCheckout');
    });
  });

  describe('getStatus', () => {
    test('should return Stripe status successfully', async () => {
      const mockHealthCheckFunction: () => Promise<HealthCheckResult> = async () => {
        const result: HealthCheckResult = {
          name: 'CoCo Permissions',
          status: 'DOWN',
          details: {},
        };
        return result;
      };
      Stripe.prototype.paymentMethods = {
        list: jest
          .fn<() => Promise<Stripe.ApiList<Stripe.PaymentMethod>>>()
          .mockResolvedValue(mockStripePaymentMethodsList),
      } as unknown as Stripe.PaymentMethodsResource;
      //    const spi = jest.spyOn(Stripe.prototype.paymentMethods, 'list');

      jest.spyOn(StatusHandler, 'healthCheckCommercetoolsPermissions').mockReturnValue(mockHealthCheckFunction);
      const paymentService: AbstractPaymentService = new StripePaymentService(opts);
      const result: StatusResponse = await paymentService.status();

      expect(result?.status).toBeDefined();
      expect(result?.checks).toHaveLength(2);
      expect(result?.status).toStrictEqual('Partially Available');
      expect(result?.checks[0]?.name).toStrictEqual('CoCo Permissions');
      expect(result?.checks[0]?.status).toStrictEqual('DOWN');
      expect(result?.checks[0]?.details).toStrictEqual({});
      expect(result?.checks[1]?.name).toStrictEqual('Stripe Status check');
      expect(result?.checks[1]?.status).toStrictEqual('UP');
      expect(result?.checks[1]?.details).toBeDefined();
    });
  });

  describe('cancelPayment', () => {
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

      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));
      // Set mocked functions to Stripe and spyOn it
      Stripe.prototype.paymentIntents = {
        cancel: jest.fn(),
      } as unknown as Stripe.PaymentIntentsResource;
      jest
        .spyOn(Stripe.prototype.paymentIntents, 'cancel')
        .mockReturnValue(Promise.resolve(mockStripeCancelPaymentResult));
      jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));

      const result = await paymentService.modifyPayment(modifyPaymentOpts);
      expect(result?.outcome).toStrictEqual('received');
    });

    test('should throw an error when Stripe service throws an error', async () => {
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

      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));
      // Set mocked functions to Stripe and spyOn it
      Stripe.prototype.paymentIntents = {
        cancel: jest.fn(),
      } as unknown as Stripe.PaymentIntentsResource;
      jest.spyOn(Stripe.prototype.paymentIntents, 'cancel').mockImplementation(() => {
        throw new Error('error');
      });
      jest.spyOn(StripeClient, 'wrapStripeError').mockReturnValue(new Error('Unexpected error calling Stripe API'));
      jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));

      expect(async () => {
        await paymentService.modifyPayment(modifyPaymentOpts);
      }).rejects.toThrow();
    });
  });

  describe('capturePayment', () => {
    test('should capture a payment successfully', async () => {
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

      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));
      jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));
      jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));

      const result = await paymentService.modifyPayment(modifyPaymentOpts);
      expect(result?.outcome).toStrictEqual('approved');
    });
  });

  describe('refundPayment', () => {
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

      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));
      jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));
      // Set mocked functions to Stripe and spyOn it
      Stripe.prototype.refunds = {
        create: jest.fn(),
      } as unknown as Stripe.RefundsResource;
      jest.spyOn(Stripe.prototype.refunds, 'create').mockReturnValue(Promise.resolve(mockStripeCreateRefundResult));
      jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));

      const result = await paymentService.modifyPayment(modifyPaymentOpts);
      expect(result?.outcome).toStrictEqual('received');
    });

    test('should throw an error when Stripe service throws an error', async () => {
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

      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));
      jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));
      // Set mocked functions to Stripe and spyOn it
      Stripe.prototype.refunds = {
        create: jest.fn(),
      } as unknown as Stripe.RefundsResource;
      jest.spyOn(Stripe.prototype.refunds, 'create').mockImplementation(() => {
        throw new Error('error');
      });
      jest.spyOn(StripeClient, 'wrapStripeError').mockReturnValue(new Error('Unexpected error calling Stripe API'));

      expect(async () => {
        await paymentService.modifyPayment(modifyPaymentOpts);
      }).rejects.toThrow();
    });
  });

  describe('authorizePaymentInCt', () => {
    test('should create a payment in ct and update the payment_intent metadata when the payment_intent has not been captured', async () => {
      Stripe.prototype.paymentIntents = {
        update: jest.fn(),
      } as unknown as Stripe.PaymentIntentsResource;

      const getCartMock = jest
        .spyOn(DefaultCartService.prototype, 'getCart')
        .mockReturnValue(Promise.resolve(mockGetCartResult()));
      const getPaymentAmountMock = jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockResolvedValue(mockGetPaymentAmount);
      const createCtPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'createPayment')
        .mockResolvedValue(mockGetPaymentResult);
      const addPaymentMock = jest
        .spyOn(DefaultCartService.prototype, 'addPayment')
        .mockResolvedValue(mockGetCartResult());
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const updatePaymentIntentMock = jest
        .spyOn(Stripe.prototype.paymentIntents, 'update')
        .mockReturnValue(Promise.resolve(mockStripeUpdatePaymentResult));
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockGetPaymentResult);

      const stripePaymentService: StripePaymentService = new StripePaymentService(opts);
      await stripePaymentService.authorizePaymentInCt(mockEvent__charge_succeeded_notCaptured);

      expect(getCartMock).toHaveBeenCalled();
      expect(getPaymentAmountMock).toHaveBeenCalled();
      expect(createCtPaymentMock).toHaveBeenCalled();
      expect(addPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalled();
      expect(updatePaymentIntentMock).toHaveBeenCalled();
    });

    test('should do nothing when the payment_intent has been captured', async () => {
      const stripePaymentService: StripePaymentService = new StripePaymentService(opts);
      await stripePaymentService.authorizePaymentInCt(mockEvent__charge_succeeded_captured);
    });

    test('should write a log when stripeApi().paymentIntents.update function throws an error', async () => {
      Stripe.prototype.paymentIntents = {
        update: jest.fn(),
      } as unknown as Stripe.PaymentIntentsResource;

      const getCartMock = jest
        .spyOn(DefaultCartService.prototype, 'getCart')
        .mockReturnValue(Promise.resolve(mockGetCartResult()));
      const getPaymentAmountMock = jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockResolvedValue(mockGetPaymentAmount);
      const createCtPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'createPayment')
        .mockResolvedValue(mockGetPaymentResult);
      const addPaymentMock = jest
        .spyOn(DefaultCartService.prototype, 'addPayment')
        .mockResolvedValue(mockGetCartResult());
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      jest.spyOn(Stripe.prototype.paymentIntents, 'update').mockImplementation(() => {
        throw new Error('error');
      });

      const stripePaymentService: StripePaymentService = new StripePaymentService(opts);
      await stripePaymentService.authorizePaymentInCt(mockEvent__charge_succeeded_notCaptured);

      expect(getCartMock).toHaveBeenCalled();
      expect(getPaymentAmountMock).toHaveBeenCalled();
      expect(createCtPaymentMock).toHaveBeenCalled();
      expect(addPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalled();
      expect(Stripe.prototype.paymentIntents.update).toThrowError();
      expect(Logger.log.error).toHaveBeenCalled();
    });
  });

  describe('createPaymentIntentStripe', () => {
    test('should createPaymentIntent successful', async () => {
      // mocking all the function calls
      Stripe.prototype.paymentIntents = {
        create: jest.fn(),
        update: jest.fn(),
      } as unknown as Stripe.PaymentIntentsResource;
      const getCartMock = jest
        .spyOn(DefaultCartService.prototype, 'getCart')
        .mockReturnValue(Promise.resolve(mockGetCartResult()));
      const getPaymentAmountMock = jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockResolvedValue(mockGetPaymentAmount);
      const stripeApiMock = jest
        .spyOn(Stripe.prototype.paymentIntents, 'create')
        .mockReturnValue(Promise.resolve(mockStripeCreatePaymentResult));
      const createPaymentMock = jest.spyOn(DefaultPaymentService.prototype, 'createPayment');
      createPaymentMock.mockResolvedValue(mockGetPaymentResult);
      const addPaymentMock = jest.spyOn(DefaultCartService.prototype, 'addPayment');
      addPaymentMock.mockResolvedValue(mockGetCartResult());

      const stripePaymentService: StripePaymentService = new StripePaymentService(opts);
      const result = await stripePaymentService.createPaymentIntentStripe();

      expect(result.sClientSecret).toStrictEqual(mockStripeCreatePaymentResult.client_secret);
      expect(result).toBeDefined();

      // Or check that the relevant mocks have been called
      expect(getCartMock).toHaveBeenCalled();
      expect(getPaymentAmountMock).toHaveBeenCalled();
      expect(stripeApiMock).toHaveBeenCalled();
    });

    test('should fail to create the payment intent', async () => {
      // mocking all the function calls
      Stripe.prototype.paymentIntents = {
        create: jest.fn(),
        update: jest.fn(),
      } as unknown as Stripe.PaymentIntentsResource;
      const getCartMock = jest
        .spyOn(DefaultCartService.prototype, 'getCart')
        .mockReturnValue(Promise.resolve(mockGetCartResult()));
      const getPaymentAmountMock = jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockResolvedValue(mockGetPaymentAmount);
      const stripeApiMock = jest.spyOn(Stripe.prototype.paymentIntents, 'create').mockImplementation(() => {
        throw new Error('error');
      });
      const createPaymentMock = jest.spyOn(DefaultPaymentService.prototype, 'createPayment');
      createPaymentMock.mockResolvedValue(mockGetPaymentResult);
      const addPaymentMock = jest.spyOn(DefaultCartService.prototype, 'addPayment');
      addPaymentMock.mockResolvedValue(mockGetCartResult());
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const stripeApiUpdateMock = jest
        .spyOn(Stripe.prototype.paymentIntents, 'update')
        .mockReturnValue(Promise.resolve(mockStripeUpdatePaymentResult));

      const wrapStripErrorMock = jest
        .spyOn(StripeClient, 'wrapStripeError')
        .mockReturnValue(new Error('Unexpected error calling Stripe API'));

      const wrapStripeError = jest
        .spyOn(StripeClient, 'wrapStripeError')
        .mockReturnValue(new Error('Unexpected error calling Stripe API'));

      const stripePaymentService: StripePaymentService = new StripePaymentService(opts);
      try {
        await stripePaymentService.createPaymentIntentStripe();
      } catch (e) {
        expect(wrapStripeError).toHaveBeenCalledWith(new Error('error'));
      }

      // Or check that the relevant mocks have been called
      expect(getCartMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(0);
      expect(getPaymentAmountMock).toHaveBeenCalled();
      expect(stripeApiMock).toHaveBeenCalled();
      expect(wrapStripErrorMock).toHaveBeenCalled();
      expect(createPaymentMock).toHaveBeenCalledTimes(0);
      expect(addPaymentMock).toHaveBeenCalledTimes(0);
      expect(stripeApiUpdateMock).toHaveBeenCalledTimes(0);
    });
  });

  describe('refundPaymentInCt', () => {
    test('should refund a payment in ct successfully when the charge has been captured', async () => {
      const thisPaymentService: StripePaymentService = new StripePaymentService(opts);

      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await thisPaymentService.refundPaymentInCt(mockEvent__charge_refund_captured);

      expect(DefaultPaymentService.prototype.updatePayment).toBeCalled();
    });

    test('should not refund a payment in ct when the charge has not been captured', async () => {
      const thisPaymentService: StripePaymentService = new StripePaymentService(opts);

      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await thisPaymentService.refundPaymentInCt(mockEvent__charge_refund_notCaptured);

      expect(DefaultPaymentService.prototype.updatePayment).toHaveBeenCalledTimes(0);
    });

    test('should write a log when stripe.paymentIntents.retrieve function throws an error', async () => {
      const thisPaymentService: StripePaymentService = new StripePaymentService(opts);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockImplementation(() => {
        throw new Error('error');
      });

      await thisPaymentService.refundPaymentInCt(mockEvent__charge_refund_captured);

      expect(Logger.log.error).toBeCalled();
    });

    test('should write a log when ctPaymentService.updatePayment function throws an error', async () => {
      const thisPaymentService: StripePaymentService = new StripePaymentService(opts);

      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockImplementation(() => {
        throw new Error('error');
      });

      await thisPaymentService.refundPaymentInCt(mockEvent__charge_refund_captured);

      expect(Logger.log.error).toBeCalled();
    });
  });

  describe('cancelAuthorizationInCt', () => {
    test('should cancel an authorized payment in ct successfully', async () => {
      const thisPaymentService: StripePaymentService = new StripePaymentService(opts);

      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await thisPaymentService.cancelAuthorizationInCt(mockEvent__paymentIntent_canceled);

      expect(DefaultPaymentService.prototype.updatePayment).toBeCalled();
    });

    test('should write a log when ctPaymentService.updatePayment function throws error', async () => {
      const thisPaymentService: StripePaymentService = new StripePaymentService(opts);

      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockImplementation(() => {
        throw new Error('error');
      });

      await thisPaymentService.cancelAuthorizationInCt(mockEvent__paymentIntent_canceled);

      expect(Logger.log.error).toBeCalled();
    });
  });

  describe('chargePaymentInCt', () => {
    test('should add a "Charge" transaction to ct payment when "capture_method"="manual" ', async () => {
      const thisPaymentService: StripePaymentService = new StripePaymentService(opts);

      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await thisPaymentService.chargePaymentInCt(mockEvent__paymentIntent_succeeded_captureMethodManual);

      expect(DefaultPaymentService.prototype.updatePayment).toBeCalled();
    });

    test('should write a log when ctPaymentService.updatePayment() function throws error', async () => {
      const thisPaymentService: StripePaymentService = new StripePaymentService(opts);

      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockImplementation(() => {
        throw new Error('error');
      });

      await thisPaymentService.chargePaymentInCt(mockEvent__paymentIntent_succeeded_captureMethodManual);

      expect(Logger.log.error).toBeCalled();
    });

    test('should execute createPaymentCt() function when "capture_method"="automatic"', async () => {
      Stripe.prototype.paymentIntents = {
        update: jest.fn(),
      } as unknown as Stripe.PaymentIntentsResource;

      const getCartMock = jest
        .spyOn(DefaultCartService.prototype, 'getCart')
        .mockReturnValue(Promise.resolve(mockGetCartResult()));
      const getPaymentAmountMock = jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockResolvedValue(mockGetPaymentAmount);
      const createCtPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'createPayment')
        .mockResolvedValue(mockGetPaymentResult);
      const addPaymentMock = jest
        .spyOn(DefaultCartService.prototype, 'addPayment')
        .mockResolvedValue(mockGetCartResult());
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const updatePaymentIntentMock = jest
        .spyOn(Stripe.prototype.paymentIntents, 'update')
        .mockReturnValue(Promise.resolve(mockStripeUpdatePaymentResult));
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockGetPaymentResult);

      const thisPaymentService: StripePaymentService = new StripePaymentService(opts);
      await thisPaymentService.chargePaymentInCt(mockEvent__paymentIntent_succeeded_captureMethodAutomatic);

      expect(getCartMock).toBeCalled();
      expect(getPaymentAmountMock).toBeCalled();
      expect(createCtPaymentMock).toBeCalled();
      expect(addPaymentMock).toBeCalled();
      expect(updatePaymentMock).toBeCalled();
      expect(updatePaymentIntentMock).toBeCalled();
    });
  });

  describe('getConfigElement', () => {
    test('should return the configuration element successfuly', async () => {
      // mocking all the function calls
      const getCartMock = jest
        .spyOn(DefaultCartService.prototype, 'getCart')
        .mockReturnValue(Promise.resolve(mockGetCartResult()));
      const getPaymentAmountMock = jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockResolvedValue(mockGetPaymentAmount);

      const stripePaymentService: StripePaymentService = new StripePaymentService(opts);
      const result = await stripePaymentService.getConfigElement('payment');

      expect(result.cartInfo.currency).toStrictEqual(mockGetPaymentAmount.currencyCode);
      expect(result.cartInfo.amount).toStrictEqual(mockGetPaymentAmount.centAmount);
      expect(result).toBeDefined();

      // Or check that the relevant mocks have been called
      expect(getCartMock).toHaveBeenCalled();
      expect(getPaymentAmountMock).toHaveBeenCalled();
      expect(Logger.log.info).toBeCalled();
    });
  });
});
