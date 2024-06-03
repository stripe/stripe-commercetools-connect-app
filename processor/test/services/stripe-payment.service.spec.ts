import { describe, test, expect, afterEach, jest, beforeEach } from '@jest/globals';
import { ConfigResponse, ModifyPayment, StatusResponse } from '../../src/services/types/operation.type';
import { paymentSDK } from '../../src/payment-sdk';
import { DefaultPaymentService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-payment.service';
import { DefaultCartService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-cart.service';
import {
  mockGetPaymentResult,
  mockUpdatePaymentResult,
  mockStripeCreateRefundResult,
  mockStripeCancelPaymentResult,
} from '../utils/mock-payment-results';
import { mockGetCartResult } from '../utils/mock-cart-data';
import * as Config from '../../src/config/config';
import { CreatePayment } from '../../src/services/types/mock-payment.type';
import { StripePaymentServiceOptions } from '../../src/services/types/stripe-payment.type';
import { AbstractPaymentService } from '../../src/services/abstract-payment.service';
import { StripePaymentService } from '../../src/services/stripe-payment.service';
import * as FastifyContext from '../../src/libs/fastify/context/context';
import * as StatusHandler from '@commercetools/connect-payments-sdk/dist/api/handlers/status.handler';

import { HealthCheckResult } from '@commercetools/connect-payments-sdk';
import { PaymentOutcome } from '../../src/dtos/mock-payment.dto';

import Stripe from 'stripe';
import * as StripeClient from '../../src/clients/stripe.client';

jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    paymentIntents: {
      cancel: jest.fn<() => Promise<Stripe.Response<Stripe.PaymentIntent>>>().mockResolvedValue(mockStripeCancelPaymentResult),
    },
    refunds: {
      create: jest.fn<() => Promise<Stripe.Response<Stripe.Refund>>>().mockResolvedValue(mockStripeCreateRefundResult),
    }
  }))
}));

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
    setupMockConfig({ stripeSecretKey: '', mockEnvironment: 'test' });

    const result: ConfigResponse = await paymentService.config();

    // Assertions can remain the same or be adapted based on the abstracted access
    expect(result?.clientKey).toStrictEqual('');
    expect(result?.environment).toStrictEqual('test');
  });

  test('getSupportedPaymentComponents', async () => {
    const result: ConfigResponse = await paymentService.getSupportedPaymentComponents();
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
    expect(result?.checks[1]?.name).toStrictEqual('Stripe Payment API');
    expect(result?.checks[1]?.status).toStrictEqual('UP');
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

    jest
      .spyOn(DefaultPaymentService.prototype, 'getPayment')
      .mockReturnValue(Promise.resolve(mockGetPaymentResult));
    // Set mocked functions to Stripe and spyOn it
    Stripe.prototype.paymentIntents = ({
      cancel: jest.fn(),
    } as unknown) as Stripe.PaymentIntentsResource;
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

    jest
      .spyOn(DefaultPaymentService.prototype, 'getPayment')
      .mockReturnValue(Promise.resolve(mockGetPaymentResult));
    // Set mocked functions to Stripe and spyOn it
    Stripe.prototype.paymentIntents = ({
      cancel: jest.fn(),
    } as unknown) as Stripe.PaymentIntentsResource;
    jest
      .spyOn(Stripe.prototype.paymentIntents, 'cancel')
      .mockImplementation(() => { throw new Error('error') });
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
    Stripe.prototype.refunds = ({
      create: jest.fn(),
    } as unknown) as Stripe.RefundsResource;
    jest
      .spyOn(Stripe.prototype.refunds, 'create')
      .mockReturnValue(Promise.resolve(mockStripeCreateRefundResult));
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
    Stripe.prototype.refunds = ({
      create: jest.fn(),
    } as unknown) as Stripe.RefundsResource;
    jest
      .spyOn(Stripe.prototype.refunds, 'create')
      .mockImplementation(() => { throw new Error('error') });
    jest.spyOn(StripeClient, 'wrapStripeError').mockReturnValue(new Error('Unexpected error calling Stripe API'));

    expect(async () => {
      await paymentService.modifyPayment(modifyPaymentOpts);
    }).rejects.toThrow();
  });

  /*test('create card payment', async () => {
    const createPaymentOpts: CreatePayment = {
      data: {
        paymentMethod: {
          type: 'card',
          cardNumber: '4111111111111111',
          expiryMonth: 12,
          expiryYear: 2046,
          cvc: 130,
          holderName: 'Christopher',
        },
      },
    };
    jest.spyOn(DefaultCartService.prototype, 'getCart').mockReturnValue(Promise.resolve(mockGetCartResult()));
    jest.spyOn(DefaultPaymentService.prototype, 'createPayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));
    jest.spyOn(DefaultCartService.prototype, 'addPayment').mockReturnValue(Promise.resolve(mockGetCartResult()));
    jest.spyOn(FastifyContext, 'getProcessorUrlFromContext').mockReturnValue('http://127.0.0.1');
    jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));

    const result = await StripePaymentService.createPayment(createPaymentOpts);
    expect(result?.outcome).toStrictEqual(PaymentOutcome.AUTHORIZED);
    expect(result?.paymentReference).toStrictEqual('123456');
  });

  test('create card payment with wrong number', async () => {
    const createPaymentOpts: CreatePayment = {
      data: {
        paymentMethod: {
          type: 'card',
          cardNumber: '4000400040004000',
          expiryMonth: 12,
          expiryYear: 2046,
          cvc: 130,
          holderName: 'Christopher',
        },
      },
    };
    jest.spyOn(DefaultCartService.prototype, 'getCart').mockReturnValue(Promise.resolve(mockGetCartResult()));
    jest.spyOn(DefaultPaymentService.prototype, 'createPayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));
    jest.spyOn(DefaultCartService.prototype, 'addPayment').mockReturnValue(Promise.resolve(mockGetCartResult()));
    jest.spyOn(FastifyContext, 'getProcessorUrlFromContext').mockReturnValue('http://127.0.0.1');
    jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));

    const result = await StripePaymentService.createPayment(createPaymentOpts);
    expect(result?.outcome).toStrictEqual(PaymentOutcome.REJECTED);
    expect(result?.paymentReference).toStrictEqual('123456');
  });*/
});