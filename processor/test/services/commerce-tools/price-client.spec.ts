/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import * as PriceClient from '../../../src/services/commerce-tools/price-client';
import { paymentSDK } from '../../../src/payment-sdk';

jest.mock('../../../src/payment-sdk');

describe('Price Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getProductById', () => {
    it('should get product by ID successfully', async () => {
      const mockProduct = {
        id: 'test-product-id',
        masterData: {
          current: {
            masterVariant: {
              prices: [
                {
                  value: {
                    centAmount: 1000,
                    currencyCode: 'USD',
                    fractionDigits: 2,
                  },
                },
              ],
            },
          },
        },
      };

      const executeMock = jest.fn().mockReturnValue(Promise.resolve({ body: mockProduct }));
      const client = paymentSDK.ctAPI.client;
      client.products = jest.fn(() => ({
        withId: jest.fn(() => ({
          get: jest.fn(() => ({
            execute: executeMock,
          })),
        })),
      })) as any;

      const result = await PriceClient.getProductById('test-product-id');

      expect(result).toEqual(mockProduct);
    });

    it('should handle errors gracefully', async () => {
      const executeMock = jest.fn().mockReturnValue(Promise.reject(new Error('API Error')));
      const client = paymentSDK.ctAPI.client;
      client.products = jest.fn(() => ({
        withId: jest.fn(() => ({
          get: jest.fn(() => ({
            execute: executeMock,
          })),
        })),
      })) as any;

      const result = await PriceClient.getProductById('test-product-id');

      expect(result).toBeUndefined();
    });
  });

  describe('getProductMasterPrice', () => {
    it('should get master price successfully', async () => {
      const mockProduct = {
        masterData: {
          current: {
            masterVariant: {
              prices: [
                {
                  value: {
                    centAmount: 1000,
                    currencyCode: 'USD',
                    fractionDigits: 2,
                  },
                },
              ],
            },
          },
        },
      };

      jest.spyOn(PriceClient, 'getProductById').mockResolvedValue(mockProduct as any);

      const result = await PriceClient.getProductMasterPrice('test-product-id');

      expect(result).toEqual({
        centAmount: 1000,
        currencyCode: 'USD',
        fractionDigits: 2,
      });
    });

    it('should return undefined when no product found', async () => {
      jest.spyOn(PriceClient, 'getProductById').mockResolvedValue(undefined);

      const result = await PriceClient.getProductMasterPrice('test-product-id');

      expect(result).toBeUndefined();
    });

    it('should return undefined when no price found', async () => {
      const mockProduct = {
        masterData: {
          current: {
            masterVariant: {
              prices: [],
            },
          },
        },
      };

      jest.spyOn(PriceClient, 'getProductById').mockResolvedValue(mockProduct as any);

      const result = await PriceClient.getProductMasterPrice('test-product-id');

      expect(result).toBeUndefined();
    });

    it('should handle errors gracefully', async () => {
      jest.spyOn(PriceClient, 'getProductById').mockRejectedValue(new Error('API Error'));

      const result = await PriceClient.getProductMasterPrice('test-product-id');

      expect(result).toBeUndefined();
    });
  });
});
