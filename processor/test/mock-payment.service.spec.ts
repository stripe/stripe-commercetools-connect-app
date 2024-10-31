import { describe, test, expect, afterEach, jest, beforeEach } from '@jest/globals';
import { ConfigResponse, ModifyPayment, StatusResponse } from '../src/services/types/operation.type';
import { paymentSDK } from '../src/payment-sdk';
import { DefaultPaymentService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-payment.service';
import { DefaultCartService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-cart.service';
import { mockGetPaymentResult, mockUpdatePaymentResult } from './utils/mock-payment-results';
import { mockGetCartResult } from './utils/mock-cart-data';
import * as Config from '../src/config/config';
import { CreatePaymentRequest, MockPaymentServiceOptions } from '../src/services/types/mock-payment.type';
import { AbstractPaymentService } from '../src/services/abstract-payment.service';
import { MockPaymentService } from '../src/services/mock-payment.service';
import * as FastifyContext from '../src/libs/fastify/context/context';
import * as StatusHandler from '@commercetools/connect-payments-sdk/dist/api/handlers/status.handler';

import { HealthCheckResult } from '@commercetools/connect-payments-sdk';
import { PaymentMethodType, PaymentOutcome } from '../src/dtos/mock-payment.dto';
import { TransactionDraftDTO } from '../src/dtos/operations/transaction.dto';

interface FlexibleConfig {
  [key: string]: string; // Adjust the type according to your config values
}

function setupMockConfig(keysAndValues: Record<string, string>) {
  const mockConfig: FlexibleConfig = {};
  Object.keys(keysAndValues).forEach((key) => {
    mockConfig[key] = keysAndValues[key];
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jest.spyOn(Config, 'getConfig').mockReturnValue(mockConfig as any);
}

describe('mock-payment.service', () => {
  const opts: MockPaymentServiceOptions = {
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
  };
  const paymentService: AbstractPaymentService = new MockPaymentService(opts);
  const mockPaymentService: MockPaymentService = new MockPaymentService(opts);
  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getConfig', async () => {
    // Setup mock config for a system using `clientKey`
    setupMockConfig({ mockClientKey: '', mockEnvironment: 'test' });

    const result: ConfigResponse = await paymentService.config();

    // Assertions can remain the same or be adapted based on the abstracted access
    expect(result?.clientKey).toStrictEqual('');
    expect(result?.environment).toStrictEqual('test');
  });

  test('getSupportedPaymentComponents', async () => {
    const result: ConfigResponse = await paymentService.getSupportedPaymentComponents();
    expect(result?.components).toHaveLength(3);
    expect(result?.components[0]?.type).toStrictEqual('card');
    expect(result?.components[1]?.type).toStrictEqual('invoice');
    expect(result?.components[2]?.type).toStrictEqual('purchaseorder');
    expect(result?.dropins).toHaveLength(0);
  });

  test('getStatus', async () => {
    const mockHealthCheckFunction: () => Promise<HealthCheckResult> = async () => {
      const result: HealthCheckResult = {
        name: 'CoCo Permissions',
        status: 'DOWN',
        message: 'CoCo Permissions are not available',
        details: {},
      };
      return result;
    };

    jest.spyOn(StatusHandler, 'healthCheckCommercetoolsPermissions').mockReturnValue(mockHealthCheckFunction);
    const paymentService: AbstractPaymentService = new MockPaymentService(opts);
    const result: StatusResponse = await paymentService.status();

    expect(result?.status).toBeDefined();
    expect(result?.checks).toHaveLength(2);
    expect(result?.status).toStrictEqual('Partially Available');
    expect(result?.checks[0]?.name).toStrictEqual('CoCo Permissions');
    expect(result?.checks[0]?.status).toStrictEqual('DOWN');
    expect(result?.checks[0]?.details).toStrictEqual({});
    expect(result?.checks[0]?.message).toBeDefined();
    expect(result?.checks[1]?.name).toStrictEqual('Mock Payment API');
    expect(result?.checks[1]?.status).toStrictEqual('UP');
    expect(result?.checks[1]?.details).toBeDefined();
    expect(result?.checks[1]?.message).toBeDefined();
  });

  test('cancelPayment', async () => {
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
    jest
      .spyOn(DefaultPaymentService.prototype, 'updatePayment')
      .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));

    const result = await paymentService.modifyPayment(modifyPaymentOpts);
    expect(result?.outcome).toStrictEqual('approved');
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

  test('refundPayment', async () => {
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
    jest
      .spyOn(DefaultPaymentService.prototype, 'updatePayment')
      .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));

    const result = await paymentService.modifyPayment(modifyPaymentOpts);
    expect(result?.outcome).toStrictEqual('approved');
  });

  test('create card payment', async () => {
    const createPaymentOpts: CreatePaymentRequest = {
      data: {
        paymentMethod: {
          type: PaymentMethodType.CARD,
        },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
      },
    };
    jest.spyOn(DefaultCartService.prototype, 'getCart').mockReturnValue(Promise.resolve(mockGetCartResult()));
    jest.spyOn(DefaultPaymentService.prototype, 'createPayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));
    jest.spyOn(DefaultCartService.prototype, 'addPayment').mockReturnValue(Promise.resolve(mockGetCartResult()));
    jest.spyOn(FastifyContext, 'getProcessorUrlFromContext').mockReturnValue('http://127.0.0.1');
    jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));

    const result = await mockPaymentService.createPayment(createPaymentOpts);
    expect(result?.paymentReference).toStrictEqual('123456');
  });

  test('create invoice payment', async () => {
    const createPaymentOpts: CreatePaymentRequest = {
      data: {
        paymentMethod: {
          type: PaymentMethodType.INVOICE,
        },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
      },
    };
    jest.spyOn(DefaultCartService.prototype, 'getCart').mockReturnValue(Promise.resolve(mockGetCartResult()));
    jest.spyOn(DefaultPaymentService.prototype, 'createPayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));
    jest.spyOn(DefaultCartService.prototype, 'addPayment').mockReturnValue(Promise.resolve(mockGetCartResult()));
    jest.spyOn(FastifyContext, 'getProcessorUrlFromContext').mockReturnValue('http://127.0.0.1');
    jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));

    const result = await mockPaymentService.createPayment(createPaymentOpts);
    expect(result?.paymentReference).toStrictEqual('123456');
  });

  test('create purchaseorder payment successfully', async () => {
    const createPaymentOpts: CreatePaymentRequest = {
      data: {
        paymentMethod: {
          type: PaymentMethodType.PURCHASE_ORDER,
          poNumber: '123456',
          invoiceMemo: 'This is a test invoice',
        },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
      },
    };
    jest.spyOn(DefaultCartService.prototype, 'getCart').mockReturnValue(Promise.resolve(mockGetCartResult()));
    jest.spyOn(DefaultPaymentService.prototype, 'createPayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));
    jest.spyOn(DefaultCartService.prototype, 'addPayment').mockReturnValue(Promise.resolve(mockGetCartResult()));
    jest.spyOn(FastifyContext, 'getProcessorUrlFromContext').mockReturnValue('http://127.0.0.1');
    jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));

    const result = await mockPaymentService.createPayment(createPaymentOpts);
    expect(result?.paymentReference).toStrictEqual('123456');
  });

  test('create purchaseorder payment returns an error when PO number is not received', async () => {
    const createPaymentOpts: CreatePaymentRequest = {
      data: {
        paymentMethod: {
          type: PaymentMethodType.PURCHASE_ORDER,
        },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
      },
    };
    jest.spyOn(DefaultCartService.prototype, 'getCart').mockReturnValue(Promise.resolve(mockGetCartResult()));
    jest.spyOn(DefaultPaymentService.prototype, 'createPayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));
    jest.spyOn(DefaultCartService.prototype, 'addPayment').mockReturnValue(Promise.resolve(mockGetCartResult()));
    jest.spyOn(FastifyContext, 'getProcessorUrlFromContext').mockReturnValue('http://127.0.0.1');

    const resultPromise = mockPaymentService.createPayment(createPaymentOpts);

    await expect(resultPromise).rejects.toThrow('A value is required for field poNumber.');
  });

  describe('handleTransaction', () => {
    test('should create the payment in CoCo and return it with a success state', async () => {
      const createPaymentOpts: TransactionDraftDTO = {
        cartId: 'dd4b7669-698c-4175-8e4c-bed178abfed3',
        paymentInterface: '42251cfc-0660-4ab3-80f6-c32829aa7a8b',
        amount: {
          centAmount: 1000,
          currencyCode: 'EUR',
        },
      };

      jest.spyOn(DefaultCartService.prototype, 'getCart').mockReturnValueOnce(Promise.resolve(mockGetCartResult()));
      jest
        .spyOn(DefaultPaymentService.prototype, 'createPayment')
        .mockReturnValueOnce(Promise.resolve(mockGetPaymentResult));
      jest.spyOn(DefaultCartService.prototype, 'addPayment').mockReturnValueOnce(Promise.resolve(mockGetCartResult()));
      jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));

      const resultPromise = mockPaymentService.handleTransaction(createPaymentOpts);
      expect(resultPromise).resolves.toStrictEqual({
        transactionStatus: {
          errors: [],
          state: 'Pending',
        },
      });
    });

    test('should create the payment in CoCo and return it with a failed state', async () => {
      const createPaymentOpts: TransactionDraftDTO = {
        cartId: 'dd4b7669-698c-4175-8e4c-bed178abfed3',
        paymentInterface: '42251cfc-0660-4ab3-80f6-c32829aa7a8b',
        amount: {
          centAmount: 10000,
          currencyCode: 'EUR',
        },
      };

      jest.spyOn(DefaultCartService.prototype, 'getCart').mockReturnValueOnce(Promise.resolve(mockGetCartResult()));
      jest
        .spyOn(DefaultPaymentService.prototype, 'createPayment')
        .mockReturnValueOnce(Promise.resolve(mockGetPaymentResult));
      jest.spyOn(DefaultCartService.prototype, 'addPayment').mockReturnValueOnce(Promise.resolve(mockGetCartResult()));
      jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));

      const resultPromise = mockPaymentService.handleTransaction(createPaymentOpts);

      expect(resultPromise).resolves.toStrictEqual({
        transactionStatus: {
          errors: [
            {
              code: 'PaymentRejected',
              message: `Payment '${mockGetPaymentResult.id}' has been rejected.`,
            },
          ],
          state: 'Failed',
        },
      });
    });
  });
});
