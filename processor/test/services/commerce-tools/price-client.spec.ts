/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import * as PriceClient from '../../../src/services/commerce-tools/price-client';
import { paymentSDK } from '../../../src/payment-sdk';
import { Product } from '@commercetools/platform-sdk';

jest.mock('../../../src/libs/logger', () => ({
  log: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

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

    it('should handle network errors gracefully', async () => {
      const executeMock = jest.fn().mockReturnValue(Promise.reject(new Error('Network Error')));
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

    it('should return undefined when master variant has no prices', async () => {
      const mockProduct = {
        masterData: {
          current: {
            masterVariant: {
              // No prices property
            },
          },
        },
      };

      jest.spyOn(PriceClient, 'getProductById').mockResolvedValue(mockProduct as any);

      const result = await PriceClient.getProductMasterPrice('test-product-id');

      expect(result).toBeUndefined();
    });

    it('should return undefined when master data is missing', async () => {
      const mockProduct = {};

      jest.spyOn(PriceClient, 'getProductById').mockResolvedValue(mockProduct as any);

      const result = await PriceClient.getProductMasterPrice('test-product-id');

      expect(result).toBeUndefined();
    });

    it('should use default fractionDigits when not provided', async () => {
      const mockProduct = {
        masterData: {
          current: {
            masterVariant: {
              prices: [
                {
                  value: {
                    centAmount: 1000,
                    currencyCode: 'USD',
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

    it('should handle errors gracefully', async () => {
      jest.spyOn(PriceClient, 'getProductById').mockRejectedValue(new Error('API Error'));

      const result = await PriceClient.getProductMasterPrice('test-product-id');

      expect(result).toBeUndefined();
    });
  });

  describe('getPriceFromProduct', () => {
    const createMockProduct = (masterVariantPrices: any[] = [], variantPrices: any[] = []): Product =>
      ({
        id: 'test-product-id',
        version: 1,
        createdAt: '2023-01-01T00:00:00Z',
        lastModifiedAt: '2023-01-01T00:00:00Z',
        productType: { typeId: 'product-type', id: 'pt-123' },
        name: { en: 'Test Product' },
        slug: { en: 'test-product' },
        categories: [],
        categoryOrderHints: {},
        metaTitle: { en: 'Test Product' },
        metaDescription: { en: 'Test Product Description' },
        metaKeywords: { en: 'test,product' },
        masterData: {
          staged: {
            name: { en: 'Test Product' },
            description: { en: 'Test Product Description' },
            categories: [],
            categoryOrderHints: {},
            slug: { en: 'test-product' },
            masterVariant: {
              id: 1,
              sku: 'test-sku-1',
              prices: [],
              images: [],
              attributes: [],
              assets: [],
            },
            variants: [],
            searchKeywords: {},
          },
          current: {
            name: { en: 'Test Product' },
            description: { en: 'Test Product Description' },
            categories: [],
            categoryOrderHints: {},
            slug: { en: 'test-product' },
            masterVariant: {
              id: 1,
              sku: 'test-sku-1',
              prices: masterVariantPrices,
              images: [],
              attributes: [],
              assets: [],
            },
            variants: variantPrices.map((prices, index) => ({
              id: index + 2,
              sku: `test-sku-${index + 2}`,
              prices,
              images: [],
              attributes: [],
              assets: [],
            })),
            searchKeywords: {},
          },
          published: true,
          hasStagedChanges: false,
        },
        publishStatus: 'Published',
      }) as Product;

    it('should find price in master variant successfully', async () => {
      const mockProduct = createMockProduct([
        {
          id: 'price-123',
          value: {
            centAmount: 1000,
            currencyCode: 'USD',
            fractionDigits: 2,
          },
        },
      ]);

      const result = PriceClient.getPriceFromProduct(mockProduct, 'price-123');

      expect(result).toEqual({
        centAmount: 1000,
        currencyCode: 'USD',
        fractionDigits: 2,
      });
    });

    it('should find price in variants when not in master variant', async () => {
      const mockProduct = createMockProduct(
        [], // No prices in master variant
        [
          [
            {
              id: 'price-456',
              value: {
                centAmount: 2000,
                currencyCode: 'EUR',
                fractionDigits: 2,
              },
            },
          ],
        ],
      );

      const result = PriceClient.getPriceFromProduct(mockProduct, 'price-456');

      expect(result).toEqual({
        centAmount: 2000,
        currencyCode: 'EUR',
        fractionDigits: 2,
      });
    });

    it('should find price in second variant', async () => {
      const mockProduct = createMockProduct(
        [],
        [
          [],
          [
            {
              id: 'price-789',
              value: {
                centAmount: 3000,
                currencyCode: 'GBP',
                fractionDigits: 2,
              },
            },
          ],
        ],
      );

      const result = PriceClient.getPriceFromProduct(mockProduct, 'price-789');

      expect(result).toEqual({
        centAmount: 3000,
        currencyCode: 'GBP',
        fractionDigits: 2,
      });
    });

    it('should return undefined when price not found in any variant', async () => {
      const mockProduct = createMockProduct(
        [
          {
            id: 'price-123',
            value: {
              centAmount: 1000,
              currencyCode: 'USD',
              fractionDigits: 2,
            },
          },
        ],
        [
          [
            {
              id: 'price-456',
              value: {
                centAmount: 2000,
                currencyCode: 'EUR',
                fractionDigits: 2,
              },
            },
          ],
        ],
      );

      const result = PriceClient.getPriceFromProduct(mockProduct, 'price-not-found');

      expect(result).toBeUndefined();
    });

    it('should return undefined when master variant has no prices', async () => {
      const mockProduct = createMockProduct();

      const result = PriceClient.getPriceFromProduct(mockProduct, 'price-123');

      expect(result).toBeUndefined();
    });

    it('should return undefined when variants have no prices', async () => {
      const mockProduct = createMockProduct([], [[], []]);

      const result = PriceClient.getPriceFromProduct(mockProduct, 'price-123');

      expect(result).toBeUndefined();
    });

    it('should use default fractionDigits when not provided', async () => {
      const mockProduct = createMockProduct([
        {
          id: 'price-123',
          value: {
            centAmount: 1000,
            currencyCode: 'USD',
          },
        },
      ]);

      const result = PriceClient.getPriceFromProduct(mockProduct, 'price-123');

      expect(result).toEqual({
        centAmount: 1000,
        currencyCode: 'USD',
        fractionDigits: 2,
      });
    });

    it('should handle product with no masterData gracefully', async () => {
      const mockProduct = {
        id: 'test-product-id',
      } as unknown as Product;

      const result = PriceClient.getPriceFromProduct(mockProduct, 'price-123');

      expect(result).toBeUndefined();
    });

    it('should handle product with no current data gracefully', async () => {
      const mockProduct = {
        id: 'test-product-id',
        masterData: {},
      } as unknown as Product;

      const result = PriceClient.getPriceFromProduct(mockProduct, 'price-123');

      expect(result).toBeUndefined();
    });

    it('should handle product with no masterVariant gracefully', async () => {
      const mockProduct = {
        id: 'test-product-id',
        masterData: {
          current: {},
        },
      } as unknown as Product;

      const result = PriceClient.getPriceFromProduct(mockProduct, 'price-123');

      expect(result).toBeUndefined();
    });

    it('should handle product with no variants gracefully', async () => {
      const mockProduct = {
        id: 'test-product-id',
        masterData: {
          current: {
            masterVariant: {
              prices: [],
            },
          },
        },
      } as unknown as Product;

      const result = PriceClient.getPriceFromProduct(mockProduct, 'price-123');

      expect(result).toBeUndefined();
    });

    it('should handle errors gracefully', async () => {
      const mockProduct = createMockProduct([
        {
          id: 'price-123',
          value: {
            centAmount: 1000,
            currencyCode: 'USD',
            fractionDigits: 2,
          },
        },
      ]);

      const originalFind = Array.prototype.find;
      Array.prototype.find = jest.fn(() => {
        throw new Error('Array find error');
      });

      const result = PriceClient.getPriceFromProduct(mockProduct, 'price-123');

      expect(result).toBeUndefined();

      Array.prototype.find = originalFind;
    });

    it('should handle errors in master variant price search gracefully', async () => {
      const mockProduct = createMockProduct([
        {
          id: 'price-123',
          value: {
            centAmount: 1000,
            currencyCode: 'USD',
            fractionDigits: 2,
          },
        },
      ]);

      const originalFind = Array.prototype.find;
      let callCount = 0;
      Array.prototype.find = jest.fn(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Master variant find error');
        }
        return undefined;
      });

      const result = PriceClient.getPriceFromProduct(mockProduct, 'price-123');

      expect(result).toBeUndefined();

      Array.prototype.find = originalFind;
    });

    it('should handle errors in variant price search gracefully', async () => {
      const mockProduct = createMockProduct(
        [],
        [
          [
            {
              id: 'price-456',
              value: {
                centAmount: 2000,
                currencyCode: 'EUR',
                fractionDigits: 2,
              },
            },
          ],
        ],
      );

      const originalFind = Array.prototype.find;
      Array.prototype.find = jest.fn(() => {
        throw new Error('Variant find error');
      });

      const result = PriceClient.getPriceFromProduct(mockProduct, 'price-456');

      expect(result).toBeUndefined();

      Array.prototype.find = originalFind;
    });
  });
});
