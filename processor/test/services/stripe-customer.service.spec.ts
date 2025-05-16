import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { DefaultCartService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-cart.service';
import { Cart, Customer, ClientResponse } from '@commercetools/platform-sdk';
import { paymentSDK } from '../../src/payment-sdk';
import { mockGetCartResult, mockGetCartWithoutCustomerIdResult } from '../utils/mock-cart-data';
import {
  mockCreateSessionResult,
  mockCtCustomerData,
  mockCtCustomerId,
  mockCustomerData,
  mockEphemeralKeyResult,
  mockEphemeralKeySecret,
  mockSearchCustomerResponse,
  mockStripeCustomerId,
} from '../utils/mock-customer-data';
import { StripeCustomerService } from '../../src/services/stripe-customer.service';
import { mock_SetCustomTypeActions } from '../utils/mock-actions-data';
import * as Logger from '../../src/libs/logger/index';
import * as CustomerClient from '../../src/services/commerce-tools/customer-client';
import * as CustomTypeHelper from '../../src/services/commerce-tools/custom-type-helper';

jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {}),
}));
jest.mock('../../src/libs/logger');

describe('stripe-customer.service', () => {
  const ctCartService = paymentSDK.ctCartService;
  const stripeCustomerService: StripeCustomerService = new StripeCustomerService(ctCartService);

  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
    Stripe.prototype.customers = {
      create: jest.fn(),
      retrieve: jest.fn(),
      search: jest.fn(),
    } as unknown as Stripe.CustomersResource;
    Stripe.prototype.ephemeralKeys = {
      create: jest.fn(),
    } as unknown as Stripe.EphemeralKeysResource;
    Stripe.prototype.customerSessions = {
      create: jest.fn(),
    } as unknown as Stripe.CustomerSessionsResource;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('method getCustomerSession', () => {
    test('should return the customer session', async () => {
      const getCartMock = jest
        .spyOn(DefaultCartService.prototype, 'getCart')
        .mockReturnValue(Promise.resolve(mockGetCartResult()));
      const getCtCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'getCtCustomer')
        .mockResolvedValue(mockCtCustomerData);
      const retrieveOrCreateStripeCustomerIdMock = jest
        .spyOn(StripeCustomerService.prototype, 'retrieveOrCreateStripeCustomerId')
        .mockResolvedValue(mockStripeCustomerId);
      const createEphemeralKeyMock = jest
        .spyOn(StripeCustomerService.prototype, 'createEphemeralKey')
        .mockResolvedValue(mockEphemeralKeySecret);
      const createSessionMock = jest
        .spyOn(StripeCustomerService.prototype, 'createSession')
        .mockResolvedValue(mockCreateSessionResult);

      const result = await stripeCustomerService.getCustomerSession();

      expect(result).toStrictEqual({
        stripeCustomerId: mockStripeCustomerId,
        ephemeralKey: mockEphemeralKeySecret,
        sessionId: mockCreateSessionResult.client_secret,
      });
      expect(result).toBeDefined();
      expect(getCartMock).toHaveBeenCalled();
      expect(getCtCustomerMock).toHaveBeenCalled();
      expect(retrieveOrCreateStripeCustomerIdMock).toHaveBeenCalled();
      expect(createEphemeralKeyMock).toHaveBeenCalled();
      expect(createSessionMock).toHaveBeenCalled();
    });

    test('should return and skip customer creation', async () => {
      const getCartMock = jest
        .spyOn(DefaultCartService.prototype, 'getCart')
        .mockReturnValue(Promise.resolve(mockGetCartWithoutCustomerIdResult()));

      await stripeCustomerService.getCustomerSession();

      expect(Logger.log.warn).toBeCalled();
      expect(getCartMock).toHaveBeenCalled();
    });

    test('should fail to find customer and return', async () => {
      const getCartMock = jest.spyOn(DefaultCartService.prototype, 'getCart').mockResolvedValue(mockGetCartResult());
      const getCtCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'getCtCustomer')
        .mockResolvedValue(undefined);

      await stripeCustomerService.getCustomerSession();

      expect(Logger.log.info).toBeCalled();
      expect(getCartMock).toHaveBeenCalled();
      expect(getCtCustomerMock).toHaveBeenCalled();
    });

    test('should fail to get stripe customer id', async () => {
      const getCartMock = jest
        .spyOn(DefaultCartService.prototype, 'getCart')
        .mockReturnValue(Promise.resolve(mockGetCartResult()));
      const getCtCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'getCtCustomer')
        .mockResolvedValue(mockCtCustomerData);
      const retrieveOrCreateStripeCustomerIdMock = jest
        .spyOn(StripeCustomerService.prototype, 'retrieveOrCreateStripeCustomerId')
        .mockResolvedValue(undefined);

      try {
        await stripeCustomerService.getCustomerSession();
      } catch (e) {
        expect(e).toStrictEqual('Failed to get stripe customer id.');
      }

      expect(getCartMock).toHaveBeenCalled();
      expect(getCtCustomerMock).toHaveBeenCalled();
      expect(retrieveOrCreateStripeCustomerIdMock).toHaveBeenCalled();
    });

    test('should fail to create ephemeral key', async () => {
      const getCartMock = jest
        .spyOn(DefaultCartService.prototype, 'getCart')
        .mockReturnValue(Promise.resolve(mockGetCartResult()));
      const getCtCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'getCtCustomer')
        .mockResolvedValue(mockCtCustomerData);
      const getStripeCustomerIdMock = jest
        .spyOn(StripeCustomerService.prototype, 'retrieveOrCreateStripeCustomerId')
        .mockResolvedValue(mockStripeCustomerId);
      const createEphemeralKeyMock = jest
        .spyOn(StripeCustomerService.prototype, 'createEphemeralKey')
        .mockResolvedValue(undefined);

      try {
        await stripeCustomerService.getCustomerSession();
      } catch (e) {
        expect(e).toStrictEqual('Failed to create ephemeral key.');
      }

      expect(getCartMock).toHaveBeenCalled();
      expect(getCtCustomerMock).toHaveBeenCalled();
      expect(getStripeCustomerIdMock).toHaveBeenCalled();
      expect(createEphemeralKeyMock).toHaveBeenCalled();
    });

    test('should fail to create session', async () => {
      const getCartMock = jest
        .spyOn(DefaultCartService.prototype, 'getCart')
        .mockReturnValue(Promise.resolve(mockGetCartResult()));
      const getCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'getCtCustomer')
        .mockResolvedValue(mockCtCustomerData);
      const getStripeCustomerIdMock = jest
        .spyOn(StripeCustomerService.prototype, 'retrieveOrCreateStripeCustomerId')
        .mockResolvedValue(mockStripeCustomerId);
      const createEphemeralKeyMock = jest
        .spyOn(StripeCustomerService.prototype, 'createEphemeralKey')
        .mockResolvedValue(mockEphemeralKeySecret);
      const createSessionMock = jest
        .spyOn(StripeCustomerService.prototype, 'createSession')
        .mockResolvedValue(undefined);

      try {
        await stripeCustomerService.getCustomerSession();
      } catch (e) {
        expect(e).toStrictEqual('Failed to create session.');
      }

      expect(getCartMock).toHaveBeenCalled();
      expect(getCustomerMock).toHaveBeenCalled();
      expect(getStripeCustomerIdMock).toHaveBeenCalled();
      expect(createEphemeralKeyMock).toHaveBeenCalled();
      expect(createSessionMock).toHaveBeenCalled();
    });
  });

  describe('method retrieveOrCreateStripeCustomerId', () => {
    test('should have passed a valid stripe customer id', async () => {
      const cart = mockGetCartResult();
      const validateStripeCustomerIdMock = jest
        .spyOn(StripeCustomerService.prototype, 'validateStripeCustomerId')
        .mockResolvedValue(true);
      const result = await stripeCustomerService.retrieveOrCreateStripeCustomerId(
        cart,
        mockCtCustomerData,
        mockStripeCustomerId,
      );

      expect(result).toStrictEqual(mockStripeCustomerId);
      expect(result).toBeDefined();
      expect(validateStripeCustomerIdMock).toHaveBeenCalled();
    });

    test('should have a valid stripe customer id in custom field', async () => {
      const cart = mockGetCartResult();
      const validateStripeCustomerIdMock = jest
        .spyOn(StripeCustomerService.prototype, 'validateStripeCustomerId')
        .mockResolvedValue(true);

      const result = await stripeCustomerService.retrieveOrCreateStripeCustomerId(cart, mockCtCustomerData);

      expect(result).toStrictEqual(mockStripeCustomerId);
      expect(result).toBeDefined();
      expect(validateStripeCustomerIdMock).toHaveBeenCalled();
    });

    test('should save stripe customer id successfully', async () => {
      const cart = mockGetCartResult();
      const validateStripeCustomerIdMock = jest
        .spyOn(StripeCustomerService.prototype, 'validateStripeCustomerId')
        .mockResolvedValue(true);

      const result = await stripeCustomerService.retrieveOrCreateStripeCustomerId(cart, mockCtCustomerData);

      expect(result).toStrictEqual(mockStripeCustomerId);
      expect(result).toBeDefined();
      expect(validateStripeCustomerIdMock).toHaveBeenCalled();
    });

    test('should find the Stripe customer and update the ctCustomer', async () => {
      const cart = mockGetCartResult();
      const validateStripeCustomerIdMock = jest
        .spyOn(StripeCustomerService.prototype, 'validateStripeCustomerId')
        .mockResolvedValue(false);
      const findCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'findStripeCustomer')
        .mockResolvedValue(mockCustomerData);
      const saveCustomerMock = jest.spyOn(StripeCustomerService.prototype, 'saveStripeCustomerId').mockResolvedValue();

      const result = await stripeCustomerService.retrieveOrCreateStripeCustomerId(cart, mockCtCustomerData);

      expect(result).toStrictEqual(mockStripeCustomerId);
      expect(result).toBeDefined();
      expect(validateStripeCustomerIdMock).toHaveBeenCalled();
      expect(findCustomerMock).toHaveBeenCalled();
      expect(saveCustomerMock).toHaveBeenCalled();
    });

    test('should create customer successfully', async () => {
      const cart = mockGetCartResult();
      const validateStripeCustomerIdMock = jest
        .spyOn(StripeCustomerService.prototype, 'validateStripeCustomerId')
        .mockResolvedValue(false);
      const findCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'findStripeCustomer')
        .mockResolvedValue(undefined);
      const createStripeCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'createStripeCustomer')
        .mockResolvedValue(mockCustomerData);
      const saveCustomerMock = jest.spyOn(StripeCustomerService.prototype, 'saveStripeCustomerId').mockResolvedValue();

      const result = await stripeCustomerService.retrieveOrCreateStripeCustomerId(cart, mockCtCustomerData);

      expect(result).toStrictEqual(mockStripeCustomerId);
      expect(result).toBeDefined();
      expect(validateStripeCustomerIdMock).toHaveBeenCalled();
      expect(findCustomerMock).toHaveBeenCalled();
      expect(createStripeCustomerMock).toHaveBeenCalled();
      expect(saveCustomerMock).toHaveBeenCalled();
    });

    test('should fail when creating customer', async () => {
      const cart = mockGetCartResult();
      const validateStripeCustomerIdMock = jest
        .spyOn(StripeCustomerService.prototype, 'validateStripeCustomerId')
        .mockResolvedValue(false);
      const findCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'findStripeCustomer')
        .mockResolvedValue(undefined);
      const createStripeCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'createStripeCustomer')
        .mockResolvedValue(undefined);

      try {
        await stripeCustomerService.retrieveOrCreateStripeCustomerId(cart, mockCtCustomerData);
      } catch (e) {
        expect(e).toStrictEqual('Failed to create stripe customer.');
      }

      expect(validateStripeCustomerIdMock).toHaveBeenCalled();
      expect(findCustomerMock).toHaveBeenCalled();
      expect(createStripeCustomerMock).toHaveBeenCalled();
    });
  });

  describe('method validateStripeCustomerId', () => {
    test('should validate stripe customer successfully', async () => {
      const mockRetrieveCustomer = jest
        .spyOn(Stripe.prototype.customers, 'retrieve')
        .mockResolvedValue(mockCustomerData);

      const result = await stripeCustomerService.validateStripeCustomerId(mockStripeCustomerId, mockCtCustomerId);

      expect(result).toStrictEqual(true);
      expect(result).toBeDefined();
      expect(mockRetrieveCustomer).toHaveBeenCalled();
    });

    test('should not find stripe customer, it does not exists', async () => {
      const mockRetrieveCustomer = jest
        .spyOn(Stripe.prototype.customers, 'retrieve')
        .mockReturnValue(Promise.reject(new Error('No such customer')));

      try {
        await stripeCustomerService.validateStripeCustomerId(mockStripeCustomerId, 'failedCustomerId');
      } catch (e) {
        expect(e).toStrictEqual(false);
      }
      expect(mockRetrieveCustomer).toHaveBeenCalled();
    });

    test('should fail when retrieving customer', async () => {
      const mockRetrieveCustomer = jest
        .spyOn(Stripe.prototype.customers, 'retrieve')
        .mockReturnValue(Promise.reject(new Error('Something failed')));

      try {
        await stripeCustomerService.validateStripeCustomerId(mockStripeCustomerId, 'failedCustomerId');
      } catch (e) {
        expect(e).toBeDefined();
      }
      expect(mockRetrieveCustomer).toHaveBeenCalled();
    });
  });

  describe('method findStripeCustomer', () => {
    test('should find stripe customer', async () => {
      const mockRetrieveCustomer = jest
        .spyOn(Stripe.prototype.customers, 'search')
        .mockReturnValue(Promise.resolve(mockSearchCustomerResponse) as Stripe.ApiSearchResultPromise<Stripe.Customer>);

      const result = await stripeCustomerService.findStripeCustomer(mockCtCustomerId);

      expect(result).toStrictEqual(mockCustomerData);
      expect(result).toBeDefined();
      expect(mockRetrieveCustomer).toHaveBeenCalled();
    });

    test('should fail to find stripe customer', async () => {
      const mockRetrieveCustomer = jest
        .spyOn(Stripe.prototype.customers, 'search')
        .mockReturnValue(Promise.reject() as Stripe.ApiSearchResultPromise<Stripe.Customer>);

      const result = await stripeCustomerService.findStripeCustomer(mockCtCustomerId);

      expect(result).toStrictEqual(undefined);
      expect(result).toBeUndefined();
      expect(mockRetrieveCustomer).toHaveBeenCalled();
    });

    test('should return undefined due to incorrect ctCustomerId', async () => {
      const result = await stripeCustomerService.findStripeCustomer('wrongId');
      expect(Logger.log.warn).toBeCalled();
      expect(result).toBeUndefined();
    });
  });

  describe('method createStripeCustomer', () => {
    test('should create stripe customer with Cart info', async () => {
      const mockCreateCustomer = jest
        .spyOn(Stripe.prototype.customers, 'create')
        .mockReturnValue(Promise.resolve(mockCustomerData));

      const result = await stripeCustomerService.createStripeCustomer(mockGetCartResult(), mockCtCustomerData);

      expect(result).toStrictEqual(mockCustomerData);
      expect(result).toBeDefined();
      expect(mockCreateCustomer).toHaveBeenCalled();
    });

    test('should create stripe customer with shipping address email and without metadata', async () => {
      const cart = mockGetCartResult();
      const mockCart: Cart = {
        ...cart,
        customerId: undefined,
        customerEmail: undefined,
      };
      const mockCtCustomer: Customer = {
        ...mockCtCustomerData,
        firstName: '',
        lastName: '',
        email: '',
      };
      const mockCreateCustomer = jest
        .spyOn(Stripe.prototype.customers, 'create')
        .mockReturnValue(Promise.resolve(mockCustomerData));

      const result = await stripeCustomerService.createStripeCustomer(mockCart, mockCtCustomer);

      expect(result).toStrictEqual(mockCustomerData);
      expect(result).toBeDefined();
      expect(mockCreateCustomer).toHaveBeenCalled();
    });
  });

  describe('method saveStripeCustomerId', () => {
    test('should save stripe customer id successfully', async () => {
      const getCustomFieldUpdateActionsMock = jest
        .spyOn(CustomTypeHelper, 'getCustomFieldUpdateActions')
        .mockResolvedValue(mock_SetCustomTypeActions);
      const updateCustomerByIdMock = jest
        .spyOn(CustomerClient, 'updateCustomerById')
        .mockResolvedValue(mockCtCustomerData);

      await stripeCustomerService.saveStripeCustomerId('mockStripeCustomerId', mockCtCustomerData);
      expect(getCustomFieldUpdateActionsMock).toHaveBeenCalled();
      expect(updateCustomerByIdMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalled();
    });
  });

  describe('method createSession', () => {
    test('should create stripe customer', async () => {
      const mockCreateCustomer = jest
        .spyOn(Stripe.prototype.customerSessions, 'create')
        .mockReturnValue(Promise.resolve(mockCreateSessionResult));

      const result = await stripeCustomerService.createSession(mockStripeCustomerId);

      expect(result).toStrictEqual(mockCreateSessionResult);
      expect(result).toBeDefined();
      expect(mockCreateCustomer).toHaveBeenCalled();
    });
  });

  describe('method createEphemeralKey', () => {
    test('should create ehpemeral key', async () => {
      const mockCreateEphemeralKey = jest
        .spyOn(Stripe.prototype.ephemeralKeys, 'create')
        .mockReturnValue(Promise.resolve(mockEphemeralKeyResult));

      const result = await stripeCustomerService.createEphemeralKey(mockStripeCustomerId);

      expect(result).toStrictEqual(mockEphemeralKeySecret);
      expect(result).toBeDefined();
      expect(mockCreateEphemeralKey).toHaveBeenCalled();
    });
  });

  describe('method getCtCustomer', () => {
    test('should return ct customer successfully', async () => {
      const mockCtCustomerResponse: ClientResponse<Customer> = {
        body: mockCtCustomerData,
        statusCode: 200,
        headers: {},
      };
      const executeMock = jest.fn<() => Promise<ClientResponse<Customer>>>().mockResolvedValue(mockCtCustomerResponse);
      const client = paymentSDK.ctAPI.client;
      client.customers = jest.fn(() => ({
        withId: jest.fn(() => ({
          get: jest.fn(() => ({
            execute: executeMock,
          })),
        })),
      })) as never;

      const result = await stripeCustomerService.getCtCustomer(mockCtCustomerId);

      expect(executeMock).toHaveBeenCalled();
      expect(result).toEqual(mockCtCustomerData);
    });
  });

  describe('method getStripeAddress', () => {
    test('should return stripe address successfully', async () => {
      const result = await stripeCustomerService.getStripeCustomerAddress(
        mockGetCartResult().shippingAddress,
        mockCtCustomerData.addresses[0],
      );
      expect(result).toStrictEqual(mockCustomerData.shipping);
    });

    test('should return stripe address successfully with mobile', async () => {
      const cart = mockGetCartResult();
      const mockCartData: Cart = {
        ...cart,
        shippingAddress: {
          ...cart.shippingAddress,
          phone: undefined,
          mobile: '+312345678',
          country: 'US',
        },
      };
      const result = await stripeCustomerService.getStripeCustomerAddress(
        mockCartData.shippingAddress,
        mockCtCustomerData.addresses[0],
      );
      expect(result).toStrictEqual(mockCustomerData.shipping);
    });

    test('should return undefined', async () => {
      const result = await stripeCustomerService.getStripeCustomerAddress(undefined, undefined);
      expect(result).toBeUndefined();
    });
  });

  describe('method getBillingAddress', () => {
    test('should return billing address successfully', async () => {
      const result = await stripeCustomerService.getBillingAddress(mockGetCartResult());
      expect(result).toBeDefined();
    });

    test('should return empty string values', async () => {
      const cart = mockGetCartResult();
      const mockCart = {
        ...cart,
        shippingAddress: {
          ...cart.shippingAddress,
          city: undefined,
        },
      };
      const result = await stripeCustomerService.getBillingAddress(mockCart as Cart);
      expect(result).toBeDefined();
    });

    test('should return undefined', async () => {
      const mockCart: Cart = { ...mockGetCartResult(), shippingAddress: undefined, billingAddress: undefined };
      const result = await stripeCustomerService.getBillingAddress(mockCart);
      expect(result).toBeUndefined();
    });
  });
});
