import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import * as StatusHandler from '@commercetools/connect-payments-sdk/dist/api/handlers/status.handler';
import { DefaultPaymentService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-payment.service';
import { DefaultCartService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-cart.service';
import { HealthCheckResult } from '@commercetools/connect-payments-sdk';
import { Cart, Customer } from '@commercetools/platform-sdk';
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
  mockEvent__charge_succeeded__with_invoice,
} from '../utils/mock-subscription-data';
import {
  mockEvent__charge_succeeded_notCaptured,
  mockEvent__paymentIntent_succeeded_captureMethodManual,
} from '../utils/mock-routes-data';
import {
  mockGetCartResult,
  mockGetCartWithBillingCountryOnly,
  mockGetCartWithCountry,
  mockGetCartWithShippingCountryOnly,
  mockGetCartWithStoreKey,
  orderMock,
} from '../utils/mock-cart-data';
import { PaymentStatus, StripePaymentServiceOptions } from '../../src/services/types/stripe-payment.type';
import { AbstractPaymentService } from '../../src/services/abstract-payment.service';
import { StripePaymentService } from '../../src/services/stripe-payment.service';
import { SupportedPaymentComponentsSchemaDTO } from '../../src/dtos/operations/payment-componets.dto';
import { StripeEventConverter } from '../../src/services/converters/stripeEventConverter';
import { PaymentModificationStatus, PaymentTransactions } from '../../src/dtos/operations/payment-intents.dto';
import * as Config from '../../src/config/config';
import * as Logger from '../../src/libs/logger/index';
import { CtPaymentCreationService } from '../../src/services/ct-payment-creation.service';
import { StripeSubscriptionService } from '../../src/services/stripe-subscription.service';
import * as CartClient from '../../src/services/commerce-tools/cart-client';
import * as OrderClient from '../../src/services/commerce-tools/order-client';
import { StripeCustomerService } from '../../src/services/stripe-customer.service';
import { mockCtCustomerData, mockCtCustomerId, mockStripeCustomerId } from '../utils/mock-customer-data';
import * as StripeClient from '../../src/clients/stripe.client';
import { CT_CUSTOM_FIELD_TAX_CALCULATIONS } from '../../src/constants';

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
  [key: string]: string | number | boolean | Config.PaymentFeatures;
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
  const subscriptionService: StripeSubscriptionService = new StripeSubscriptionService(opts);

  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
    Stripe.prototype.paymentIntents = {
      create: jest.fn(),
      update: jest.fn(),
      cancel: jest.fn(),
      capture: jest.fn(),
      retrieve: jest.fn(),
    } as unknown as Stripe.PaymentIntentsResource;
    Stripe.prototype.refunds = {
      create: jest.fn(),
      list: jest.fn(),
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
      expect(updatePaymentMock).toHaveBeenCalledTimes(0);
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
      expect(updatePaymentMock).toHaveBeenCalledTimes(0);
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
      const stripeRetrieveMock = jest
        .spyOn(Stripe.prototype.paymentIntents, 'retrieve')
        .mockReturnValue(Promise.resolve({ ...mockStripeCapturePaymentResult, amount_received: 0 }));
      const stripeApiMock = jest
        .spyOn(Stripe.prototype.paymentIntents, 'capture')
        .mockReturnValue(Promise.resolve(mockStripeCapturePaymentResult));

      const result = await paymentService.modifyPayment(modifyPaymentOpts);
      expect(result?.outcome).toStrictEqual('approved');
      expect(getPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(0);
      expect(stripeRetrieveMock).toHaveBeenCalled();
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
      const stripeRetrieveMock = jest
        .spyOn(Stripe.prototype.paymentIntents, 'retrieve')
        .mockReturnValue(Promise.resolve({ ...mockStripeCapturePaymentResult, amount_received: 0 }));
      const stripeApiMock = jest
        .spyOn(Stripe.prototype.paymentIntents, 'capture')
        .mockReturnValue(Promise.resolve({ ...mockStripeCapturePaymentResult, status: 'requires_capture' }));

      const result = await paymentService.modifyPayment(modifyPaymentOpts);
      expect(result?.outcome).toStrictEqual('approved');
      expect(getPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(0);
      expect(stripeRetrieveMock).toHaveBeenCalled();
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
      const stripeRetrieveMock = jest.spyOn(Stripe.prototype.paymentIntents, 'retrieve').mockImplementation(() => {
        throw new Error('Unexpected error calling Stripe API');
      });

      const result = await paymentService.modifyPayment(modifyPaymentOpts);
      expect(result?.outcome).toStrictEqual('rejected');
      expect(getPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(0);
      expect(stripeRetrieveMock).toHaveBeenCalled();
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
      expect(updatePaymentMock).toHaveBeenCalledTimes(0);
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
      expect(updatePaymentMock).toHaveBeenCalledTimes(0);
      expect(stripeApiMock).toHaveBeenCalled();
      expect(mockHasTransactionInState).toHaveBeenCalledTimes(4);
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
      expect(mockHasTransactionInState).toHaveBeenCalledTimes(4);
    });
  });

  describe('method updatePaymentIntentStripeSuccessful', () => {
    const matchingPayment = { ...mockGetPaymentResult, interfaceId: 'paymentId' };

    // Build a retrieved PaymentIntent whose amount/currency match the CT payment's amountPlanned
    // (GBP / 120000) so amount/currency validation passes unless a test overrides it.
    const mockRetrievedPI = (overrides: Partial<Stripe.PaymentIntent>) =>
      Promise.resolve({
        ...mockStripeRetrievePaymentResult,
        status: 'succeeded',
        amount: matchingPayment.amountPlanned.centAmount,
        currency: matchingPayment.amountPlanned.currencyCode.toLowerCase(),
        ...overrides,
      } as Stripe.Response<Stripe.PaymentIntent>);

    // getPaymentAmount is stubbed to the SAME figure as the payment's amountPlanned so the existing
    // cases keep passing. That equality is the normal state, not a shortcut: the gate now compares
    // Stripe against the CART'S CURRENT total rather than the payment snapshot, and the two only
    // diverge when the cart was edited after the PaymentIntent was created. The divergence case has
    // its own test below.
    // The cart's OWN total is what the gate compares against — not getPaymentAmount, which validates
    // payability and throws once the cart is paid, and not the payment's amountPlanned snapshot.
    // Defaulting it to the payment's amount keeps the existing cases passing; that equality is the
    // normal state and only breaks when the cart was edited after the PaymentIntent was created,
    // which has its own test below.
    const stubCartAndPayment = (cartAmount = matchingPayment.amountPlanned) => {
      jest
        .spyOn(DefaultCartService.prototype, 'getCart')
        .mockResolvedValue({ ...mockGetCartResult(), totalPrice: cartAmount, taxedPrice: undefined } as Cart);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockReturnValue(Promise.resolve(matchingPayment));
      jest.spyOn(CartClient, 'freezeCart').mockResolvedValue(mockGetCartResult());
    };

    test('should write Authorization/Success and return APPROVED when the PaymentIntent succeeded', async () => {
      stubCartAndPayment();
      const retrieveMock = jest
        .spyOn(Stripe.prototype.paymentIntents, 'retrieve')
        .mockReturnValue(mockRetrievedPI({ status: 'succeeded' }));
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      const result = await stripePaymentService.updatePaymentIntentStripeSuccessful('paymentId', 'paymentReference');

      expect(result).toBe(PaymentModificationStatus.APPROVED);
      expect(retrieveMock).toHaveBeenCalledWith('paymentId');
      expect(updatePaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: expect.objectContaining({ type: PaymentTransactions.AUTHORIZATION }),
        }),
      );
    });

    test('should return APPROVED when the PaymentIntent is requires_capture (manual capture)', async () => {
      stubCartAndPayment();
      jest
        .spyOn(Stripe.prototype.paymentIntents, 'retrieve')
        .mockReturnValue(mockRetrievedPI({ status: 'requires_capture' }));
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      const result = await stripePaymentService.updatePaymentIntentStripeSuccessful('paymentId', 'paymentReference');

      expect(result).toBe(PaymentModificationStatus.APPROVED);
      expect(updatePaymentMock).toHaveBeenCalled();
    });

    test('should write Authorization/Pending and return PENDING when the PaymentIntent is processing (async settlement)', async () => {
      stubCartAndPayment();
      jest
        .spyOn(Stripe.prototype.paymentIntents, 'retrieve')
        .mockReturnValue(mockRetrievedPI({ status: 'processing' }));
      const hasTxnMock = jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      const result = await stripePaymentService.updatePaymentIntentStripeSuccessful('paymentId', 'paymentReference');

      expect(result).toBe(PaymentModificationStatus.PENDING);
      expect(hasTxnMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: expect.objectContaining({
            type: PaymentTransactions.AUTHORIZATION,
            state: PaymentStatus.PENDING,
          }),
        }),
      );
    });

    test('should NOT write a duplicate when processing but a Pending/Charge-Success transaction already exists', async () => {
      stubCartAndPayment();
      jest
        .spyOn(Stripe.prototype.paymentIntents, 'retrieve')
        .mockReturnValue(mockRetrievedPI({ status: 'processing' }));
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(true);
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      const result = await stripePaymentService.updatePaymentIntentStripeSuccessful('paymentId', 'paymentReference');

      expect(result).toBe(PaymentModificationStatus.PENDING);
      expect(updatePaymentMock).not.toHaveBeenCalled();
    });

    test('should throw and not write when the PaymentIntent status is not allowed', async () => {
      stubCartAndPayment();
      jest
        .spyOn(Stripe.prototype.paymentIntents, 'retrieve')
        .mockReturnValue(mockRetrievedPI({ status: 'requires_payment_method' }));
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await expect(
        stripePaymentService.updatePaymentIntentStripeSuccessful('paymentId', 'paymentReference'),
      ).rejects.toThrow(/status "requires_payment_method" is not allowed/);
      expect(updatePaymentMock).not.toHaveBeenCalled();
    });

    test('should throw on amount mismatch between Stripe and the CT payment', async () => {
      stubCartAndPayment();
      jest
        .spyOn(Stripe.prototype.paymentIntents, 'retrieve')
        .mockReturnValue(mockRetrievedPI({ status: 'succeeded', amount: 999 }));
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await expect(
        stripePaymentService.updatePaymentIntentStripeSuccessful('paymentId', 'paymentReference'),
      ).rejects.toThrow(/amount\/currency mismatch/);
      expect(updatePaymentMock).not.toHaveBeenCalled();
    });

    test('should throw on currency mismatch between Stripe and the CT payment', async () => {
      stubCartAndPayment();
      jest
        .spyOn(Stripe.prototype.paymentIntents, 'retrieve')
        .mockReturnValue(mockRetrievedPI({ status: 'succeeded', currency: 'usd' }));

      await expect(
        stripePaymentService.updatePaymentIntentStripeSuccessful('paymentId', 'paymentReference'),
      ).rejects.toThrow(/amount\/currency mismatch/);
    });

    test('should fail closed (throw) when retrieving the PaymentIntent from Stripe fails', async () => {
      stubCartAndPayment();
      const retrieveMock = jest.spyOn(Stripe.prototype.paymentIntents, 'retrieve').mockImplementation(() => {
        throw new Error('Stripe unavailable');
      });
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await expect(
        stripePaymentService.updatePaymentIntentStripeSuccessful('paymentId', 'paymentReference'),
      ).rejects.toThrow(/could not retrieve from Stripe/);
      expect(retrieveMock).toHaveBeenCalled();
      expect(updatePaymentMock).not.toHaveBeenCalled();
    });

    test('should reject before calling Stripe when paymentIntentId does not match CT payment interfaceId', async () => {
      jest.spyOn(DefaultCartService.prototype, 'getCart').mockReturnValue(Promise.resolve(mockGetCartResult()));
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const retrieveMock = jest.spyOn(Stripe.prototype.paymentIntents, 'retrieve');
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await expect(
        stripePaymentService.updatePaymentIntentStripeSuccessful('paymentId', 'paymentReference'),
      ).rejects.toThrow(/PaymentIntent mismatch/);

      expect(retrieveMock).not.toHaveBeenCalled();
      expect(updatePaymentMock).not.toHaveBeenCalled();
      expect(Logger.log.error).toHaveBeenCalledWith(
        'PaymentIntent ID does not match CT Payment interfaceId — rejecting update to avoid wrong PI to wrong CT payment.',
        expect.objectContaining({
          paymentReference: 'paymentReference',
          requestPaymentIntentId: 'paymentId',
          ctPaymentInterfaceId: mockGetPaymentResult.interfaceId,
        }),
      );
    });

    test('should propagate errors from cart retrieval', async () => {
      const getCartMock = jest.spyOn(DefaultCartService.prototype, 'getCart').mockImplementation(() => {
        throw new Error('Cart retrieval failed');
      });

      await expect(
        stripePaymentService.updatePaymentIntentStripeSuccessful('paymentId', 'paymentReference'),
      ).rejects.toThrow('Cart retrieval failed');
      expect(getCartMock).toHaveBeenCalled();
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

  /**
   * RELEASE GATE for the bank transfer feature (SB3-207).
   *
   * These tests pin the exact PaymentIntent create params produced when no bank transfer is
   * involved. Card, crypto, Boleto, Cash App and subscription flows all go through this same
   * call, so any unintended drift here is a regression in every existing payment method.
   *
   * Two assertions per case, deliberately:
   *   1. the exact KEY SET, via Object.keys — because toHaveBeenCalledWith/toEqual treat a key
   *      whose value is undefined as equal to an absent key. Without this, dropping
   *      `setup_future_usage: undefined` would pass silently.
   *   2. the VALUES, via toEqual.
   */
  describe('createPaymentIntent — PaymentIntent params (release gate)', () => {
    type CreateParams = Stripe.PaymentIntentCreateParams;

    const BASE_KEYS = [
      'amount',
      'automatic_payment_methods',
      'capture_method',
      'currency',
      'customer',
      'metadata',
      'payment_method_options',
      'setup_future_usage',
    ].sort();

    // stripePaymentFlow is 'deferred', not omitted: in production the config IIFE always resolves to
    // 'deferred' when STRIPE_PAYMENT_FLOW is unset, never to undefined. Omitting it would run these
    // pins with flowType === undefined — a state the applyPiFirstOverride signature declares
    // impossible, reachable only through the cast below — leaving them correct by accident. Adding it
    // must not change a single assertion; if one moves, 'deferred' and undefined are not equivalent
    // and that is a finding, not a test detail.
    const mockConfig = (overrides: Partial<ReturnType<typeof Config.getConfig>> = {}) => {
      jest.spyOn(Config, 'getConfig').mockReturnValue({
        projectKey: 'test-project',
        stripeCaptureMethod: 'automatic',
        stripePaymentFlow: 'deferred',
        ...overrides,
      } as ReturnType<typeof Config.getConfig>);
    };

    const arrangeCreatePaymentIntent = (cart = mockGetCartResult()) => {
      jest.spyOn(DefaultCartService.prototype, 'getCart').mockResolvedValue(cart);
      jest.spyOn(StripeCustomerService.prototype, 'getCtCustomer').mockResolvedValue(mockCtCustomerData);
      jest.spyOn(DefaultCartService.prototype, 'getPaymentAmount').mockResolvedValue(mockGetPaymentAmount);
      jest
        .spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation')
        .mockResolvedValue(mockGetPaymentResult.id);
      return jest.spyOn(Stripe.prototype.paymentIntents, 'create').mockResolvedValue(mockStripeCreatePaymentResult);
    };

    const capturedParams = (createMock: ReturnType<typeof arrangeCreatePaymentIntent>): CreateParams =>
      createMock.mock.calls[0][0] as CreateParams;

    test('pins the default params — no behavior rules, no bank transfer', async () => {
      mockConfig();
      const createMock = arrangeCreatePaymentIntent();

      await stripePaymentService.createPaymentIntent();

      const params = capturedParams(createMock);
      expect(Object.keys(params).sort()).toEqual(BASE_KEYS);
      expect(params).toEqual({
        customer: mockStripeCustomerId,
        setup_future_usage: undefined,
        amount: 150000,
        currency: 'USD',
        automatic_payment_methods: { enabled: true },
        capture_method: 'automatic',
        metadata: {
          cart_id: expect.any(String),
          ct_project_key: 'test-project',
          ct_customer_id: mockCtCustomerId,
        },
        payment_method_options: { card: {} },
      });
      expect(createMock).toHaveBeenCalledWith(expect.anything(), { idempotencyKey: expect.any(String) });
    });

    test('pins that setup_future_usage stays PRESENT with an undefined value when a Stripe customer exists', async () => {
      // Composable keeps `setup_future_usage` in the object even when the value is undefined,
      // because it lives inside the `stripeCustomerId &&` spread rather than its own guard.
      // checkout guards it separately. Aligning the two is a deliberate non-goal of this change:
      // this assertion fails if anyone "tidies" composable into checkout's shape.
      mockConfig();
      const createMock = arrangeCreatePaymentIntent();

      await stripePaymentService.createPaymentIntent();

      const params = capturedParams(createMock);
      expect(Object.keys(params)).toContain('setup_future_usage');
      expect(params.setup_future_usage).toBeUndefined();
    });

    test('pins that setup_future_usage carries the global saved-payment-method value', async () => {
      mockConfig({ stripeSavedPaymentMethodConfig: { payment_method_save_usage: 'off_session' } });
      const createMock = arrangeCreatePaymentIntent();

      await stripePaymentService.createPaymentIntent();

      expect(capturedParams(createMock).setup_future_usage).toBe('off_session');
    });

    test('pins that no customer means neither customer nor setup_future_usage is sent', async () => {
      mockConfig();
      const createMock = arrangeCreatePaymentIntent();
      jest.spyOn(StripeCustomerService.prototype, 'getCtCustomer').mockResolvedValue(undefined);

      await stripePaymentService.createPaymentIntent();

      const params = capturedParams(createMock);
      expect(Object.keys(params).sort()).toEqual(
        BASE_KEYS.filter((k) => k !== 'customer' && k !== 'setup_future_usage'),
      );
    });

    test('pins the multicapture default inside payment_method_options', async () => {
      mockConfig({ stripeEnableMultiOperations: true });
      const createMock = arrangeCreatePaymentIntent();

      await stripePaymentService.createPaymentIntent();

      expect(capturedParams(createMock).payment_method_options).toEqual({
        card: { request_multicapture: 'if_available' },
      });
    });

    test('pins that a single tax calculation adds hooks and nothing else', async () => {
      mockConfig();
      const cart = mockGetCartResult();
      cart.custom = {
        type: { typeId: 'type', id: 'tax-type' },
        fields: { [CT_CUSTOM_FIELD_TAX_CALCULATIONS]: ['taxcalc_123'] },
      };
      const createMock = arrangeCreatePaymentIntent(cart);

      await stripePaymentService.createPaymentIntent();

      const params = capturedParams(createMock);
      expect(Object.keys(params).sort()).toEqual([...BASE_KEYS, 'hooks'].sort());
      expect(params.hooks).toEqual({ inputs: { tax: { calculation: 'taxcalc_123' } } });
    });

    test('pins that frontend payment method options win over backend defaults', async () => {
      mockConfig({ stripeEnableMultiOperations: true });
      const createMock = arrangeCreatePaymentIntent();

      await stripePaymentService.createPaymentIntent({
        paymentMethodOptions: { card: { request_multicapture: 'never' } },
      });

      expect(capturedParams(createMock).payment_method_options).toEqual({
        card: { request_multicapture: 'never' },
      });
    });
  });

  describe('createPaymentIntent — per-cart behavior rules', () => {
    const mockConfigWithRules = (
      rules: Record<string, Record<string, unknown>> | undefined,
      overrides: Partial<ReturnType<typeof Config.getConfig>> = {},
    ) => {
      jest.spyOn(Config, 'getConfig').mockReturnValue({
        projectKey: 'test-project',
        stripeCaptureMethod: 'automatic',
        // Same reasoning as mockConfig above: the production default is 'deferred', never undefined.
        // Cases that need the global pi_first pass it through `overrides`.
        stripePaymentFlow: 'deferred',
        stripePaymentBehaviorRules: rules,
        ...overrides,
      } as ReturnType<typeof Config.getConfig>);
    };

    const arrange = (cart = mockGetCartResult()) => {
      jest.spyOn(DefaultCartService.prototype, 'getCart').mockResolvedValue(cart);
      jest.spyOn(StripeCustomerService.prototype, 'getCtCustomer').mockResolvedValue(mockCtCustomerData);
      jest.spyOn(DefaultCartService.prototype, 'getPaymentAmount').mockResolvedValue(mockGetPaymentAmount);
      jest
        .spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation')
        .mockResolvedValue(mockGetPaymentResult.id);
      return jest.spyOn(Stripe.prototype.paymentIntents, 'create').mockResolvedValue(mockStripeCreatePaymentResult);
    };

    const paramsOf = (createMock: ReturnType<typeof arrange>) =>
      createMock.mock.calls[0][0] as Stripe.PaymentIntentCreateParams;

    test('a matching rule overrides capture_method', async () => {
      mockConfigWithRules({ MX: { captureMethod: 'manual' } });
      const createMock = arrange(mockGetCartWithCountry('MX'));

      await stripePaymentService.createPaymentIntent();

      expect(paramsOf(createMock).capture_method).toBe('manual');
    });

    test('a non-matching rule leaves capture_method at the global value', async () => {
      mockConfigWithRules({ MX: { captureMethod: 'manual' } });
      const createMock = arrange(mockGetCartWithCountry('DE'));

      await stripePaymentService.createPaymentIntent();

      expect(paramsOf(createMock).capture_method).toBe('automatic');
    });

    test('a rule reached via store.key overrides capture_method', async () => {
      mockConfigWithRules({ 'store-mx': { captureMethod: 'manual' } });
      const createMock = arrange(mockGetCartWithStoreKey('store-mx'));

      await stripePaymentService.createPaymentIntent();

      expect(paramsOf(createMock).capture_method).toBe('manual');
    });

    test('a rule keyed on a shipping-only country does NOT apply', async () => {
      // The shopper must not be able to select their own behavior rule by editing the shipping
      // address — the express shippingaddresschange handler writes it straight to the CT cart.
      mockConfigWithRules({ BR: { captureMethod: 'manual' } });
      const createMock = arrange(mockGetCartWithShippingCountryOnly('BR'));

      await stripePaymentService.createPaymentIntent();

      expect(paramsOf(createMock).capture_method).toBe('automatic');
    });

    test('a rule blanking setupFutureUsage removes the value but keeps the key', async () => {
      mockConfigWithRules(
        { DE: { setupFutureUsage: '' } },
        { stripeSavedPaymentMethodConfig: { payment_method_save_usage: 'off_session' } },
      );
      const createMock = arrange(mockGetCartWithCountry('DE'));

      await stripePaymentService.createPaymentIntent();

      const params = paramsOf(createMock);
      expect(Object.keys(params)).toContain('setup_future_usage');
      expect(params.setup_future_usage).toBeUndefined();
    });

    test.each(['none', 'null', 'undefined'])('setupFutureUsage %p is treated as "do not send"', async (value) => {
      mockConfigWithRules(
        { DE: { setupFutureUsage: value } },
        { stripeSavedPaymentMethodConfig: { payment_method_save_usage: 'off_session' } },
      );
      const createMock = arrange(mockGetCartWithCountry('DE'));

      await stripePaymentService.createPaymentIntent();

      expect(paramsOf(createMock).setup_future_usage).toBeUndefined();
    });

    test('a rule can raise setupFutureUsage when the global value is unset', async () => {
      mockConfigWithRules({ DE: { setupFutureUsage: 'on_session' } });
      const createMock = arrange(mockGetCartWithCountry('DE'));

      await stripePaymentService.createPaymentIntent();

      expect(paramsOf(createMock).setup_future_usage).toBe('on_session');
    });

    // An invalid setupFutureUsage no longer reaches this layer: getPaymentBehaviorConfig rejects
    // it at startup. See config.spec.ts, "should abort startup when setupFutureUsage is not a
    // recognized value".

    test('a rule that says nothing about setupFutureUsage passes the global value through untouched', async () => {
      // Structural byte-identity: the no-rule branch must return the global value without
      // normalizing it, so an odd global value keeps flowing exactly as it did pre-refactor.
      mockConfigWithRules(
        { DE: { captureMethod: 'manual' } },
        { stripeSavedPaymentMethodConfig: { payment_method_save_usage: 'off_session' } },
      );
      const createMock = arrange(mockGetCartWithCountry('DE'));

      await stripePaymentService.createPaymentIntent();

      expect(paramsOf(createMock).setup_future_usage).toBe('off_session');
    });

    test('undefined rules map leaves every param at its global value', async () => {
      mockConfigWithRules(undefined);
      const createMock = arrange(mockGetCartWithCountry('MX'));

      await stripePaymentService.createPaymentIntent();

      expect(paramsOf(createMock).capture_method).toBe('automatic');
    });

    describe('flowType / pi_first', () => {
      test('a rule with flowType pi_first suppresses setup_future_usage', async () => {
        mockConfigWithRules(
          { DE: { flowType: 'pi_first' } },
          { stripeSavedPaymentMethodConfig: { payment_method_save_usage: 'off_session' } },
        );
        const createMock = arrange(mockGetCartWithCountry('DE'));

        await stripePaymentService.createPaymentIntent();

        expect(paramsOf(createMock).setup_future_usage).toBeUndefined();
      });

      test('a rule with flowType pi_first outranks a setupFutureUsage in the same rule', async () => {
        // The rule asks for both. pi_first wins, because Stripe would reject the payment methods
        // pi_first exists for if setup_future_usage were present.
        mockConfigWithRules({ DE: { flowType: 'pi_first', setupFutureUsage: 'on_session' } });
        const createMock = arrange(mockGetCartWithCountry('DE'));

        await stripePaymentService.createPaymentIntent();

        expect(paramsOf(createMock).setup_future_usage).toBeUndefined();
      });

      test('the global STRIPE_PAYMENT_FLOW pi_first suppresses setup_future_usage with no rule at all', async () => {
        mockConfigWithRules(undefined, {
          stripePaymentFlow: 'pi_first',
          stripeSavedPaymentMethodConfig: { payment_method_save_usage: 'off_session' },
        });
        const createMock = arrange(mockGetCartWithCountry('DE'));

        await stripePaymentService.createPaymentIntent();

        expect(paramsOf(createMock).setup_future_usage).toBeUndefined();
      });

      test('a rule with flowType deferred overrides a global pi_first and restores the value', async () => {
        mockConfigWithRules(
          { DE: { flowType: 'deferred' } },
          {
            stripePaymentFlow: 'pi_first',
            stripeSavedPaymentMethodConfig: { payment_method_save_usage: 'off_session' },
          },
        );
        const createMock = arrange(mockGetCartWithCountry('DE'));

        await stripePaymentService.createPaymentIntent();

        expect(paramsOf(createMock).setup_future_usage).toBe('off_session');
      });

      test('a non-matching flowType rule leaves setup_future_usage at the global value', async () => {
        mockConfigWithRules(
          { MX: { flowType: 'pi_first' } },
          { stripeSavedPaymentMethodConfig: { payment_method_save_usage: 'off_session' } },
        );
        const createMock = arrange(mockGetCartWithCountry('DE'));

        await stripePaymentService.createPaymentIntent();

        expect(paramsOf(createMock).setup_future_usage).toBe('off_session');
      });

      test('logs a rule-sourced discard, naming the rule key', async () => {
        // The suppression is invisible to the shopper, so this log is the only trace. Asserted rather
        // than assumed, because a merchant setting both fields on one rule loses the mandate silently.
        mockConfigWithRules({ DE: { flowType: 'pi_first', setupFutureUsage: 'off_session' } });
        arrange(mockGetCartWithCountry('DE'));

        await stripePaymentService.createPaymentIntent();

        expect(Logger.log.info).toHaveBeenCalledWith(
          'PaymentIntent setup_future_usage is discarded because the cart resolves to pi_first.',
          expect.objectContaining({ valueSource: 'rule', ruleKey: 'DE', discardedValue: 'off_session' }),
        );
      });

      test('logs a global-sourced discard WITHOUT a rule key, when the rule only carries flowType', async () => {
        // The distinguishing case. The previous test sets both fields on one rule, so it cannot tell
        // provenance apart. Here the rule supplies only flowType and the discarded value comes from
        // STRIPE_SAVED_PAYMENT_METHODS_CONFIG — naming 'DE' would send an operator to inspect a rule
        // that never carried a setupFutureUsage at all.
        mockConfigWithRules(
          { DE: { flowType: 'pi_first' } },
          { stripeSavedPaymentMethodConfig: { payment_method_save_usage: 'off_session' } },
        );
        arrange(mockGetCartWithCountry('DE'));

        await stripePaymentService.createPaymentIntent();

        const discardLog = jest
          .mocked(Logger.log.info)
          .mock.calls.find(
            ([message]) =>
              message === 'PaymentIntent setup_future_usage is discarded because the cart resolves to pi_first.',
          );
        expect(discardLog).toBeDefined();
        expect(discardLog![1]).toEqual(
          expect.objectContaining({ valueSource: 'global', discardedValue: 'off_session' }),
        );
        expect(discardLog![1]).not.toHaveProperty('ruleKey');
      });

      test('a rule whose setupFutureUsage is a disabling spelling leaves nothing to discard', async () => {
        // resolveSetupFutureUsage already returns undefined for '', 'none', 'null', 'undefined', so
        // the discard log must not fire — this pins the boundary the valueSource condition mirrors.
        mockConfigWithRules(
          { DE: { flowType: 'pi_first', setupFutureUsage: 'none' } },
          { stripeSavedPaymentMethodConfig: { payment_method_save_usage: 'off_session' } },
        );
        arrange(mockGetCartWithCountry('DE'));

        await stripePaymentService.createPaymentIntent();

        expect(Logger.log.info).not.toHaveBeenCalledWith(
          'PaymentIntent setup_future_usage is discarded because the cart resolves to pi_first.',
          expect.anything(),
        );
      });

      test('does not log a discard when there was no value to discard', async () => {
        mockConfigWithRules({ DE: { flowType: 'pi_first' } });
        arrange(mockGetCartWithCountry('DE'));

        await stripePaymentService.createPaymentIntent();

        expect(Logger.log.info).not.toHaveBeenCalledWith(
          'PaymentIntent setup_future_usage is discarded because the cart resolves to pi_first.',
          expect.anything(),
        );
      });

      test('pi_first changes the VALUE of setup_future_usage but never the param KEY SET', async () => {
        // Extends the release gate in its own spirit: suppression must not reshape the object.
        // toEqual treats a key with an undefined value as absent, so the key set is asserted
        // separately or dropping the key entirely would pass silently.
        mockConfigWithRules(
          { DE: { flowType: 'pi_first' } },
          { stripeSavedPaymentMethodConfig: { payment_method_save_usage: 'off_session' } },
        );
        const createMock = arrange(mockGetCartWithCountry('DE'));

        await stripePaymentService.createPaymentIntent();

        const params = paramsOf(createMock);
        expect(Object.keys(params)).toContain('setup_future_usage');
        expect(params.setup_future_usage).toBeUndefined();
      });
    });
  });

  /**
   * Bank transfer (customer_balance) PaymentIntent params — SB3-207 P3.
   *
   * Every expectation here was measured against the Stripe API on 2026-08-05 before being written.
   * The release gate above still owns the "no bank transfer involved" case; this suite owns the
   * eligible case AND the negatives that keep the rail off carts that did not earn it.
   */
  describe('createPaymentIntent — bank transfer (customer_balance)', () => {
    const mockBankTransferConfig = (
      rules: Record<string, Record<string, unknown>> | undefined,
      overrides: Partial<ReturnType<typeof Config.getConfig>> = {},
    ) => {
      jest.spyOn(Config, 'getConfig').mockReturnValue({
        projectKey: 'test-project',
        stripeCaptureMethod: 'automatic',
        stripePaymentFlow: 'deferred',
        stripePaymentBehaviorRules: rules,
        ...overrides,
      } as ReturnType<typeof Config.getConfig>);
    };

    /**
     * The guest case is spelled `'guest'` rather than `undefined` deliberately. A default parameter
     * fires on an EXPLICIT `undefined` too, so `arrangeBankTransfer(cart, 'USD', undefined)` would
     * silently arrange a fully-customered cart and then assert the negative — a test that passes while
     * proving nothing. Caught exactly that way in review. A sentinel makes the guest case
     * unrepresentable-as-an-accident.
     */
    const arrangeBankTransfer = (
      cart = mockGetCartWithCountry('US'),
      currencyCode = 'USD',
      customer: Customer | 'guest' = mockCtCustomerData,
    ) => {
      jest.spyOn(DefaultCartService.prototype, 'getCart').mockResolvedValue(cart);
      jest
        .spyOn(StripeCustomerService.prototype, 'getCtCustomer')
        .mockResolvedValue(customer === 'guest' ? undefined : customer);
      jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockResolvedValue({ ...mockGetPaymentAmount, currencyCode });
      jest
        .spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation')
        .mockResolvedValue(mockGetPaymentResult.id);
      return jest.spyOn(Stripe.prototype.paymentIntents, 'create').mockResolvedValue(mockStripeCreatePaymentResult);
    };

    const paramsOfBankTransfer = (createMock: ReturnType<typeof arrangeBankTransfer>) =>
      createMock.mock.calls[0][0] as Stripe.PaymentIntentCreateParams;

    describe('the EUR IBAN override', () => {
      test('sets the EU variant and the configured country for a EUR cart', async () => {
        mockBankTransferConfig({ DE: { euBankTransferCountry: 'DE' } });
        const createMock = arrangeBankTransfer(mockGetCartWithCountry('DE'), 'EUR');

        await stripePaymentService.createPaymentIntent();

        expect(paramsOfBankTransfer(createMock).payment_method_options?.customer_balance).toEqual({
          funding_type: 'bank_transfer',
          bank_transfer: { type: 'eu_bank_transfer', eu_bank_transfer: { country: 'DE' } },
        });
      });

      test('adds a key INSIDE payment_method_options and never to the params object', async () => {
        // The release gate restated: this feature widens payment_method_options, it does not reshape
        // the PaymentIntent params. If BASE_KEYS moves, default behavior moved with it.
        mockBankTransferConfig({ DE: { euBankTransferCountry: 'DE' } });
        const createMock = arrangeBankTransfer(mockGetCartWithCountry('DE'), 'EUR');

        await stripePaymentService.createPaymentIntent();

        expect(Object.keys(paramsOfBankTransfer(createMock)).sort()).toEqual(
          [
            'amount',
            'automatic_payment_methods',
            'capture_method',
            'currency',
            'customer',
            'metadata',
            'payment_method_options',
            'setup_future_usage',
          ].sort(),
        );
      });

      test('leaves capture_method and setup_future_usage exactly as configured', async () => {
        // The forces are GONE. A market that wants the rail sets captureMethod itself; the connector no
        // longer rewrites a merchant's capture policy to restore a rail they never asked for, which
        // would have changed capture for every other method on the same cart.
        mockBankTransferConfig(
          { DE: { euBankTransferCountry: 'DE' } },
          {
            stripeCaptureMethod: 'manual',
            stripeSavedPaymentMethodConfig: { payment_method_save_usage: 'off_session' },
          },
        );
        const createMock = arrangeBankTransfer(mockGetCartWithCountry('DE'), 'EUR');

        await stripePaymentService.createPaymentIntent();

        const params = paramsOfBankTransfer(createMock);
        expect(params.capture_method).toBe('manual');
        expect(params.setup_future_usage).toBe('off_session');
      });

      test('preserves automatic_async rather than downgrading it', async () => {
        // Measured 2026-08-05: a PaymentIntent with capture_method 'automatic_async' still resolves
        // customer_balance in payment_method_types, so there was never anything to correct.
        mockBankTransferConfig({ DE: { euBankTransferCountry: 'DE' } }, { stripeCaptureMethod: 'automatic_async' });
        const createMock = arrangeBankTransfer(mockGetCartWithCountry('DE'), 'EUR');

        await stripePaymentService.createPaymentIntent();

        expect(paramsOfBankTransfer(createMock).capture_method).toBe('automatic_async');
      });
    });

    describe('the carts Stripe is left to decide for', () => {
      // None of these is an error or a disabled feature: bank transfer still works on every one of
      // them, using the variant Stripe derives from the currency. What they share is that the connector
      // sends no customer_balance options, because there is no IBAN country to impose.
      test('a USD cart gets no options at all — Stripe derives us_bank_transfer', async () => {
        mockBankTransferConfig(undefined);
        const createMock = arrangeBankTransfer();

        await stripePaymentService.createPaymentIntent();

        expect(paramsOfBankTransfer(createMock).payment_method_options).not.toHaveProperty('customer_balance');
      });

      test('a EUR cart with no configured country gets no options — Stripe defaults to an IE IBAN', async () => {
        // This used to THROW, refusing a checkout Stripe would have completed.
        mockBankTransferConfig({ DE: { captureMethod: 'automatic' } });
        const createMock = arrangeBankTransfer(mockGetCartWithCountry('DE'), 'EUR');

        await stripePaymentService.createPaymentIntent();

        expect(paramsOfBankTransfer(createMock).payment_method_options).not.toHaveProperty('customer_balance');
      });

      test('a USD cart in a market configured for EUR does not receive the EU variant', async () => {
        // One store-key rule can match carts in several currencies. Sending eu_bank_transfer on a USD
        // PaymentIntent would be a 400 from Stripe.
        mockBankTransferConfig({ US: { euBankTransferCountry: 'DE' } });
        const createMock = arrangeBankTransfer();

        await stripePaymentService.createPaymentIntent();

        expect(paramsOfBankTransfer(createMock).payment_method_options).not.toHaveProperty('customer_balance');
      });

      test('a guest cart is untouched, and is left for Stripe to reject if it offers the rail', async () => {
        // customer_balance requires a customer at Stripe's end. The connector no longer models that as
        // its own eligibility rule — it simply has no IBAN to impose on a cart with no configured
        // country, and Stripe will not surface the rail without a customer anyway.
        mockBankTransferConfig({ US: { euBankTransferCountry: 'DE' } });
        const createMock = arrangeBankTransfer(mockGetCartWithCountry('US'), 'USD', 'guest');

        await stripePaymentService.createPaymentIntent();

        expect(paramsOfBankTransfer(createMock).payment_method_options).not.toHaveProperty('customer_balance');
      });

      test('a rule reachable ONLY through the shopper-typed billing country stays off (KI-046)', async () => {
        // Still the whole reason euBankTransferCountry resolves through resolveTrustedPaymentBehavior.
        // If this ever passes, a shopper chooses which of the merchant's bank accounts they wire to by
        // typing a billing country.
        mockBankTransferConfig({ DE: { euBankTransferCountry: 'DE' } });
        const createMock = arrangeBankTransfer(mockGetCartWithBillingCountryOnly('DE'), 'EUR');

        await stripePaymentService.createPaymentIntent();

        expect(paramsOfBankTransfer(createMock).payment_method_options).not.toHaveProperty('customer_balance');
      });

      test('a rule reachable only through the shipping country stays off', async () => {
        mockBankTransferConfig({ DE: { euBankTransferCountry: 'DE' } });
        const createMock = arrangeBankTransfer(mockGetCartWithShippingCountryOnly('DE'), 'EUR');

        await stripePaymentService.createPaymentIntent();

        expect(paramsOfBankTransfer(createMock).payment_method_options).not.toHaveProperty('customer_balance');
      });
    });

    describe('the client cannot dictate the IBAN', () => {
      test('discards a client-supplied customer_balance instead of honouring it', async () => {
        // The browser holds the client_secret and can post arbitrary paymentMethodOptions, so an
        // unguarded merge would let it choose the destination account. It is dropped, not merged.
        mockBankTransferConfig(undefined);
        const createMock = arrangeBankTransfer();

        await stripePaymentService.createPaymentIntent({
          paymentMethodOptions: {
            customer_balance: {
              funding_type: 'bank_transfer',
              bank_transfer: { type: 'eu_bank_transfer', eu_bank_transfer: { country: 'NL' } },
            },
          },
        });

        expect(paramsOfBankTransfer(createMock).payment_method_options).not.toHaveProperty('customer_balance');
      });

      test('replaces the client customer_balance with the merchant rule — no deep merge', async () => {
        // A deep merge would leave the client's nested eu_bank_transfer.country underneath the
        // merchant's bank_transfer.type, which is exactly the value being protected.
        mockBankTransferConfig({ DE: { euBankTransferCountry: 'DE' } });
        const createMock = arrangeBankTransfer(mockGetCartWithCountry('DE'), 'EUR');

        await stripePaymentService.createPaymentIntent({
          paymentMethodOptions: {
            customer_balance: {
              funding_type: 'bank_transfer',
              bank_transfer: { type: 'eu_bank_transfer', eu_bank_transfer: { country: 'NL' } },
              requested_address_types: ['iban'],
            },
          },
        });

        expect(paramsOfBankTransfer(createMock).payment_method_options?.customer_balance).toEqual({
          funding_type: 'bank_transfer',
          bank_transfer: { type: 'eu_bank_transfer', eu_bank_transfer: { country: 'DE' } },
        });
      });

      test('creates the PaymentIntent rather than rejecting the checkout', async () => {
        // Previously an unrecognised customer_balance threw before paymentIntents.create. Dropping the
        // key changes no outcome the shopper can see, so refusing the sale was the wrong trade.
        mockBankTransferConfig(undefined);
        const createMock = arrangeBankTransfer();

        await stripePaymentService.createPaymentIntent({
          paymentMethodOptions: { customer_balance: { funding_type: 'bank_transfer' } },
        });

        expect(createMock).toHaveBeenCalled();
      });

      test('logs the discard with the cart id and never the options themselves', async () => {
        mockBankTransferConfig(undefined);
        arrangeBankTransfer();

        await stripePaymentService.createPaymentIntent({
          paymentMethodOptions: { customer_balance: { funding_type: 'bank_transfer' } },
        });

        expect(Logger.log.warn).toHaveBeenCalledWith(
          'Discarded a client-supplied customer_balance payment method option.',
          { cartId: expect.any(String) },
        );
      });

      test('leaves other payment methods the client configured untouched', async () => {
        mockBankTransferConfig({ DE: { euBankTransferCountry: 'DE' } });
        const createMock = arrangeBankTransfer(mockGetCartWithCountry('DE'), 'EUR');

        await stripePaymentService.createPaymentIntent({
          paymentMethodOptions: {
            customer_balance: { funding_type: 'bank_transfer' },
            klarna: { preferred_locale: 'de-DE' },
          },
        });

        expect(paramsOfBankTransfer(createMock).payment_method_options?.klarna).toEqual({
          preferred_locale: 'de-DE',
        });
      });
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
      expect(Logger.log.info).toHaveBeenCalled();
    });

    describe('flowType in the response', () => {
      // flowType must reach the /config-element response, not just be resolved internally:
      // ConfigElementResponseSchema is the Fastify 200 response schema, so a field the schema does
      // not declare is stripped from the wire. See dtos/stripe-payment.dto.ts.

      const arrangeConfigElement = (cart = mockGetCartResult()) => {
        jest.spyOn(CartClient, 'getCartExpanded').mockResolvedValue(cart);
        jest.spyOn(DefaultCartService.prototype, 'getPaymentAmount').mockResolvedValue(mockGetPaymentAmount);
        jest.spyOn(StripeSubscriptionService.prototype, 'getPaymentMode').mockReturnValue('payment');
      };

      const mockConfigElementConfig = (overrides: Partial<ReturnType<typeof Config.getConfig>> = {}) => {
        jest.spyOn(Config, 'getConfig').mockReturnValue({
          stripeCaptureMethod: 'automatic',
          stripeSavedPaymentMethodConfig: {},
          stripeLayout: '{"type":"tabs","defaultCollapsed":false}',
          stripeCollectBillingAddress: 'auto',
          // The production default, never undefined — same reasoning as mockConfig further up.
          stripePaymentFlow: 'deferred',
          ...overrides,
        } as ReturnType<typeof Config.getConfig>);
      };

      test('defaults to deferred through the real config when nothing is configured', async () => {
        arrangeConfigElement();

        const result = await stripePaymentService.initializeCartPayment('paymentElement');

        expect(result.flowType).toBe('deferred');
      });

      test('reports the global STRIPE_PAYMENT_FLOW', async () => {
        mockConfigElementConfig({ stripePaymentFlow: 'pi_first' });
        arrangeConfigElement();

        const result = await stripePaymentService.initializeCartPayment('paymentElement');

        expect(result.flowType).toBe('pi_first');
      });

      test('a matching rule overrides the global flowType', async () => {
        mockConfigElementConfig({
          stripePaymentFlow: 'deferred',
          stripePaymentBehaviorRules: { DE: { flowType: 'pi_first' } },
        });
        arrangeConfigElement(mockGetCartWithCountry('DE'));

        const result = await stripePaymentService.initializeCartPayment('paymentElement');

        expect(result.flowType).toBe('pi_first');
      });

      test('a non-matching rule leaves flowType at the global value', async () => {
        mockConfigElementConfig({
          stripePaymentFlow: 'deferred',
          stripePaymentBehaviorRules: { MX: { flowType: 'pi_first' } },
        });
        arrangeConfigElement(mockGetCartWithCountry('DE'));

        const result = await stripePaymentService.initializeCartPayment('paymentElement');

        expect(result.flowType).toBe('deferred');
      });

      test('pi_first suppresses setupFutureUsage in the response', async () => {
        // Stripe rejects { clientSecret } together with setupFutureUsage on the Elements instance,
        // and the enabler builds elements() from this response.
        mockConfigElementConfig({
          stripePaymentFlow: 'pi_first',
          stripeSavedPaymentMethodConfig: { payment_method_save_usage: 'off_session' },
        });
        arrangeConfigElement();

        const result = await stripePaymentService.initializeCartPayment('paymentElement');

        expect(result.setupFutureUsage).toBeUndefined();
      });

      test('deferred passes setupFutureUsage through to the response', async () => {
        mockConfigElementConfig({
          stripePaymentFlow: 'deferred',
          stripeSavedPaymentMethodConfig: { payment_method_save_usage: 'off_session' },
        });
        arrangeConfigElement();

        const result = await stripePaymentService.initializeCartPayment('paymentElement');

        expect(result.setupFutureUsage).toBe('off_session');
      });

      test('captureMethod stays at the flat env var even when a rule sets it — known inconsistency', async () => {
        // Deliberately pinned, not an oversight: ct-connect-stripe-checkout resolves captureMethod
        // from the rule here and this connector does not. Resolving it would change behavior for
        // carts that already match a rule, which is out of scope for the pi_first port. This test
        // fails the day someone closes the gap, which is the moment to update it on purpose.
        mockConfigElementConfig({
          stripeCaptureMethod: 'automatic',
          stripePaymentBehaviorRules: { DE: { captureMethod: 'manual' } },
        });
        arrangeConfigElement(mockGetCartWithCountry('DE'));

        const result = await stripePaymentService.initializeCartPayment('paymentElement');

        expect(result.captureMethod).toBe('automatic');
      });
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

    test('should process payment_intent.succeeded as happy path when cart total matches and create order', async () => {
      const mockEvent: Stripe.Event = mockEvent__paymentIntent_succeeded_captureMethodManual;

      const test = {
        id: 'paymentId',
        pspReference: 'paymentIntentId',
        paymentMethod: 'payment',
        transactions: [],
      };
      // Fixture PI: amount = amount_received = 13200, currency 'mxn'. Cart total matches → order created.
      const mockCart = {
        id: 'mock-cart-id',
        version: 1,
        cartState: 'Frozen',
        totalPrice: { centAmount: 13200, currencyCode: 'mxn' },
      } as Cart;

      const mockStripeEventConverter = jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(test);
      jest.spyOn(DefaultCartService.prototype, 'getCartByPaymentId').mockResolvedValue(mockCart);
      jest.spyOn(Stripe.prototype.charges, 'retrieve').mockResolvedValue({} as Stripe.Response<Stripe.Charge>);
      const createOrderSpy = jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue();

      await stripePaymentService.processStripeEvent(mockEvent);

      expect(mockStripeEventConverter).toHaveBeenCalled();
      expect(createOrderSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cart: expect.anything(),
          paymentIntentId: 'paymentIntentId',
        }),
      );
      expect(Logger.log.error).not.toHaveBeenCalledWith(
        expect.stringContaining('underpayment guard'),
        expect.any(Object),
      );
    });

    test('should use taxedPrice.totalGross over totalPrice when validating the succeeded amount', async () => {
      const mockEvent: Stripe.Event = mockEvent__paymentIntent_succeeded_captureMethodManual;

      const test = {
        id: 'paymentId',
        pspReference: 'paymentIntentId',
        paymentMethod: 'payment',
        transactions: [],
      };
      // totalPrice would mismatch (999), but taxedPrice.totalGross matches the PI (13200) → order created.
      const mockCart = {
        id: 'mock-cart-id',
        version: 1,
        cartState: 'Frozen',
        totalPrice: { centAmount: 999, currencyCode: 'mxn' },
        taxedPrice: { totalGross: { centAmount: 13200, currencyCode: 'mxn' } },
      } as Cart;

      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(test);
      jest.spyOn(DefaultCartService.prototype, 'getCartByPaymentId').mockResolvedValue(mockCart);
      jest.spyOn(Stripe.prototype.charges, 'retrieve').mockResolvedValue({} as Stripe.Response<Stripe.Charge>);
      const createOrderSpy = jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue();

      await stripePaymentService.processStripeEvent(mockEvent);

      expect(createOrderSpy).toHaveBeenCalled();
    });

    test('should NOT create an order when the paid amount does not match the current cart total (underpayment guard)', async () => {
      const mockEvent: Stripe.Event = mockEvent__paymentIntent_succeeded_captureMethodManual;

      const test = {
        id: 'paymentId',
        pspReference: 'paymentIntentId',
        paymentMethod: 'payment',
        transactions: [],
      };
      // Cart was mutated to a larger total (99900) after the PI was created at 13200 → underpayment.
      const mockCart = {
        id: 'mock-cart-id',
        version: 1,
        cartState: 'Active',
        totalPrice: { centAmount: 99900, currencyCode: 'mxn' },
      } as Cart;

      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(test);
      jest.spyOn(DefaultCartService.prototype, 'getCartByPaymentId').mockResolvedValue(mockCart);
      const chargesRetrieveSpy = jest
        .spyOn(Stripe.prototype.charges, 'retrieve')
        .mockResolvedValue({} as Stripe.Response<Stripe.Charge>);
      const createOrderSpy = jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue();

      await stripePaymentService.processStripeEvent(mockEvent);

      expect(createOrderSpy).not.toHaveBeenCalled();
      expect(chargesRetrieveSpy).not.toHaveBeenCalled();
      expect(Logger.log.error).toHaveBeenCalledWith(
        'payment_intent.succeeded: paid amount/currency does not match the current cart total — order NOT created (underpayment guard).',
        expect.objectContaining({
          ctCartId: 'mock-cart-id',
          stripeAmount: 13200,
          cartTotalCentAmount: 99900,
        }),
      );
    });

    test('should skip order creation on payment_intent.succeeded when the cart is already Ordered (idempotency)', async () => {
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
        cartState: 'Ordered',
        totalPrice: { centAmount: 13200, currencyCode: 'mxn' },
      } as Cart;

      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(test);
      jest.spyOn(DefaultCartService.prototype, 'getCartByPaymentId').mockResolvedValue(mockCart);
      const createOrderSpy = jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue();

      await stripePaymentService.processStripeEvent(mockEvent);

      expect(createOrderSpy).not.toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalledWith(
        'payment_intent.succeeded for an already-ordered cart — skipping duplicate order creation.',
        expect.objectContaining({ ctCartId: 'mock-cart-id', paymentId: 'paymentId' }),
      );
      expect(Logger.log.error).not.toHaveBeenCalledWith(
        expect.stringContaining('underpayment guard'),
        expect.any(Object),
      );
    });

    const processingUpdateData = {
      id: 'paymentId',
      pspReference: 'pi_processing',
      paymentMethod: 'payment',
      transactions: [
        {
          type: PaymentTransactions.AUTHORIZATION,
          state: PaymentStatus.PENDING,
          amount: { centAmount: 13200, currencyCode: 'USD' },
        },
      ],
    };
    const processingEvent = {
      ...mockEvent__paymentIntent_succeeded_captureMethodManual,
      type: 'payment_intent.processing',
    } as Stripe.Event;

    test('payment_intent.processing: skips writing Pending when a successful Charge already exists (ordering guard)', async () => {
      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(processingUpdateData);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockGetPaymentResult);
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockResolvedValue(mockGetPaymentResult);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(true);

      await stripePaymentService.processStripeEvent(processingEvent);

      expect(updatePaymentMock).not.toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalledWith(
        'Skipping payment_intent.processing — payment already resolved or pending transaction exists',
        expect.any(Object),
      );
    });

    test('payment_intent.processing: skips (dedup) when a Pending Authorization already exists', async () => {
      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(processingUpdateData);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockGetPaymentResult);
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockResolvedValue(mockGetPaymentResult);
      jest
        .spyOn(DefaultPaymentService.prototype, 'hasTransactionInState')
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      await stripePaymentService.processStripeEvent(processingEvent);

      expect(updatePaymentMock).not.toHaveBeenCalled();
    });

    test('payment_intent.processing: writes Authorization/Pending when no prior transaction exists', async () => {
      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(processingUpdateData);
      const getPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockResolvedValue(mockGetPaymentResult);
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockResolvedValue(mockGetPaymentResult);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);

      await stripePaymentService.processStripeEvent(processingEvent);

      expect(getPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(1);
    });

    test('payment_intent.processing: re-throws on CT write failure (no silent swallow)', async () => {
      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(processingUpdateData);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockGetPaymentResult);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockRejectedValue(new Error('CT write failed'));

      await expect(stripePaymentService.processStripeEvent(processingEvent)).rejects.toThrow('CT write failed');
    });

    // -----------------------------------------------------------------------
    // Bank transfers (customer_balance) — SB3-207 Etapa 2
    // -----------------------------------------------------------------------
    const requiresActionUpdateData = {
      id: 'paymentId',
      pspReference: 'pi_bt_11111',
      paymentMethod: 'payment',
      transactions: [
        {
          type: PaymentTransactions.AUTHORIZATION,
          state: PaymentStatus.PENDING,
          amount: { centAmount: 12300, currencyCode: 'EUR' },
        },
      ],
    };
    const requiresActionEvent = {
      ...mockEvent__paymentIntent_succeeded_captureMethodManual,
      type: 'payment_intent.requires_action',
    } as Stripe.Event;

    const partiallyFundedUpdateData = {
      id: 'paymentId',
      pspReference: 'pi_bt_11111',
      paymentMethod: 'payment',
      pspInteraction: { response: '{"type":"payment_intent.partially_funded"}' },
      transactions: [],
    };
    const partiallyFundedEvent = {
      ...mockEvent__paymentIntent_succeeded_captureMethodManual,
      type: 'payment_intent.partially_funded',
    } as Stripe.Event;

    test('requires_action: skips writing Pending when a successful Charge already exists', async () => {
      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(requiresActionUpdateData);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockGetPaymentResult);
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockResolvedValue(mockGetPaymentResult);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(true);

      await stripePaymentService.processStripeEvent(requiresActionEvent);

      expect(updatePaymentMock).not.toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalledWith(
        'Skipping payment_intent.requires_action — payment already resolved or pending transaction exists',
        expect.any(Object),
      );
    });

    // Out-of-order redelivery: succeeded lands first, the late requires_action must not
    // write a second Pending authorization.
    test('requires_action: skips (dedup) when a Pending Authorization already exists', async () => {
      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(requiresActionUpdateData);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockGetPaymentResult);
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockResolvedValue(mockGetPaymentResult);
      jest
        .spyOn(DefaultPaymentService.prototype, 'hasTransactionInState')
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      await stripePaymentService.processStripeEvent(requiresActionEvent);

      expect(updatePaymentMock).not.toHaveBeenCalled();
    });

    test('requires_action: writes Authorization/Pending when no prior transaction exists', async () => {
      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(requiresActionUpdateData);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockGetPaymentResult);
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockResolvedValue(mockGetPaymentResult);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);

      await stripePaymentService.processStripeEvent(requiresActionEvent);

      expect(updatePaymentMock).toHaveBeenCalledTimes(1);
      expect(updatePaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: expect.objectContaining({
            type: PaymentTransactions.AUTHORIZATION,
            state: PaymentStatus.PENDING,
            amount: { centAmount: 12300, currencyCode: 'EUR' },
          }),
        }),
      );
    });

    // A PaymentIntent with no ct_payment_id was not created by this connector. Before the
    // guard, requires_action would throw inside getPayment, re-throw, return 500, and Stripe
    // would retry for three days — potentially disabling the whole webhook endpoint.
    test('requires_action: skips (no retry) when the PaymentIntent carries no ct_payment_id', async () => {
      jest
        .spyOn(StripeEventConverter.prototype, 'convert')
        .mockReturnValue({ ...requiresActionUpdateData, id: undefined as unknown as string });
      const getPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockResolvedValue(mockGetPaymentResult);
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockResolvedValue(mockGetPaymentResult);

      await expect(stripePaymentService.processStripeEvent(requiresActionEvent)).resolves.toBeUndefined();

      expect(getPaymentMock).not.toHaveBeenCalled();
      expect(updatePaymentMock).not.toHaveBeenCalled();
      expect(Logger.log.warn).toHaveBeenCalledWith(
        'Skipping event: the PaymentIntent carries no commercetools payment id in its metadata',
        expect.any(Object),
      );
    });

    test('requires_action: re-throws on CT write failure so Stripe retries', async () => {
      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(requiresActionUpdateData);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockGetPaymentResult);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockRejectedValue(new Error('CT write failed'));

      await expect(stripePaymentService.processStripeEvent(requiresActionEvent)).rejects.toThrow('CT write failed');
    });

    test('partially_funded: persists the pspInteraction so the event leaves an audit trail', async () => {
      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(partiallyFundedUpdateData);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockGetPaymentResult);
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockResolvedValue(mockGetPaymentResult);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);

      await stripePaymentService.processStripeEvent(partiallyFundedEvent);

      expect(updatePaymentMock).toHaveBeenCalledTimes(1);
      expect(updatePaymentMock).toHaveBeenCalledWith(expect.objectContaining({ pspReference: 'pi_bt_11111' }));
      expect(updatePaymentMock.mock.calls[0][0]).not.toHaveProperty('transaction');
    });

    // ***** RELEASE GATE *****
    // The zero-transaction branch contains a nested fixup that promotes an
    // Authorization/Initial to Success for the FULL amountPlanned. That fixup is correct
    // for charge.succeeded and catastrophic for partially_funded: the money sits in the
    // customer cash balance, not on the platform balance. If anyone collapses the inner
    // condition back into the outer one, this test must fail.
    test('RELEASE GATE: partially_funded never promotes an Initial Authorization to Success', async () => {
      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(partiallyFundedUpdateData);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockGetPaymentResult);
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockResolvedValue(mockGetPaymentResult);
      // An Authorization/Initial IS present — the exact condition the fixup looks for.
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(true);

      await stripePaymentService.processStripeEvent(partiallyFundedEvent);

      expect(updatePaymentMock).toHaveBeenCalledTimes(1);
      const wroteSuccessAuthorization = updatePaymentMock.mock.calls.some((call) => {
        const transaction = (call[0] as { transaction?: { type: string; state: string } }).transaction;
        return transaction?.type === PaymentTransactions.AUTHORIZATION && transaction?.state === PaymentStatus.SUCCESS;
      });
      expect(wroteSuccessAuthorization).toBe(false);
    });

    test('partially_funded: swallows CT write failures (no retry storm on a frequent event)', async () => {
      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(partiallyFundedUpdateData);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockGetPaymentResult);
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockRejectedValue(new Error('CT write failed'));

      await expect(stripePaymentService.processStripeEvent(partiallyFundedEvent)).resolves.toBeUndefined();
    });

    test('regression: a non-processing event (card succeeded) still swallows CT write errors', async () => {
      const cardUpdateData = {
        id: 'paymentId',
        pspReference: 'pi_card',
        paymentMethod: 'payment',
        transactions: [
          {
            type: PaymentTransactions.CHARGE,
            state: PaymentStatus.SUCCESS,
            amount: { centAmount: 13200, currencyCode: 'USD' },
          },
        ],
      };
      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(cardUpdateData);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockRejectedValue(new Error('CT write failed'));

      await expect(
        stripePaymentService.processStripeEvent(mockEvent__paymentIntent_succeeded_captureMethodManual),
      ).resolves.toBeUndefined();
    });

    const succeededUpdateData = {
      id: 'paymentId',
      pspReference: 'pi_succeeded',
      paymentMethod: 'payment',
      transactions: [
        {
          type: PaymentTransactions.CHARGE,
          state: PaymentStatus.SUCCESS,
          amount: { centAmount: 13200, currencyCode: 'USD' },
        },
      ],
    };
    const succeededEvent = {
      ...mockEvent__paymentIntent_succeeded_captureMethodManual,
      type: 'payment_intent.succeeded',
    } as Stripe.Event;

    test('payment_intent.succeeded: transitions a lingering Pending authorization to Success', async () => {
      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(succeededUpdateData);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockGetPaymentResult);
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockResolvedValue(mockGetPaymentResult);
      // Authorization/Pending exists → should be transitioned to Success
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(true);
      jest
        .spyOn(
          StripePaymentService.prototype as unknown as { handlePaymentIntentSucceededFlow: () => Promise<void> },
          'handlePaymentIntentSucceededFlow',
        )
        .mockResolvedValue(undefined);

      await stripePaymentService.processStripeEvent(succeededEvent);

      expect(updatePaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: expect.objectContaining({
            type: PaymentTransactions.AUTHORIZATION,
            state: PaymentStatus.SUCCESS,
          }),
        }),
      );
    });

    test('regression: payment_intent.succeeded without a Pending authorization does not write an extra Authorization (card path)', async () => {
      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(succeededUpdateData);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(mockGetPaymentResult);
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockResolvedValue(mockGetPaymentResult);
      // No Authorization/Pending (card never went through processing) → no-op
      jest.spyOn(DefaultPaymentService.prototype, 'hasTransactionInState').mockReturnValue(false);
      jest
        .spyOn(
          StripePaymentService.prototype as unknown as { handlePaymentIntentSucceededFlow: () => Promise<void> },
          'handlePaymentIntentSucceededFlow',
        )
        .mockResolvedValue(undefined);

      await stripePaymentService.processStripeEvent(succeededEvent);

      expect(updatePaymentMock).not.toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: expect.objectContaining({
            type: PaymentTransactions.AUTHORIZATION,
            state: PaymentStatus.SUCCESS,
          }),
        }),
      );
    });

    // Crypto failure-path: a payment that reached processing (Authorization/Pending) and then
    // fails must resolve the Pending authorization to Failure. The converter's event→Failure
    // mapping is covered in stripeEvent.converter.spec.ts; these lock in that the service
    // actually writes Authorization/Failure for both crypto failure events (payment_failed and
    // canceled/expiration), i.e. no guard silently skips them.
    const failedUpdateData = {
      id: 'paymentId',
      pspReference: 'pi_failed',
      paymentMethod: 'payment',
      transactions: [
        {
          type: PaymentTransactions.AUTHORIZATION,
          state: PaymentStatus.FAILURE,
          amount: { centAmount: 13200, currencyCode: 'USD' },
        },
      ],
    };

    test('payment_intent.payment_failed: writes Authorization/Failure (resolves a Pending authorization from crypto processing)', async () => {
      const paymentFailedEvent = {
        ...mockEvent__paymentIntent_succeeded_captureMethodManual,
        type: 'payment_intent.payment_failed',
      } as Stripe.Event;
      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(failedUpdateData);
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockResolvedValue(mockGetPaymentResult);
      jest
        .spyOn(
          StripePaymentService.prototype as unknown as {
            unfreezeCartOnPaymentCancelOrFailed: () => Promise<void>;
          },
          'unfreezeCartOnPaymentCancelOrFailed',
        )
        .mockResolvedValue(undefined);

      await stripePaymentService.processStripeEvent(paymentFailedEvent);

      expect(updatePaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: expect.objectContaining({
            type: PaymentTransactions.AUTHORIZATION,
            state: PaymentStatus.FAILURE,
          }),
        }),
      );
    });

    test('payment_intent.canceled (crypto expiration): writes Authorization/Failure to resolve a Pending authorization', async () => {
      const canceledUpdateData = {
        id: 'paymentId',
        pspReference: 'pi_canceled',
        paymentMethod: 'payment',
        transactions: [
          {
            type: PaymentTransactions.AUTHORIZATION,
            state: PaymentStatus.FAILURE,
            amount: { centAmount: 13200, currencyCode: 'USD' },
          },
          {
            type: PaymentTransactions.CANCEL_AUTHORIZATION,
            state: PaymentStatus.SUCCESS,
            amount: { centAmount: 13200, currencyCode: 'USD' },
          },
        ],
      };
      const canceledEvent = {
        ...mockEvent__paymentIntent_succeeded_captureMethodManual,
        type: 'payment_intent.canceled',
      } as Stripe.Event;
      jest.spyOn(StripeEventConverter.prototype, 'convert').mockReturnValue(canceledUpdateData);
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockResolvedValue(mockGetPaymentResult);
      jest
        .spyOn(
          StripePaymentService.prototype as unknown as {
            unfreezeCartOnPaymentCancelOrFailed: () => Promise<void>;
          },
          'unfreezeCartOnPaymentCancelOrFailed',
        )
        .mockResolvedValue(undefined);

      await stripePaymentService.processStripeEvent(canceledEvent);

      expect(updatePaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: expect.objectContaining({
            type: PaymentTransactions.AUTHORIZATION,
            state: PaymentStatus.FAILURE,
          }),
        }),
      );
      expect(updatePaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: expect.objectContaining({
            type: PaymentTransactions.CANCEL_AUTHORIZATION,
            state: PaymentStatus.SUCCESS,
          }),
        }),
      );
    });
  });

  describe('method processStripeEventMultipleCaptured', () => {
    test('should calculate incremental capture amount and update payment', async () => {
      const mockEvent: Stripe.Event = {
        id: 'evt_multicapture',
        object: 'event',
        type: 'charge.updated',
        created: Date.now(),
        api_version: '2024-04-10',
        livemode: false,
        pending_webhooks: 0,
        request: null,
        data: {
          object: {
            id: 'ch_123',
            object: 'charge',
            amount_captured: 50000, // Total captured now
            captured: false, // Not captured yet for multicapture processing
            currency: 'usd',
            balance_transaction: 'txn_123',
          } as Stripe.Charge,
          previous_attributes: {
            amount_captured: 30000, // Previously captured
          } as Partial<Stripe.Charge>,
        },
      } as Stripe.Event;

      const mockUpdateData = {
        id: 'paymentId',
        pspReference: 'ch_123',
        paymentMethod: 'card',
        transactions: [
          {
            type: PaymentTransactions.CHARGE,
            state: PaymentStatus.SUCCESS,
            amount: { centAmount: 50000, currencyCode: 'USD' },
            interactionId: 'ch_123',
          },
        ],
      };

      const mockStripeEventConverter = jest
        .spyOn(StripeEventConverter.prototype, 'convert')
        .mockReturnValue(mockUpdateData);

      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await stripePaymentService.processStripeEventMultipleCaptured(mockEvent);

      expect(mockStripeEventConverter).toHaveBeenCalledWith(mockEvent);
      expect(updatePaymentMock).toHaveBeenCalledTimes(1);

      // Verify the incremental amount was calculated correctly (50000 - 30000 = 20000)
      const updateCall = updatePaymentMock.mock.calls[0][0];
      expect(updateCall.transaction?.amount.centAmount).toBe(20000);
      expect(updateCall.transaction?.interactionId).toBe('txn_123');
      expect(updateCall.pspReference).toBe('txn_123');
    });

    test('should skip processing if charge is not captured', async () => {
      const mockEvent: Stripe.Event = {
        id: 'evt_not_captured',
        object: 'event',
        type: 'charge.updated',
        created: Date.now(),
        api_version: '2024-04-10',
        livemode: false,
        pending_webhooks: 0,
        request: null,
        data: {
          object: {
            id: 'ch_123',
            object: 'charge',
            amount_captured: 0,
            captured: false, // Not captured
            currency: 'usd',
            balance_transaction: null,
          } as Stripe.Charge,
          previous_attributes: {} as Partial<Stripe.Charge>,
        },
      } as Stripe.Event;

      const mockUpdateData = {
        id: 'paymentId',
        pspReference: 'ch_123',
        paymentMethod: 'card',
        transactions: [],
      };

      const mockStripeEventConverter = jest
        .spyOn(StripeEventConverter.prototype, 'convert')
        .mockReturnValue(mockUpdateData);

      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await stripePaymentService.processStripeEventMultipleCaptured(mockEvent);

      expect(mockStripeEventConverter).toHaveBeenCalledWith(mockEvent);
      expect(updatePaymentMock).not.toHaveBeenCalled();
    });

    test('should skip processing if amount_captured did not increase', async () => {
      const mockEvent: Stripe.Event = {
        id: 'evt_no_increase',
        object: 'event',
        type: 'charge.updated',
        created: Date.now(),
        api_version: '2024-04-10',
        livemode: false,
        pending_webhooks: 0,
        request: null,
        data: {
          object: {
            id: 'ch_123',
            object: 'charge',
            amount_captured: 30000, // Same as before
            captured: true,
            currency: 'usd',
            balance_transaction: 'txn_123',
          } as Stripe.Charge,
          previous_attributes: {
            amount_captured: 30000, // Same amount
          } as Partial<Stripe.Charge>,
        },
      } as Stripe.Event;

      const mockUpdateData = {
        id: 'paymentId',
        pspReference: 'ch_123',
        paymentMethod: 'card',
        transactions: [],
      };

      const mockStripeEventConverter = jest
        .spyOn(StripeEventConverter.prototype, 'convert')
        .mockReturnValue(mockUpdateData);

      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await stripePaymentService.processStripeEventMultipleCaptured(mockEvent);

      expect(mockStripeEventConverter).toHaveBeenCalledWith(mockEvent);
      expect(updatePaymentMock).not.toHaveBeenCalled();
    });
  });

  describe('cart freeze timing (KI-044 / KI-047)', () => {
    /**
     * The mount-time freeze is gone and the amount is now checked against the live cart. The two are
     * one change: removing the freeze without the amount check would trade a stuck cart for an
     * underpayment window, because the PaymentIntent keeps the total it was created with.
     */
    const matchingPayment = { ...mockGetPaymentResult, interfaceId: 'paymentId' };

    const arrangeConfirm = (cartAmount = matchingPayment.amountPlanned) => {
      jest
        .spyOn(DefaultCartService.prototype, 'getCart')
        .mockResolvedValue({ ...mockGetCartResult(), totalPrice: cartAmount, taxedPrice: undefined } as Cart);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(matchingPayment);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue({} as Payment);
      jest.spyOn(Stripe.prototype.paymentIntents, 'retrieve').mockResolvedValue({
        ...mockStripeRetrievePaymentResult,
        status: 'succeeded',
        amount: matchingPayment.amountPlanned.centAmount,
        currency: matchingPayment.amountPlanned.currencyCode.toLowerCase(),
      } as Stripe.Response<Stripe.PaymentIntent>);
      return jest.spyOn(CartClient, 'freezeCart').mockResolvedValue(mockGetCartResult());
    };

    test('does NOT freeze the cart when the PaymentIntent is created', async () => {
      // Under pi_first this runs on page mount. Freezing here left abandoned carts unusable forever.
      const freeze = jest.spyOn(CartClient, 'freezeCart').mockResolvedValue(mockGetCartResult());
      jest.spyOn(Config, 'getConfig').mockReturnValue({
        projectKey: 'test-project',
        stripeCaptureMethod: 'automatic',
        stripePaymentFlow: 'pi_first',
      } as ReturnType<typeof Config.getConfig>);
      jest.spyOn(DefaultCartService.prototype, 'getCart').mockResolvedValue(mockGetCartWithCountry('US'));
      jest.spyOn(StripeCustomerService.prototype, 'getCtCustomer').mockResolvedValue(mockCtCustomerData);
      jest.spyOn(DefaultCartService.prototype, 'getPaymentAmount').mockResolvedValue({
        centAmount: 33915,
        currencyCode: 'USD',
      });
      jest.spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation').mockResolvedValue('ct-payment-id');
      jest.spyOn(Stripe.prototype.paymentIntents, 'create').mockResolvedValue({
        id: 'pi_1',
        client_secret: 'cs_1',
      } as Stripe.Response<Stripe.PaymentIntent>);

      await stripePaymentService.createPaymentIntent();

      expect(freeze).not.toHaveBeenCalled();
    });

    test('freezes the cart at confirmation instead', async () => {
      const freeze = arrangeConfirm();

      await stripePaymentService.updatePaymentIntentStripeSuccessful('paymentId', 'paymentReference');

      expect(freeze).toHaveBeenCalled();
    });

    test('rejects a confirmation whose cart total moved after the PaymentIntent was created', async () => {
      // THE underpayment case. Stripe still holds the old amount; the cart is now worth more. Before
      // this change both sides of the comparison were the same stale snapshot, so it passed.
      arrangeConfirm({
        centAmount: matchingPayment.amountPlanned.centAmount + 5000,
        currencyCode: matchingPayment.amountPlanned.currencyCode,
      });

      await expect(
        stripePaymentService.updatePaymentIntentStripeSuccessful('paymentId', 'paymentReference'),
      ).rejects.toThrow('amount/currency mismatch');
    });

    test('confirms normally when the webhook already settled the payment', async () => {
      // THE regression that reached the browser as a stuck spinner. This endpoint races
      // payment_intent.succeeded; when the webhook wins, the cart is already fully paid. The first
      // attempt at this used ctCartService.getPaymentAmount, which validates payability and throws
      // InvalidOperation in exactly that state — observed with cartAmount and paidAmount both 12300.
      // Reading the cart's own total has no such opinion, so a redundant confirmation is harmless.
      const paidCart = {
        ...mockGetCartResult(),
        totalPrice: matchingPayment.amountPlanned,
        taxedPrice: undefined,
      } as Cart;
      jest.spyOn(DefaultCartService.prototype, 'getCart').mockResolvedValue(paidCart);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(matchingPayment);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue({} as Payment);
      jest.spyOn(CartClient, 'freezeCart').mockResolvedValue(mockGetCartResult());
      jest.spyOn(Stripe.prototype.paymentIntents, 'retrieve').mockResolvedValue({
        ...mockStripeRetrievePaymentResult,
        status: 'succeeded',
        amount: matchingPayment.amountPlanned.centAmount,
        currency: matchingPayment.amountPlanned.currencyCode.toLowerCase(),
      } as Stripe.Response<Stripe.PaymentIntent>);
      // The failure mode being guarded: if anything here calls getPaymentAmount again, it throws.
      const paymentAmount = jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockRejectedValue(new Error('InvalidOperation: cart already paid'));

      await expect(
        stripePaymentService.updatePaymentIntentStripeSuccessful('paymentId', 'paymentReference'),
      ).resolves.toBeDefined();
      expect(paymentAmount).not.toHaveBeenCalled();
    });

    test('uses the taxed gross total when tax has been calculated', async () => {
      // commercetools charges taxedPrice.totalGross once tax exists; comparing against totalPrice
      // there would reject every taxed cart.
      const gross = { centAmount: matchingPayment.amountPlanned.centAmount, currencyCode: 'GBP' };
      jest.spyOn(DefaultCartService.prototype, 'getCart').mockResolvedValue({
        ...mockGetCartResult(),
        totalPrice: { centAmount: 1, currencyCode: 'GBP' },
        taxedPrice: { totalGross: gross },
      } as unknown as Cart);
      jest.spyOn(DefaultPaymentService.prototype, 'getPayment').mockResolvedValue(matchingPayment);
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue({} as Payment);
      jest.spyOn(CartClient, 'freezeCart').mockResolvedValue(mockGetCartResult());
      jest.spyOn(Stripe.prototype.paymentIntents, 'retrieve').mockResolvedValue({
        ...mockStripeRetrievePaymentResult,
        status: 'succeeded',
        amount: gross.centAmount,
        currency: 'gbp',
      } as Stripe.Response<Stripe.PaymentIntent>);

      await expect(
        stripePaymentService.updatePaymentIntentStripeSuccessful('paymentId', 'paymentReference'),
      ).resolves.toBeDefined();
    });

    test('does not fail the payment when the freeze itself fails', async () => {
      // The shopper already authorised. Refusing over a cart-state write would be the worse outcome,
      // and the amount was validated immediately before.
      arrangeConfirm();
      jest.spyOn(CartClient, 'freezeCart').mockRejectedValue(new Error('CT unavailable'));

      await expect(
        stripePaymentService.updatePaymentIntentStripeSuccessful('paymentId', 'paymentReference'),
      ).resolves.toBeDefined();
    });

    describe('bank transfer freezes on its own path', () => {
      // Bank transfer never reaches the confirm gate: its confirm returns requires_action, which is
      // not in the status allowlist, and the enabler does not call the endpoint. Verified 2026-08-06.
      const event = (metadata: Record<string, string>) =>
        ({
          type: 'payment_intent.requires_action',
          data: { object: { id: 'pi_bt', metadata } },
        }) as unknown as Stripe.Event;

      test('freezes the cart named in the PaymentIntent metadata', async () => {
        jest.spyOn(DefaultCartService.prototype, 'getCart').mockResolvedValue(mockGetCartResult());
        jest.spyOn(CartClient, 'isCartFrozen').mockReturnValue(false);
        const freeze = jest.spyOn(CartClient, 'freezeCart').mockResolvedValue(mockGetCartResult());

        await stripePaymentService.freezeCartForBankTransfer(event({ cart_id: 'cart-1' }));

        expect(freeze).toHaveBeenCalled();
      });

      test('is idempotent — an already frozen cart is left alone', async () => {
        // Stripe redelivers webhooks; a second freeze attempt must not churn the cart version.
        jest.spyOn(DefaultCartService.prototype, 'getCart').mockResolvedValue(mockGetCartResult());
        jest.spyOn(CartClient, 'isCartFrozen').mockReturnValue(true);
        const freeze = jest.spyOn(CartClient, 'freezeCart').mockResolvedValue(mockGetCartResult());

        await stripePaymentService.freezeCartForBankTransfer(event({ cart_id: 'cart-1' }));

        expect(freeze).not.toHaveBeenCalled();
      });

      test('skips, without throwing, when the PaymentIntent carries no cart id', async () => {
        const freeze = jest.spyOn(CartClient, 'freezeCart').mockResolvedValue(mockGetCartResult());

        await expect(stripePaymentService.freezeCartForBankTransfer(event({}))).resolves.toBeUndefined();
        expect(freeze).not.toHaveBeenCalled();
      });
    });
  });

  describe('method processStripeEventRefundFailed', () => {
    /**
     * charge.refunded writes Refund/Success when the Refund is CREATED. On a delayed rail that is not
     * the same as succeeded — measured 2026-08-05, a bank-transfer refund is created 'pending'. These
     * tests cover the correction that was previously missing entirely.
     */
    const makeRefundEvent = (overrides: Partial<Stripe.Refund> = {}): Stripe.Event =>
      ({
        id: 'evt_refund_1',
        type: 'refund.updated',
        data: {
          object: {
            id: 'pyr_1',
            object: 'refund',
            amount: 5000,
            currency: 'eur',
            status: 'failed',
            failure_reason: 'insufficient_funds',
            metadata: { ct_payment_id: 'ct-pay-1' },
            ...overrides,
          },
        },
      }) as unknown as Stripe.Event;

    test('writes Refund/Failure so a rejected refund stops reading as successful', async () => {
      const updateMock = jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue({} as Payment);

      await stripePaymentService.processStripeEventRefundFailed(makeRefundEvent());

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'ct-pay-1',
          transaction: expect.objectContaining({
            type: 'Refund',
            state: 'Failure',
            interactionId: 'pyr_1',
            amount: { centAmount: 5000, currencyCode: 'EUR' },
          }),
        }),
      );
    });

    test('routes on the refund metadata, since a Refund does not inherit PaymentIntent metadata', async () => {
      // Measured: a real refund.updated carries metadata: {}. refundPayment stamps the id at creation;
      // without that stamp there is nothing to route on.
      const updateMock = jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue({} as Payment);

      await stripePaymentService.processStripeEventRefundFailed(makeRefundEvent({ metadata: {} }));

      expect(updateMock).not.toHaveBeenCalled();
    });

    test('rethrows a commercetools failure instead of returning 200', async () => {
      // Swallowing here would stop Stripe redelivering, leaving the payment claiming a refund that
      // never happened. Deliberately unlike processStripeEventRefunded (KI-031).
      jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockRejectedValue(new Error('CT down'));

      await expect(stripePaymentService.processStripeEventRefundFailed(makeRefundEvent())).rejects.toThrow('CT down');
    });

    test('carries the canceled status through as a failure too', async () => {
      const updateMock = jest.spyOn(DefaultPaymentService.prototype, 'updatePayment').mockResolvedValue({} as Payment);

      await stripePaymentService.processStripeEventRefundFailed(makeRefundEvent({ status: 'canceled' }));

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ transaction: expect.objectContaining({ state: 'Failure' }) }),
      );
    });
  });

  describe('method processStripeEventRefunded', () => {
    test('should process refund event successfully and update payment with refund details', async () => {
      const mockEvent: Stripe.Event = {
        id: 'evt_refund_123',
        object: 'event',
        type: 'charge.refunded',
        created: Date.now(),
        api_version: '2024-04-10',
        livemode: false,
        pending_webhooks: 0,
        request: null,
        data: {
          object: {
            id: 'ch_123',
            object: 'charge',
            amount: 50000,
            currency: 'usd',
            created: Date.now(),
          } as Stripe.Charge,
        },
      } as Stripe.Event;

      const mockUpdateData = {
        id: 'paymentId',
        pspReference: 'ch_123',
        paymentMethod: 'card',
        transactions: [
          {
            type: PaymentTransactions.REFUND,
            state: PaymentStatus.SUCCESS,
            amount: { centAmount: 50000, currencyCode: 'USD' },
            interactionId: 'ch_123',
          },
        ],
      };

      const mockRefund = {
        id: 're_123',
        amount: 50000,
        currency: 'usd',
        charge: 'ch_123',
        created: Date.now(),
        status: 'succeeded',
      } as Stripe.Refund;

      const mockStripeEventConverter = jest
        .spyOn(StripeEventConverter.prototype, 'convert')
        .mockReturnValue(mockUpdateData);

      const mockRefundsList = jest.spyOn(Stripe.prototype.refunds, 'list').mockResolvedValue({
        data: [mockRefund],
        has_more: false,
        object: 'list',
        url: '/v1/refunds',
      } as Stripe.ApiList<Stripe.Refund> as Stripe.Response<Stripe.ApiList<Stripe.Refund>>);

      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await stripePaymentService.processStripeEventRefunded(mockEvent);

      expect(mockStripeEventConverter).toHaveBeenCalledWith(mockEvent);
      expect(mockRefundsList).toHaveBeenCalledWith({
        charge: 'ch_123' as string,
        created: {
          gte: mockEvent.data.object.created as number,
        },
        limit: 2,
      });
      expect(updatePaymentMock).toHaveBeenCalledTimes(1);

      // Verify the refund details were updated correctly
      const updateCall = updatePaymentMock.mock.calls[0][0];
      expect(updateCall.pspReference).toBe('re_123');
      expect(updateCall.transaction?.interactionId).toBe('re_123');
      expect(updateCall.transaction?.amount.centAmount).toBe(50000);
      expect(updateCall.transaction?.amount.currencyCode).toBe('USD');
    });

    test('should handle case when no refund is found for charge', async () => {
      const mockEvent: Stripe.Event = {
        id: 'evt_refund_123',
        object: 'event',
        type: 'charge.refunded',
        created: Date.now(),
        api_version: '2024-04-10',
        livemode: false,
        pending_webhooks: 0,
        request: null,
        data: {
          object: {
            id: 'ch_123',
            object: 'charge',
            amount: 50000,
            currency: 'usd',
            created: Date.now(),
          } as Stripe.Charge,
        },
      } as Stripe.Event;

      const mockUpdateData = {
        id: 'paymentId',
        pspReference: 'ch_123',
        paymentMethod: 'card',
        transactions: [
          {
            type: PaymentTransactions.REFUND,
            state: PaymentStatus.SUCCESS,
            amount: { centAmount: 50000, currencyCode: 'USD' },
            interactionId: 'ch_123',
          },
        ],
      };

      const mockStripeEventConverter = jest
        .spyOn(StripeEventConverter.prototype, 'convert')
        .mockReturnValue(mockUpdateData);

      const mockRefundsList = jest.spyOn(Stripe.prototype.refunds, 'list').mockResolvedValue({
        data: [], // No refunds found
        has_more: false,
        object: 'list',
        url: '/v1/refunds',
      } as Stripe.ApiList<Stripe.Refund> as Stripe.Response<Stripe.ApiList<Stripe.Refund>>);

      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await stripePaymentService.processStripeEventRefunded(mockEvent);

      expect(mockStripeEventConverter).toHaveBeenCalledWith(mockEvent);
      expect(mockRefundsList).toHaveBeenCalled();
      expect(updatePaymentMock).not.toHaveBeenCalled();
      expect(Logger.log.warn).toHaveBeenCalledWith('No refund found for charge', { chargeId: 'ch_123' });
    });

    test('should handle multiple transactions in updateData', async () => {
      const mockEvent: Stripe.Event = {
        id: 'evt_refund_123',
        object: 'event',
        type: 'charge.refunded',
        created: Date.now(),
        api_version: '2024-04-10',
        livemode: false,
        pending_webhooks: 0,
        request: null,
        data: {
          object: {
            id: 'ch_123',
            object: 'charge',
            amount: 50000,
            currency: 'usd',
            created: Date.now(),
          } as Stripe.Charge,
        },
      } as Stripe.Event;

      const mockUpdateData = {
        id: 'paymentId',
        pspReference: 'ch_123',
        paymentMethod: 'card',
        transactions: [
          {
            type: PaymentTransactions.REFUND,
            state: PaymentStatus.SUCCESS,
            amount: { centAmount: 50000, currencyCode: 'USD' },
            interactionId: 'ch_123',
          },
          {
            type: PaymentTransactions.REFUND,
            state: PaymentStatus.PENDING,
            amount: { centAmount: 25000, currencyCode: 'USD' },
            interactionId: 'ch_123',
          },
        ],
      };

      const mockRefund = {
        id: 're_123',
        amount: 50000,
        currency: 'usd',
        charge: 'ch_123',
        created: Date.now(),
        status: 'succeeded',
      } as Stripe.Refund;

      const mockStripeEventConverter = jest
        .spyOn(StripeEventConverter.prototype, 'convert')
        .mockReturnValue(mockUpdateData);

      const mockRefundsList = jest.spyOn(Stripe.prototype.refunds, 'list').mockResolvedValue({
        data: [mockRefund],
        has_more: false,
        object: 'list',
        url: '/v1/refunds',
      } as Stripe.ApiList<Stripe.Refund> as Stripe.Response<Stripe.ApiList<Stripe.Refund>>);

      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await stripePaymentService.processStripeEventRefunded(mockEvent);

      expect(mockStripeEventConverter).toHaveBeenCalledWith(mockEvent);
      expect(mockRefundsList).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalledTimes(2); // Called for each transaction

      // Verify both transactions were updated with refund details
      const updateCalls = updatePaymentMock.mock.calls;
      expect(updateCalls[0][0].pspReference).toBe('re_123');
      expect(updateCalls[0][0].transaction?.interactionId).toBe('re_123');
      expect(updateCalls[0][0].transaction?.amount.centAmount).toBe(50000);

      expect(updateCalls[1][0].pspReference).toBe('re_123');
      expect(updateCalls[1][0].transaction?.interactionId).toBe('re_123');
      expect(updateCalls[1][0].transaction?.amount.centAmount).toBe(50000);
    });

    test('should handle error during refund processing gracefully', async () => {
      const mockEvent: Stripe.Event = {
        id: 'evt_refund_123',
        object: 'event',
        type: 'charge.refunded',
        created: Date.now(),
        api_version: '2024-04-10',
        livemode: false,
        pending_webhooks: 0,
        request: null,
        data: {
          object: {
            id: 'ch_123',
            object: 'charge',
            amount: 50000,
            currency: 'usd',
            created: Date.now(),
          } as Stripe.Charge,
        },
      } as Stripe.Event;

      const mockUpdateData = {
        id: 'paymentId',
        pspReference: 'ch_123',
        paymentMethod: 'card',
        transactions: [
          {
            type: PaymentTransactions.REFUND,
            state: PaymentStatus.SUCCESS,
            amount: { centAmount: 50000, currencyCode: 'USD' },
            interactionId: 'ch_123',
          },
        ],
      };

      const mockStripeEventConverter = jest
        .spyOn(StripeEventConverter.prototype, 'convert')
        .mockReturnValue(mockUpdateData);

      const mockRefundsList = jest
        .spyOn(Stripe.prototype.refunds, 'list')
        .mockRejectedValue(new Error('Stripe API error'));

      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await stripePaymentService.processStripeEventRefunded(mockEvent);

      expect(mockStripeEventConverter).toHaveBeenCalledWith(mockEvent);
      expect(mockRefundsList).toHaveBeenCalled();
      expect(updatePaymentMock).not.toHaveBeenCalled();
      expect(Logger.log.error).toHaveBeenCalledWith('Error processing refund notification', {
        error: expect.any(Error),
      });
    });

    test('should handle error during payment update gracefully', async () => {
      const mockEvent: Stripe.Event = {
        id: 'evt_refund_123',
        object: 'event',
        type: 'charge.refunded',
        created: Date.now(),
        api_version: '2024-04-10',
        livemode: false,
        pending_webhooks: 0,
        request: null,
        data: {
          object: {
            id: 'ch_123',
            object: 'charge',
            amount: 50000,
            currency: 'usd',
            created: Date.now(),
          } as Stripe.Charge,
        },
      } as Stripe.Event;

      const mockUpdateData = {
        id: 'paymentId',
        pspReference: 'ch_123',
        paymentMethod: 'card',
        transactions: [
          {
            type: PaymentTransactions.REFUND,
            state: PaymentStatus.SUCCESS,
            amount: { centAmount: 50000, currencyCode: 'USD' },
            interactionId: 'ch_123',
          },
        ],
      };

      const mockRefund = {
        id: 're_123',
        amount: 50000,
        currency: 'usd',
        charge: 'ch_123',
        created: Date.now(),
        status: 'succeeded',
      } as Stripe.Refund;

      const mockStripeEventConverter = jest
        .spyOn(StripeEventConverter.prototype, 'convert')
        .mockReturnValue(mockUpdateData);

      const mockRefundsList = jest.spyOn(Stripe.prototype.refunds, 'list').mockResolvedValue({
        data: [mockRefund],
        has_more: false,
        object: 'list',
        url: '/v1/refunds',
      } as Stripe.ApiList<Stripe.Refund> as Stripe.Response<Stripe.ApiList<Stripe.Refund>>);

      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockRejectedValue(new Error('Payment update failed'));

      await stripePaymentService.processStripeEventRefunded(mockEvent);

      expect(mockStripeEventConverter).toHaveBeenCalledWith(mockEvent);
      expect(mockRefundsList).toHaveBeenCalled();
      expect(updatePaymentMock).toHaveBeenCalled();
      expect(Logger.log.error).toHaveBeenCalledWith('Error processing refund notification', {
        error: expect.any(Error),
      });
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

  describe('method processSubscriptionEventPaid', () => {
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

      await subscriptionService.processSubscriptionEventPaid(mockEvent);

      const mockedInvoice = mockEvent.data.object as Stripe.Invoice;
      const mockedSubscription = (mockedInvoice as any).parent?.subscription_details
        ?.subscription as Stripe.Subscription;
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
      // Recurring cycle: first-cycle invoices (subscription_create) no longer take the clone-order path
      const mockRecurringInvoiceExpanded = {
        ...mockStripeInvoicesRetrievedExpanded,
        billing_reason: 'subscription_cycle' as Stripe.Invoice.BillingReason,
      };
      const spiedStripeInvoiceExpandedMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockReturnValue(Promise.resolve(mockRecurringInvoiceExpanded));
      const spiedPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      const spiedFindPaymentInterfaceIdMock = jest
        .spyOn(DefaultPaymentService.prototype, 'findPaymentsByInterfaceId')
        .mockResolvedValue([]);
      const spiedHasTransactionInState = jest
        .spyOn(DefaultPaymentService.prototype, 'hasTransactionInState')
        .mockReturnValue(false);
      const spiedHandleSubscriptionPaymentCreateNewOrder = jest
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .spyOn(StripeSubscriptionService.prototype as any, 'handleSubscriptionPaymentCreateNewOrder')
        .mockResolvedValue(undefined);
      const spiedUpdatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await subscriptionService.processSubscriptionEventPaid(mockEvent);

      expect(spiedStripeInvoiceExpandedMock).toHaveBeenCalledWith((mockEvent.data.object as Stripe.Invoice).id);
      expect(spiedPaymentMock).toHaveBeenCalled();
      expect(spiedFindPaymentInterfaceIdMock).toHaveBeenCalled();
      expect(spiedHasTransactionInState).toHaveBeenCalledWith({
        payment: mockGetPaymentResult,
        transactionType: 'Charge',
        states: ['Pending'],
      });

      expect(spiedHandleSubscriptionPaymentCreateNewOrder).toHaveBeenCalledWith(
        expect.any(Object),
        mockRecurringInvoiceExpanded,
        expect.objectContaining({
          paymentMethod: expect.any(String),
          pspReference: expect.any(String),
          transactions: expect.any(Array),
        }),
        'Paid',
      );

      expect(spiedUpdatePaymentMock).toHaveBeenCalled();
    });

    test('should process subscription invoice.paid successfully creating a update in the current payment', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      jest.spyOn(Config, 'getConfig').mockReturnValue({
        ...Config.getConfig(),
        subscriptionPaymentHandling: 'addPaymentToOrder',
      } as ReturnType<typeof Config.getConfig>);

      const mockEvent: Stripe.Event = mockEvent__invoice_paid__Expanded_Paymnet_intent__amount_paid;
      const mockedCart = mockGetCartResult();
      // Recurring cycle: first-cycle invoices (subscription_create) no longer take the add-to-order path
      const mockRecurringInvoiceExpanded = {
        ...mockStripeInvoicesRetrievedExpanded,
        billing_reason: 'subscription_cycle' as Stripe.Invoice.BillingReason,
      };
      const spiedStripeInvoiceExpandedMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'getStripeInvoiceExpanded')
        .mockReturnValue(Promise.resolve(mockRecurringInvoiceExpanded));
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
      const spiedHandleSubscriptionPaymentAddToOrder = jest
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .spyOn(StripeSubscriptionService.prototype as any, 'handleSubscriptionPaymentAddToOrder')
        .mockResolvedValue(undefined);
      const spiedUpdatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await subscriptionService.processSubscriptionEventPaid(mockEvent);

      expect(spiedStripeInvoiceExpandedMock).toHaveBeenCalledWith((mockEvent.data.object as Stripe.Invoice).id);
      expect(spiedPaymentMock).toHaveBeenCalled();
      expect(spiedFindPaymentInterfaceIdMock).toHaveBeenCalled();
      expect(spiedHasTransactionInState).toHaveBeenCalledWith({
        payment: mockGetPaymentResult,
        transactionType: 'Charge',
        states: ['Pending'],
      });

      expect(spiedGetCartMock).toHaveBeenCalled();
      expect(spiedHandleCtPaymentSubscription).toHaveBeenCalledWith({
        cart: mockedCart,
        amountPlanned: expect.objectContaining({
          currencyCode: 'USD',
          centAmount: expect.any(Number),
        }),
        interactionId: expect.any(String),
      });
      expect(spiedHandleSubscriptionPaymentAddToOrder).toHaveBeenCalled();
      expect(spiedUpdatePaymentMock).toHaveBeenCalled();
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

      await subscriptionService.processSubscriptionEventPaid(mockEvent);

      const mockedInvoice = mockEvent.data.object as Stripe.Invoice;
      const mockedSubscription = (mockedInvoice as any).parent?.subscription_details
        ?.subscription as Stripe.Subscription;
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

  describe('method processSubscriptionEventFailed', () => {
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

      await subscriptionService.processSubscriptionEventFailed(mockEvent);

      const mockedInvoice = mockEvent.data.object as Stripe.Invoice;
      const mockedSubscription = (mockedInvoice as any).parent?.subscription_details
        ?.subscription as Stripe.Subscription;
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

  describe('method processSubscriptionEventUpcoming', () => {
    test('should process subscription invoice.upcoming successfully creating an update in the upcoming payment', async () => {
      const mockEvent: Stripe.Event = mockEvent__invoice_paid__Expanded_Paymnet_intent__amount_paid;
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
      const spiedHandleSubscriptionPaymentCreateNewOrder = jest
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .spyOn(StripeSubscriptionService.prototype as any, 'handleSubscriptionPaymentCreateNewOrder')
        .mockResolvedValue(undefined);
      const spiedUpdatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));

      await subscriptionService.processSubscriptionEventUpcoming(mockEvent);

      // The processSubscriptionEventUpcoming method doesn't call getStripeInvoiceExpanded
      // It only retrieves the subscription and synchronizes price
      expect(spiedStripeInvoiceExpandedMock).not.toHaveBeenCalled();
      expect(spiedPaymentMock).not.toHaveBeenCalled();
      expect(spiedFindPaymentInterfaceIdMock).not.toHaveBeenCalled();
      expect(spiedHasTransactionInState).not.toHaveBeenCalled();
      expect(spiedHandleSubscriptionPaymentCreateNewOrder).not.toHaveBeenCalled();
      expect(spiedUpdatePaymentMock).not.toHaveBeenCalled();
    });
  });

  describe('method processSubscriptionEventChargedRefund', () => {
    test('should process subscription charge.succeeded successfully creating an update in the payment', async () => {
      // Use the correct mock event type for processSubscriptionEventCharged (charge.succeeded)
      const mockEvent: Stripe.Event = mockEvent__charge_succeeded__with_invoice;
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

      await subscriptionService.processSubscriptionEventCharged(mockEvent);

      // The charge event contains invoice ID as string, which is used to retrieve the expanded invoice
      const mockedCharge = mockEvent.data.object as Stripe.Charge;
      expect(spiedStripeInvoiceExpandedMock).toHaveBeenCalledWith(mockedCharge.invoice);

      // The expanded invoice contains the subscription with metadata
      const mockedSubscription = (mockStripeInvoicesRetrievedExpanded as any).parent?.subscription_details
        ?.subscription as Stripe.Subscription;
      expect(spiedPaymentMock).toHaveBeenCalled();
      expect(spiedPaymentMock).toHaveBeenCalledWith({
        id: mockedSubscription.metadata.ct_payment_id,
      });

      // The idempotency guard in handleSubscriptionPaymentCreateNewOrder looks up existing payments
      // by the cycle PaymentIntent before cloning; the payment id resolution itself still comes from
      // subscription metadata (not this lookup).
      expect(spiedFindPaymentInterfaceIdMock).toHaveBeenCalled();

      expect(spiedHasTransactionInState).toHaveBeenCalled();
      expect(spiedHasTransactionInState.mock.calls[0][0]).toMatchObject({
        payment: mockGetPaymentResult,
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
          expect(updateData.transaction.amount.centAmount).toBe(mockStripeInvoicesRetrievedExpanded.amount_paid);
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
      } as Stripe.Charge;

      // Mock the expected cart update actions
      const expectedActions = [
        {
          action: 'setShippingAddress' as const,
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

      // Mock updateCartById function
      const updateCartByIdMock = jest
        .spyOn(CartClient, 'updateCartById')
        .mockResolvedValue({ ...mockCart, shippingAddress: expectedActions[0].address });

      // Call the method
      const result = await stripePaymentService.updateCartAddress(mockCharge, mockCart);

      // Verify cart update was called with correct actions
      expect(updateCartByIdMock).toHaveBeenCalledWith(mockCart, expectedActions);

      // Verify returned cart
      expect(result).toEqual({ ...mockCart, shippingAddress: expectedActions[0].address });
    });

    test('should use billing details when shipping is not available', async () => {
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
      } as Stripe.Charge;

      // Mock the expected cart update actions using billing details
      const expectedActions = [
        {
          action: 'setShippingAddress' as const,
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

      // Mock updateCartById function
      const updateCartByIdMock = jest
        .spyOn(CartClient, 'updateCartById')
        .mockResolvedValue({ ...mockCart, shippingAddress: expectedActions[0].address });

      // Call the method
      const result = await stripePaymentService.updateCartAddress(mockCharge, mockCart);

      // Verify cart update was called with correct actions
      expect(updateCartByIdMock).toHaveBeenCalledWith(mockCart, expectedActions);

      // Verify returned cart
      expect(result).toEqual({ ...mockCart, shippingAddress: expectedActions[0].address });
    });

    test('should return cart unchanged when address details are missing', async () => {
      const mockCart = mockGetCartResult();

      // Mock charge with minimal details (incomplete address)
      const mockCharge = {
        billing_details: {
          // No name
          address: {
            // No details - missing required fields: country, state, city, postal_code, line1
          },
        },
        // No shipping property
      } as Stripe.Charge;

      // Mock updateCartById function
      const updateCartByIdMock = jest.spyOn(CartClient, 'updateCartById');

      // Call the method
      const result = await stripePaymentService.updateCartAddress(mockCharge, mockCart);

      // Verify updateCartById was NOT called (incomplete address should not trigger an update)
      expect(updateCartByIdMock).not.toHaveBeenCalled();

      // Verify returned cart is the original cart unchanged
      expect(result).toEqual(mockCart);
    });
  });
});
