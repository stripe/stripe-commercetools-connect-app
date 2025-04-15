import Stripe from 'stripe';
import { describe, test, expect, jest, afterEach, beforeEach } from '@jest/globals';
import * as Actions from '../../src/connectors/actions';
import * as Logger from '../../src/libs/logger';
import {
  mock_CustomType_withFieldDefinition,
  mock_CustomType_withLaunchpadPurchaseOrderNumber,
  mock_Stripe_retrieveWebhookEnpoints_response,
  mock_Stripe_updateWebhookEnpoints_response,
} from '../utils/mock-actions-data';
import * as CustomTypeHelper from '../../src/helpers/customTypeHelper';
import { paymentSDK } from '../../src/payment-sdk';
import { createLaunchpadPurchaseOrderNumberCustomType } from '../../src/connectors/actions';

jest.mock('../../src/libs/logger');
jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    webhookEndpoints: {
      retrieve: jest
        .fn<() => Promise<Stripe.Response<Stripe.WebhookEndpoint>>>()
        .mockResolvedValue(mock_Stripe_retrieveWebhookEnpoints_response),
      update: jest
        .fn<() => Promise<Stripe.Response<Stripe.WebhookEndpoint>>>()
        .mockResolvedValue(mock_Stripe_updateWebhookEnpoints_response),
    },
  })),
}));

describe('Actions test', () => {
  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('retrieveWebhookEndpoint', () => {
    test('should retrieve webhook endpoint information successfully', async () => {
      Stripe.prototype.webhookEndpoints = {
        retrieve: jest.fn(),
      } as unknown as Stripe.WebhookEndpointsResource;
      jest
        .spyOn(Stripe.prototype.webhookEndpoints, 'retrieve')
        .mockResolvedValue(mock_Stripe_retrieveWebhookEnpoints_response);

      const result = await Actions.retrieveWebhookEndpoint('we-11111');

      expect(Logger.log.info).toHaveBeenCalled();
      expect(Stripe.prototype.webhookEndpoints.retrieve).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    test('should throw an error when Stripe throws an error', async () => {
      Stripe.prototype.webhookEndpoints = {
        retrieve: jest.fn(),
      } as unknown as Stripe.WebhookEndpointsResource;
      jest.spyOn(Stripe.prototype.webhookEndpoints, 'retrieve').mockImplementation(() => {
        throw new Error('error');
      });

      await Actions.retrieveWebhookEndpoint('we-11111');

      expect(Logger.log.info).toHaveBeenCalled();
      expect(Logger.log.error).toHaveBeenCalled();
    });
  });

  describe('updateWebhookEndpoint', () => {
    test('should update webhook endpoint URL successfully', async () => {
      Stripe.prototype.webhookEndpoints = {
        update: jest.fn(),
      } as unknown as Stripe.WebhookEndpointsResource;
      jest
        .spyOn(Stripe.prototype.webhookEndpoints, 'update')
        .mockResolvedValue(mock_Stripe_updateWebhookEnpoints_response);

      await Actions.updateWebhookEndpoint('we_11111', 'https://myApp.com/stripe/webhooks');

      expect(Logger.log.info).toHaveBeenCalled();
      expect(Stripe.prototype.webhookEndpoints.update).toHaveBeenCalled();
    });

    test('should throw an error when Stripe throws an error', async () => {
      Stripe.prototype.webhookEndpoints = {
        update: jest.fn(),
      } as unknown as Stripe.WebhookEndpointsResource;
      jest.spyOn(Stripe.prototype.webhookEndpoints, 'update').mockImplementation(() => {
        throw new Error('error');
      });

      await Actions.updateWebhookEndpoint('we_11111', 'https://myApp.com/stripe/webhooks');

      expect(Logger.log.info).toHaveBeenCalled();
      expect(Logger.log.error).toHaveBeenCalled();
    });
  });

  describe('ensureStripeCustomTypeForCustomer', () => {
    test('should not create Stripe custom type already exist', async () => {
      const mockGetTypeByKey = jest
        .spyOn(CustomTypeHelper, 'getTypeByKey')
        .mockResolvedValue(mock_CustomType_withFieldDefinition);

      await Actions.createStripeCustomTypeForCustomer();

      expect(Logger.log.info).toHaveBeenCalledTimes(1);
      expect(mockGetTypeByKey).toHaveBeenCalled();
    });

    test('should create Stripe custom type', async () => {
      const mockGetTypeByKey = jest.spyOn(CustomTypeHelper, 'getTypeByKey').mockResolvedValue(undefined);
      const mockCreateCustomerCustomType = jest.spyOn(CustomTypeHelper, 'createCustomerCustomType').mockResolvedValue();

      await Actions.createStripeCustomTypeForCustomer();

      expect(Logger.log.info).toHaveBeenCalledTimes(2);
      expect(mockGetTypeByKey).toHaveBeenCalled();
      expect(mockCreateCustomerCustomType).toHaveBeenCalled();
    });

    test('should throw an error ', async () => {
      const mockGetTypeByKey = jest.spyOn(CustomTypeHelper, 'getTypeByKey').mockResolvedValue(undefined);
      const mockCreateCustomerCustomType = jest
        .spyOn(CustomTypeHelper, 'createCustomerCustomType')
        .mockRejectedValue(new Error('error'));

      await expect(async () => {
        await Actions.createStripeCustomTypeForCustomer();
      }).rejects.toThrow();
      expect(Logger.log.info).toHaveBeenCalledTimes(2);
      expect(Logger.log.error).toHaveBeenCalledTimes(1);
      expect(mockGetTypeByKey).toHaveBeenCalled();
      expect(mockCreateCustomerCustomType).toHaveBeenCalled();
    });
  });

  describe('createLaunchpadPurchaseOrderNumberCustomType', () => {
    it('should log the founded purchase order number custom type', async () => {
      const executeMock = jest
        .fn()
        .mockReturnValue(Promise.resolve({ body: { results: [mock_CustomType_withLaunchpadPurchaseOrderNumber] } }));
      const client = paymentSDK.ctAPI.client;
      client.types = jest.fn(() => ({
        get: jest.fn(() => ({
          execute: executeMock,
        })),
      })) as never;

      await createLaunchpadPurchaseOrderNumberCustomType();
      expect(Logger.log.info).toHaveBeenCalledWith(
        'Launchpad purchase order number custom type already exists. Skipping creation.',
      );
    });

    it('should log the founded purchase order number custom type', async () => {
      const executeMock = jest.fn().mockReturnValue(Promise.resolve({ body: { results: [] } }));
      const client = paymentSDK.ctAPI.client;
      client.types = jest.fn(() => ({
        get: jest.fn(() => ({
          execute: executeMock,
        })),
      })) as never;

      await createLaunchpadPurchaseOrderNumberCustomType();

      expect(Logger.log.info).not.toHaveBeenCalledWith(
        'Launchpad purchase order number custom type already exists. Skipping creation.',
      );
    });

    /*it('should return undefined when not found', async () => {
      const executeMock = jest.fn().mockReturnValue(Promise.resolve({ body: { results: [undefined] } }));
      const client = paymentSDK.ctAPI.client;
      client.types = jest.fn(() => ({
        get: jest.fn(() => ({
          execute: executeMock,
        })),
      })) as never;

      const result = await getTypeByKey('type-key');
      expect(result).toEqual(undefined);
    });*/
  });
});
