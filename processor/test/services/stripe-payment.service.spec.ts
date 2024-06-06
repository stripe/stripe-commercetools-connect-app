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
  mockStripeRetrievePaymentResult,
  mockStripeUpdatePaymentResult,
  mockUpdatePaymentResult,
} from '../utils/mock-payment-results';
import {
  mockEvent__charge_refund_captured,
  mockEvent__charge_refund_notCaptured,
  mockEvent__paymentIntent_amountCapturableUpdated,
  mockEvent__paymentIntent_canceled,
  mockEvent__paymentIntent_succeeded,
} from '../utils/mock-routes-data';
import { mockGetCartResult, mockGetCartWithPaymentResult } from '../utils/mock-cart-data';
import * as Config from '../../src/config/config';
import { CreatePayment, StripePaymentServiceOptions } from '../../src/services/types/stripe-payment.type';
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

  test('getConfig', async () => {
    // Setup mock config for a system using `clientKey`
    setupMockConfig({ stripeSecretKey: 'stripeSecretKey', mockEnvironment: 'TEST' });

    const result: ConfigResponse = await paymentService.config();

    // Assertions can remain the same or be adapted based on the abstracted access
    expect(result?.clientKey).toStrictEqual('stripeSecretKey');
    expect(result?.environment).toStrictEqual('TEST');
  });

  test('getSupportedPaymentComponents', async () => {
    const result: SupportedPaymentComponentsSchemaDTO = await paymentService.getSupportedPaymentComponents();
    expect(result?.components).toHaveLength(1);
    expect(result?.components[0]?.type).toStrictEqual('card');
  });

  test('getStatus', async () => {
    const mockHealthCheckFunction: () => Promise<HealthCheckResult> = async () => {
      const result: HealthCheckResult = {
        name: 'CoCo Permissions',
        status: 'DOWN',
        details: {},
      };
      return result;
    };

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
    expect(result?.checks[1]?.status).toStrictEqual('DOWN');
    expect(result?.checks[1]?.details).toBeDefined();
  });

  test('cancelPayment succeded', async () => {
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

  test('cancelPayment failed', async () => {
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

  test('capturePayment', async () => {
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

  test('refundPayment succeded', async () => {
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

  test('refundPayment failed', async () => {
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

  test('setAuthorizationSuccessPayment succeded', async () => {
    const thisPaymentService: StripePaymentService = new StripePaymentService(opts);
    jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockGetPaymentResult);
    jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));

    await thisPaymentService.setAuthorizationSuccessPayment(mockEvent__paymentIntent_amountCapturableUpdated);

    expect(DefaultPaymentService.prototype.getPayment).toBeCalled();
    expect(DefaultPaymentService.prototype.updatePayment).toBeCalled();
  });

  test('setAuthorizationSuccessPayment, getPayment function throws error', async () => {
    const thisPaymentService: StripePaymentService = new StripePaymentService(opts);
    jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockImplementation(() => {
      throw new Error('error');
    });

    await thisPaymentService.setAuthorizationSuccessPayment(mockEvent__paymentIntent_amountCapturableUpdated);

    expect(Logger.log.error).toBeCalled();
  });

  test('setAuthorizationSuccessPayment, ctPaymentService.updatePayment function throws error', async () => {
    const thisPaymentService: StripePaymentService = new StripePaymentService(opts);
    jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockGetPaymentResult);
    jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockImplementation(() => {
      throw new Error('error');
    });

    await thisPaymentService.setAuthorizationSuccessPayment(mockEvent__paymentIntent_amountCapturableUpdated);

    expect(Logger.log.error).toBeCalled();
  });

  test('createPayment succeded', async () => {
    //Give opts
    const createPaymentOpts: CreatePayment = {
      data: {
        paymentMethod: {
          type: 'card',
          confirmationToken: 'confiramtionToken',
        },
      },
    };
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
    addPaymentMock.mockResolvedValue(mockGetCartWithPaymentResult());
    const updatePaymentMock = jest
      .spyOn(DefaultPaymentService.prototype, 'updatePayment')
      .mockReturnValue(Promise.resolve(mockGetPaymentResult));
    const stripeApiUpdateMock = jest
      .spyOn(Stripe.prototype.paymentIntents, 'update')
      .mockReturnValue(Promise.resolve(mockStripeUpdatePaymentResult));

    const stripePaymentService: StripePaymentService = new StripePaymentService(opts);
    const result = await stripePaymentService.createPayment(createPaymentOpts);

    expect(result.outcome).toStrictEqual('Initial');
    expect(result).toBeDefined();

    // Or check that the relevant mocks have been called
    expect(getCartMock).toHaveBeenCalled();
    expect(updatePaymentMock).toHaveBeenCalled();
    expect(getPaymentAmountMock).toHaveBeenCalled();
    expect(stripeApiMock).toHaveBeenCalled();
    expect(createPaymentMock).toHaveBeenCalled();
    expect(addPaymentMock).toHaveBeenCalled();
    expect(stripeApiUpdateMock).toHaveBeenCalled();
  });

  test('createPayment fail, on creating PaymentIntent', async () => {
    //Give opts
    const createPaymentOpts: CreatePayment = {
      data: {
        paymentMethod: {
          type: 'card',
          confirmationToken: 'confiramtionToken',
        },
      },
    };
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
    addPaymentMock.mockResolvedValue(mockGetCartWithPaymentResult());
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
      await stripePaymentService.createPayment(createPaymentOpts);
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

  test('createPayment fail, on updating PaymentIntent', async () => {
    //Give opts
    const createPaymentOpts: CreatePayment = {
      data: {
        paymentMethod: {
          type: 'card',
          confirmationToken: 'confiramtionToken',
        },
      },
    };
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
    addPaymentMock.mockResolvedValue(mockGetCartWithPaymentResult());
    const updatePaymentMock = jest
      .spyOn(DefaultPaymentService.prototype, 'updatePayment')
      .mockReturnValue(Promise.resolve(mockGetPaymentResult));
    const stripeApiUpdateMock = jest.spyOn(Stripe.prototype.paymentIntents, 'update').mockImplementation(() => {
      throw new Error('error');
    });

    const wrapStripeError = jest
      .spyOn(StripeClient, 'wrapStripeError')
      .mockReturnValue(new Error('Unexpected error calling Stripe API'));

    const stripePaymentService: StripePaymentService = new StripePaymentService(opts);
    try {
      await stripePaymentService.createPayment(createPaymentOpts);
    } catch (e) {
      expect(wrapStripeError).toHaveBeenCalledWith(new Error('error'));
    }

    // Or check that the relevant mocks have been called
    expect(getCartMock).toHaveBeenCalled();
    expect(updatePaymentMock).toHaveBeenCalled();
    expect(getPaymentAmountMock).toHaveBeenCalled();
    expect(stripeApiMock).toHaveBeenCalled();
    expect(createPaymentMock).toHaveBeenCalled();
    expect(addPaymentMock).toHaveBeenCalled();
    expect(stripeApiUpdateMock).toHaveBeenCalled();
  });

  test('refundPaymentInCt succeded', async () => {
    const thisPaymentService: StripePaymentService = new StripePaymentService(opts);

    Stripe.prototype.paymentIntents = {
      retrieve: jest.fn(),
    } as unknown as Stripe.PaymentIntentsResource;
    jest.spyOn(Stripe.prototype.paymentIntents, 'retrieve').mockReturnValue(Promise.resolve(mockStripeRetrievePaymentResult));
    jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));

    await thisPaymentService.refundPaymentInCt(mockEvent__charge_refund_captured);

    expect(Stripe.prototype.paymentIntents.retrieve).toBeCalled();
    expect(DefaultPaymentService.prototype.updatePayment).toBeCalled();
  });

  test('refundPaymentInCt, charge is not captured therefore the payment will not be updated in ct', async () => {
    const thisPaymentService: StripePaymentService = new StripePaymentService(opts);

    Stripe.prototype.paymentIntents = {
      retrieve: jest.fn(),
    } as unknown as Stripe.PaymentIntentsResource;
    jest.spyOn(Stripe.prototype.paymentIntents, 'retrieve').mockReturnValue(Promise.resolve(mockStripeRetrievePaymentResult));
    jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));

    await thisPaymentService.refundPaymentInCt(mockEvent__charge_refund_notCaptured);

    expect(Stripe.prototype.paymentIntents.retrieve).toBeCalled();
    expect(DefaultPaymentService.prototype.updatePayment).toHaveBeenCalledTimes(0);
  });

  test('refundPaymentInCt, stripe.paymentIntents.retrieve function throws error', async () => {
    const thisPaymentService: StripePaymentService = new StripePaymentService(opts);
    jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockImplementation(() => {
      throw new Error('error');
    });

    await thisPaymentService.refundPaymentInCt(mockEvent__charge_refund_captured);

    expect(Logger.log.error).toBeCalled();
  });

  test('refundPaymentInCt, ctPaymentService.updatePayment function throws error', async () => {
    const thisPaymentService: StripePaymentService = new StripePaymentService(opts);

    Stripe.prototype.paymentIntents = {
      retrieve: jest.fn(),
    } as unknown as Stripe.PaymentIntentsResource;
    jest.spyOn(Stripe.prototype.paymentIntents, 'retrieve').mockReturnValue(Promise.resolve(mockStripeRetrievePaymentResult));
    jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockImplementation(() => {
      throw new Error('error');
    });

    await thisPaymentService.refundPaymentInCt(mockEvent__charge_refund_captured);

    expect(Stripe.prototype.paymentIntents.retrieve).toBeCalled();
    expect(Logger.log.error).toBeCalled();
  });

  test('cancelAuthorizationInCt succeded', async () => {
    const thisPaymentService: StripePaymentService = new StripePaymentService(opts);

    jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));

    await thisPaymentService.cancelAuthorizationInCt(mockEvent__paymentIntent_canceled);

    expect(DefaultPaymentService.prototype.updatePayment).toBeCalled();
  });

  test('cancelAuthorizationInCt, ctPaymentService.updatePayment function throws error', async () => {
    const thisPaymentService: StripePaymentService = new StripePaymentService(opts);

    jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockImplementation(() => {
      throw new Error('error');
    });

    await thisPaymentService.cancelAuthorizationInCt(mockEvent__paymentIntent_canceled);

    expect(Logger.log.error).toBeCalled();
  });

  test('chargePaymentInCt succeded', async () => {
    const thisPaymentService: StripePaymentService = new StripePaymentService(opts);

    jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));

    await thisPaymentService.chargePaymentInCt(mockEvent__paymentIntent_succeeded);

    expect(DefaultPaymentService.prototype.updatePayment).toBeCalled();
  });

  test('chargePaymentInCt, ctPaymentService.updatePayment function throws error', async () => {
    const thisPaymentService: StripePaymentService = new StripePaymentService(opts);

    jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockImplementation(() => {
      throw new Error('error');
    });

    await thisPaymentService.chargePaymentInCt(mockEvent__paymentIntent_succeeded);

    expect(Logger.log.error).toBeCalled();
  });
});
