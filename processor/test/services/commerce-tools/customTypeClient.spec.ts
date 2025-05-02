import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mock_AddFieldDefinitionActions, mock_CustomType_withFieldDefinition } from '../../utils/mock-actions-data';
import { paymentSDK } from '../../../src/payment-sdk';
import {
  createCustomType,
  deleteCustomTypeByKey,
  getTypeByKey,
  getTypesByResourceTypeId,
  updateCustomTypeByKey,
} from '../../../src/services/commerce-tools/customTypeClient';

describe('ProductTypeHelper testing', () => {
  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getTypeByKey', () => {
    it('should return the type when found', async () => {
      const executeMock = jest.fn().mockReturnValue(
        Promise.resolve({
          body: { results: [mock_CustomType_withFieldDefinition] },
        }),
      );
      const client = paymentSDK.ctAPI.client;
      client.types = jest.fn(() => ({
        get: jest.fn(() => ({
          execute: executeMock,
        })),
      })) as never;

      const result = await getTypeByKey('type-key');
      expect(result).toEqual(mock_CustomType_withFieldDefinition);
    });

    it('should return undefined when not found', async () => {
      const executeMock = jest.fn().mockReturnValue(Promise.resolve({ body: { results: [] } }));
      const client = paymentSDK.ctAPI.client;
      client.types = jest.fn(() => ({
        get: jest.fn(() => ({
          execute: executeMock,
        })),
      })) as never;

      const result = await getTypeByKey('type-key');
      expect(result).toEqual(undefined);
    });
  });

  describe('getTypesByResourceTypeId', () => {
    it('should return the types successfully', async () => {
      const executeMock = jest
        .fn()
        .mockReturnValue(Promise.resolve({ body: { results: [mock_CustomType_withFieldDefinition] } }));
      const client = paymentSDK.ctAPI.client;
      client.types = jest.fn(() => ({
        get: jest.fn(() => ({
          execute: executeMock,
        })),
      })) as never;

      const result = await getTypesByResourceTypeId('resource-type-id');
      expect(result).toEqual([mock_CustomType_withFieldDefinition]);
    });
  });

  describe('createCustomType', () => {
    it('should create a custom type successfully', async () => {
      const executeMock = jest.fn().mockReturnValue(Promise.resolve({ body: mock_CustomType_withFieldDefinition }));
      const client = paymentSDK.ctAPI.client;
      client.types = jest.fn(() => ({
        post: jest.fn(() => ({
          execute: executeMock,
        })),
      })) as never;

      const result = await createCustomType(mock_CustomType_withFieldDefinition);
      expect(result).toEqual(mock_CustomType_withFieldDefinition.id);
    });
  });

  describe('updateCustomTypeByKey', () => {
    it('should update the custom type successfully', async () => {
      const executeMock = jest.fn().mockReturnValue(Promise.resolve({ body: mock_CustomType_withFieldDefinition }));
      const client = paymentSDK.ctAPI.client;
      client.types = jest.fn(() => ({
        withKey: jest.fn(() => ({
          post: jest.fn(() => ({
            execute: executeMock,
          })),
        })),
      })) as never;

      const result = updateCustomTypeByKey({
        key: 'type-key',
        version: 1,
        actions: mock_AddFieldDefinitionActions,
      });
      await expect(result).resolves.not.toThrow();
    });
  });

  describe('deleteCustomTypeByKey', () => {
    it('should delete the custom type successfully', async () => {
      const executeMock = jest.fn().mockReturnValue(Promise.resolve());
      const client = paymentSDK.ctAPI.client;
      client.types = jest.fn(() => ({
        withKey: jest.fn(() => ({
          delete: jest.fn(() => ({
            execute: executeMock,
          })),
        })),
      })) as never;
      const result = deleteCustomTypeByKey({ key: 'type-key', version: 1 });

      await expect(result).resolves.not.toThrow();
    });
  });
});
