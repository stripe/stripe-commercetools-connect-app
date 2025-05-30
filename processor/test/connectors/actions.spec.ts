import Stripe from 'stripe';
import { describe, test, expect, jest, afterEach, beforeEach, it } from '@jest/globals';
import * as Actions from '../../src/connectors/actions';
import * as Logger from '../../src/libs/logger';
import {
  mock_CustomType_withLaunchpadPurchaseOrderNumber,
  mock_Product,
  mock_ProductType,
  mock_Stripe_retrieveWebhookEnpoints_response,
  mock_Stripe_updateWebhookEnpoints_response,
} from '../utils/mock-actions-data';
import { paymentSDK } from '../../src/payment-sdk';
import { createLaunchpadPurchaseOrderNumberCustomType } from '../../src/connectors/actions';
import * as CustomTypeHelper from '../../src/services/commerce-tools/custom-type-helper';
import * as CustomTypeClient from '../../src/services/commerce-tools/custom-type-client';
import * as ProductTypeClient from '../../src/services/commerce-tools/product-type-client';

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

  describe('createLaunchpadPurchaseOrderNumberCustomType', () => {
    it('should log the founded purchase order number custom type', async () => {
      const getTypeMock = jest
        .spyOn(CustomTypeClient, 'getTypeByKey')
        .mockResolvedValue(mock_CustomType_withLaunchpadPurchaseOrderNumber);

      await createLaunchpadPurchaseOrderNumberCustomType();
      expect(getTypeMock).toHaveBeenCalled();
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

  describe('handleRequest', () => {
    test('should call the function successfully', async () => {
      const loggerId = '[TEST_LOGGER_ID]';
      const startMessage = 'Starting test process';
      const fn = jest.fn();
      await Actions.handleRequest({ loggerId, startMessage, fn });

      expect(Logger.log.info).toHaveBeenCalledWith(`${loggerId} ${startMessage}`);
      expect(fn).toHaveBeenCalled();
    });

    /*test('should log error', async () => {
      const loggerId = '[TEST_LOGGER_ID]';
      const startMessage = 'Starting test process';
      const error = new Error('Test error');
      const fn = jest.fn().mockReturnValue(Promise.reject(error));
      try {
        await Actions.handleRequest({ loggerId, startMessage, fn });
      } catch {
        expect(Logger.log.error).toHaveBeenCalledWith(loggerId, error);
      }
    });*/
  });

  describe('createCustomerCustomType', () => {
    test('should create Customer custom type ', async () => {
      const addOrUpdateCustomTypeMock = jest
        .spyOn(CustomTypeHelper, 'addOrUpdateCustomType')
        .mockReturnValue(Promise.resolve());

      await Actions.createCustomerCustomType();
      expect(addOrUpdateCustomTypeMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalled();
    });
  });

  describe('createLineItemCustomType', () => {
    test('should create Line Item custom type ', async () => {
      const addOrUpdateCustomTypeMock = jest
        .spyOn(CustomTypeHelper, 'addOrUpdateCustomType')
        .mockReturnValue(Promise.resolve());

      await Actions.createLineItemCustomType();
      expect(addOrUpdateCustomTypeMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalled();
    });
  });

  describe('removeLineItemCustomType', () => {
    test('should remove Line Item custom type ', async () => {
      const deleteOrUpdateCustomTypeMock = jest
        .spyOn(CustomTypeHelper, 'deleteOrUpdateCustomType')
        .mockReturnValue(Promise.resolve());

      await Actions.removeLineItemCustomType();
      expect(deleteOrUpdateCustomTypeMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalled();
    });
  });

  describe('removeCustomerCustomType', () => {
    test('should remove Line Item custom type ', async () => {
      const deleteOrUpdateCustomTypeMock = jest
        .spyOn(CustomTypeHelper, 'deleteOrUpdateCustomType')
        .mockReturnValue(Promise.resolve());

      await Actions.removeCustomerCustomType();
      expect(deleteOrUpdateCustomTypeMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalled();
    });
  });

  describe('createProductTypeSubscription', () => {
    test('should not create Product type Subscription', async () => {
      const getProductTypeByKeyMock = jest
        .spyOn(ProductTypeClient, 'getProductTypeByKey')
        .mockResolvedValue(mock_ProductType);

      await Actions.createProductTypeSubscription();
      expect(getProductTypeByKeyMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalledWith('Product type subscription already exists. Skipping creation.');
    });

    test('should create Product type Subscription successfully', async () => {
      const getProductTypeByKeyMock = jest.spyOn(ProductTypeClient, 'getProductTypeByKey').mockResolvedValue(undefined);
      const createProductTypeMock = jest
        .spyOn(ProductTypeClient, 'createProductType')
        .mockResolvedValue(mock_ProductType);

      await Actions.createProductTypeSubscription();
      expect(getProductTypeByKeyMock).toHaveBeenCalled();
      expect(createProductTypeMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalledTimes(2);
    });
  });

  describe('removeProductTypeSubscription', () => {
    test('should not create Product type Subscription, is already deleted', async () => {
      const getProductTypeByKeyMock = jest.spyOn(ProductTypeClient, 'getProductTypeByKey').mockResolvedValue(undefined);

      await Actions.removeProductTypeSubscription();
      expect(getProductTypeByKeyMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalled();
    });

    test('should not create Product type Subscription, is in use', async () => {
      const getProductTypeByKeyMock = jest
        .spyOn(ProductTypeClient, 'getProductTypeByKey')
        .mockResolvedValue(mock_ProductType);
      const getProductsByProductTypeIdMock = jest
        .spyOn(ProductTypeClient, 'getProductsByProductTypeId')
        .mockResolvedValue([mock_Product]);

      await Actions.removeProductTypeSubscription();
      expect(getProductTypeByKeyMock).toHaveBeenCalled();
      expect(getProductsByProductTypeIdMock).toHaveBeenCalled();
      expect(Logger.log.warn).toHaveBeenCalled();
    });

    test('should create Product type Subscription successfully', async () => {
      const getProductTypeByKeyMock = jest
        .spyOn(ProductTypeClient, 'getProductTypeByKey')
        .mockResolvedValue(mock_ProductType);
      const getProductsByProductTypeIdMock = jest
        .spyOn(ProductTypeClient, 'getProductsByProductTypeId')
        .mockResolvedValue([]);
      const deleteProductTypeMock = jest
        .spyOn(ProductTypeClient, 'deleteProductType')
        .mockReturnValue(Promise.resolve());

      await Actions.removeProductTypeSubscription();
      expect(getProductTypeByKeyMock).toHaveBeenCalled();
      expect(getProductsByProductTypeIdMock).toHaveBeenCalled();
      expect(deleteProductTypeMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalled();
    });
  });
});
