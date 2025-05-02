import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mock_Product, mock_ProductType } from '../../utils/mock-actions-data';
import { paymentSDK } from '../../../src/payment-sdk';
import {
  createProductType,
  deleteProductType,
  getProductsByProductTypeId,
  getProductTypeByKey,
} from '../../../src/services/commerce-tools/productTypeClient';

describe('ProductTypeHelper testing', () => {
  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getProductTypeByKey', () => {
    it('should return the product type successfully', async () => {
      const executeMock = jest.fn().mockReturnValue(Promise.resolve({ body: { results: [mock_ProductType] } }));
      const apiClient = paymentSDK.ctAPI.client;
      apiClient.productTypes = jest.fn(() => ({
        get: jest.fn(() => ({
          execute: executeMock,
        })),
      })) as never;

      const result = await getProductTypeByKey('type-key');
      expect(result).toEqual(mock_ProductType);
    });

    it('should return undefined', async () => {
      const executeMock = jest.fn().mockReturnValue(Promise.resolve({ body: { results: [] } }));
      const apiClient = paymentSDK.ctAPI.client;
      apiClient.productTypes = jest.fn(() => ({
        get: jest.fn(() => ({
          execute: executeMock,
        })),
      })) as never;

      const result = await getProductTypeByKey('type-key');
      expect(result).toBeUndefined();
    });
  });

  describe('getProductsByProductTypeId', () => {
    it('should return the products successfully', async () => {
      const mockProducts = [mock_Product];
      const executeMock = jest.fn().mockReturnValue(Promise.resolve({ body: { results: mockProducts } }));
      const apiClient = paymentSDK.ctAPI.client;
      apiClient.products = jest.fn(() => ({
        get: jest.fn(() => ({
          execute: executeMock,
        })),
      })) as never;

      const result = await getProductsByProductTypeId('product-type-id');
      expect(result).toEqual(mockProducts);
    });
  });

  describe('deleteProductType', () => {
    it('should delete the product type successfully', async () => {
      const executeMock = jest.fn().mockReturnValue(Promise.resolve());
      const apiClient = paymentSDK.ctAPI.client;
      apiClient.productTypes = jest.fn(() => ({
        withKey: jest.fn(() => ({
          delete: jest.fn(() => ({
            execute: executeMock,
          })),
        })),
      })) as never;

      await deleteProductType({ key: 'product-type-key', version: 1 });
      expect(executeMock).toBeCalled();
    });
  });

  describe('createProductType', () => {
    it('should create the product type successfully', async () => {
      const executeMock = jest.fn().mockReturnValue(Promise.resolve({ body: mock_ProductType }));
      const apiClient = paymentSDK.ctAPI.client;
      apiClient.productTypes = jest.fn(() => ({
        post: jest.fn(() => ({
          execute: executeMock,
        })),
      })) as never;

      const result = await createProductType(mock_ProductType);
      expect(result).toEqual(mock_ProductType);
      expect(executeMock).toBeCalled();
    });
  });
});
