import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  mock_CustomType_withFieldDefinition,
  mock_CustomType_withNoFieldDefinition,
  mock_CustomTypeDraft,
} from '../utils/mock-actions-data';
import { paymentSDK } from '../../src/payment-sdk';
import { addFieldToType, createCustomerCustomType, getTypeByKey, hasField } from '../../src/helpers/customTypeHelper';

describe('CustomTypeHelper testing', () => {
  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getTypeByKey', () => {
    it('should return the type when found', async () => {
      const executeMock = jest
        .fn()
        .mockReturnValue(Promise.resolve({ body: { results: [mock_CustomType_withFieldDefinition] } }));
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
      const executeMock = jest.fn().mockReturnValue(Promise.resolve({ body: { results: [undefined] } }));
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

  describe('hasField', () => {
    it('should return true if the field exists', () => {
      const result = hasField(
        mock_CustomType_withFieldDefinition,
        mock_CustomType_withFieldDefinition.fieldDefinitions[0].name,
      );
      expect(result).toBeTruthy();
    });

    it('should return true if the field exists', () => {
      const result = hasField(
        mock_CustomType_withNoFieldDefinition,
        mock_CustomType_withFieldDefinition.fieldDefinitions[0].name,
      );
      expect(result).toBeFalsy();
    });
  });

  describe('addFieldToType', () => {
    it('should add a field to the type', async () => {
      const fieldDefinition = mock_CustomType_withFieldDefinition.fieldDefinitions[0];
      const executeMock = jest
        .fn()
        .mockReturnValue(Promise.resolve({ body: { results: [mock_CustomType_withFieldDefinition] } }));
      const client = paymentSDK.ctAPI.client;
      client.types = jest.fn(() => ({
        withId: jest.fn(() => ({
          post: jest.fn(() => ({
            execute: executeMock,
          })),
        })),
      })) as never;

      await addFieldToType(client, mock_CustomType_withFieldDefinition.fieldDefinitions[0].name, 1, fieldDefinition);

      expect(client.types().withId({ ID: mock_CustomType_withFieldDefinition.id }).post.call).toBeTruthy();
    });
  });

  describe('createCustomerCustomType', () => {
    it('should create a custom type', async () => {
      const typeDraft = mock_CustomTypeDraft;
      const executeMock = jest
        .fn()
        .mockReturnValue(Promise.resolve({ body: { results: [mock_CustomType_withFieldDefinition] } }));
      const client = paymentSDK.ctAPI.client;
      client.types = jest.fn(() => ({
        post: jest.fn(() => ({
          execute: executeMock,
        })),
      })) as never;

      await createCustomerCustomType(typeDraft);

      expect(client.types().post.call).toBeTruthy();
    });
  });
});
