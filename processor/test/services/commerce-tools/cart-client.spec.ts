import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { paymentSDK } from '../../../src/payment-sdk';
import { mockCartDraft, mockGetCartResult } from '../../utils/mock-cart-data';
import {
  getCartExpanded,
  updateCartById,
  createCartWithProduct,
  createCartFromDraft,
} from '../../../src/services/commerce-tools/cart-client';
import { Product, ProductVariant } from '@commercetools/platform-sdk';
import { PaymentAmount } from '@commercetools/connect-payments-sdk/dist/commercetools/types/payment.type';

jest.mock('../../../src/libs/logger', () => ({
  log: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../../src/libs/fastify/context/context', () => ({
  getCartIdFromContext: jest.fn(() => 'default-cart-id'),
}));

describe('CartClient testing', () => {
  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createCartFromDraft', () => {
    it('should create the cart from a draft successfully', async () => {
      const mockCart = mockGetCartResult()
      const executeMock = jest.fn().mockReturnValue(Promise.resolve({ body: mockCart }));
      const client = paymentSDK.ctAPI.client;
      client.carts = jest.fn(() => ({
        post: jest.fn(() => ({
          execute: executeMock,
        })),
      })) as never;
      const result = await createCartFromDraft(mockCartDraft);
      expect(result).toEqual(mockCart);
    });
  });

  describe('getCartExpanded', () => {
    it('should return the cart successfully', async () => {
      const mockCart = mockGetCartResult();
      const executeMock = jest.fn().mockReturnValue(Promise.resolve({ body: mockCart }));
      const client = paymentSDK.ctAPI.client;
      client.carts = jest.fn(() => ({
        withId: jest.fn(() => ({
          get: jest.fn(() => ({
            execute: executeMock,
          })),
        })),
      })) as never;
      const result = await getCartExpanded('cart-id');
      expect(result).toEqual(mockCart);
    });

    it('should return the cart successfully without passing ID', async () => {
      const mockCart = mockGetCartResult();
      const executeMock = jest.fn().mockReturnValue(Promise.resolve({ body: mockCart }));
      const client = paymentSDK.ctAPI.client;
      client.carts = jest.fn(() => ({
        withId: jest.fn(() => ({
          get: jest.fn(() => ({
            execute: executeMock,
          })),
        })),
      })) as never;
      const result = await getCartExpanded();
      expect(result).toEqual(mockCart);
    });

    it('should handle API errors gracefully', async () => {
      const executeMock = jest.fn().mockReturnValue(Promise.reject(new Error('API Error')));
      const client = paymentSDK.ctAPI.client;
      client.carts = jest.fn(() => ({
        withId: jest.fn(() => ({
          get: jest.fn(() => ({
            execute: executeMock,
          })),
        })),
      })) as never;

      await expect(getCartExpanded('cart-id')).rejects.toThrow('API Error');
    });
  });

  describe('updateCartById', () => {
    it('should update the cart successfully', async () => {
      const mockCart = mockGetCartResult();
      const executeMock = jest.fn().mockReturnValue(Promise.resolve({ body: mockCart }));
      const client = paymentSDK.ctAPI.client;
      client.carts = jest.fn(() => ({
        withId: jest.fn(() => ({
          post: jest.fn(() => ({
            execute: executeMock,
          })),
        })),
      })) as never;
      const result = await updateCartById(mockCart, [{ action: 'addLineItem', key: 'line-item-key' }]);
      expect(result).toEqual(mockCart);
    });

    it('should handle update errors gracefully', async () => {
      const mockCart = mockGetCartResult();
      const executeMock = jest.fn().mockReturnValue(Promise.reject(new Error('Update Error')));
      const client = paymentSDK.ctAPI.client;
      client.carts = jest.fn(() => ({
        withId: jest.fn(() => ({
          post: jest.fn(() => ({
            execute: executeMock,
          })),
        })),
      })) as never;

      await expect(updateCartById(mockCart, [{ action: 'addLineItem', key: 'line-item-key' }])).rejects.toThrow(
        'Update Error',
      );
    });
  });

  describe('createCartWithProduct', () => {
    const mockProduct: Product = {
      id: 'product-123',
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
            prices: [],
            images: [],
            attributes: [],
            assets: [],
          },
          variants: [],
          searchKeywords: {},
        },
        published: true,
        hasStagedChanges: false,
      },
      publishStatus: 'Published',
    } as Product;

    const mockVariant: ProductVariant = {
      id: 1,
      sku: 'test-sku-1',
      prices: [],
      images: [],
      attributes: [],
      assets: [],
    };

    const mockPrice: PaymentAmount = {
      centAmount: 1000,
      currencyCode: 'USD',
      fractionDigits: 2,
    };

    it('should create a cart with product successfully', async () => {
      const mockCart = mockGetCartResult();
      const mockUpdatedCart = { ...mockCart, id: 'new-cart-123' };

      const createExecuteMock = jest.fn().mockReturnValue(Promise.resolve({ body: mockCart }));
      const updateExecuteMock = jest.fn().mockReturnValue(Promise.resolve({ body: mockUpdatedCart }));
      const expandExecuteMock = jest.fn().mockReturnValue(Promise.resolve({ body: mockUpdatedCart }));

      const client = paymentSDK.ctAPI.client;
      client.carts = jest.fn(() => ({
        post: jest.fn(() => ({
          execute: createExecuteMock,
        })),
        withId: jest.fn(() => ({
          post: jest.fn(() => ({
            execute: updateExecuteMock,
          })),
          get: jest.fn(() => ({
            execute: expandExecuteMock,
          })),
        })),
      })) as never;

      const result = await createCartWithProduct(mockProduct, mockVariant, mockPrice, 'price-123', 'sub-123', 2);

      expect(result).toEqual(mockUpdatedCart);
      expect(createExecuteMock).toHaveBeenCalled();
      expect(updateExecuteMock).toHaveBeenCalled();
      expect(expandExecuteMock).toHaveBeenCalled();
    });

    it('should handle cart creation errors gracefully', async () => {
      const createExecuteMock = jest.fn().mockReturnValue(Promise.reject(new Error('Cart Creation Error')));

      const client = paymentSDK.ctAPI.client;
      client.carts = jest.fn(() => ({
        post: jest.fn(() => ({
          execute: createExecuteMock,
        })),
      })) as never;

      await expect(
        createCartWithProduct(mockProduct, mockVariant, mockPrice, 'price-123', 'sub-123', 2),
      ).rejects.toThrow('Cart Creation Error');
    });

    it('should handle cart update errors gracefully', async () => {
      const mockCart = mockGetCartResult();
      const createExecuteMock = jest.fn().mockReturnValue(Promise.resolve({ body: mockCart }));
      const updateExecuteMock = jest.fn().mockReturnValue(Promise.reject(new Error('Cart Update Error')));

      const client = paymentSDK.ctAPI.client;
      client.carts = jest.fn(() => ({
        post: jest.fn(() => ({
          execute: createExecuteMock,
        })),
        withId: jest.fn(() => ({
          post: jest.fn(() => ({
            execute: updateExecuteMock,
          })),
        })),
      })) as never;

      await expect(
        createCartWithProduct(mockProduct, mockVariant, mockPrice, 'price-123', 'sub-123', 2),
      ).rejects.toThrow('Cart Update Error');
    });

    it('should handle cart expansion errors gracefully', async () => {
      const mockCart = mockGetCartResult();
      const mockUpdatedCart = { ...mockCart, id: 'new-cart-123' };
      const createExecuteMock = jest.fn().mockReturnValue(Promise.resolve({ body: mockCart }));
      const updateExecuteMock = jest.fn().mockReturnValue(Promise.resolve({ body: mockUpdatedCart }));
      const expandExecuteMock = jest.fn().mockReturnValue(Promise.reject(new Error('Cart Expansion Error')));

      const client = paymentSDK.ctAPI.client;
      client.carts = jest.fn(() => ({
        post: jest.fn(() => ({
          execute: createExecuteMock,
        })),
        withId: jest.fn(() => ({
          post: jest.fn(() => ({
            execute: updateExecuteMock,
          })),
          get: jest.fn(() => ({
            execute: expandExecuteMock,
          })),
        })),
      })) as never;

      await expect(
        createCartWithProduct(mockProduct, mockVariant, mockPrice, 'price-123', 'sub-123', 2),
      ).rejects.toThrow('Cart Expansion Error');
    });

    it('should create cart with correct parameters', async () => {
      const mockCart = mockGetCartResult();
      const mockUpdatedCart = { ...mockCart, id: 'new-cart-123' };

      const createExecuteMock = jest.fn().mockReturnValue(Promise.resolve({ body: mockCart }));
      const updateExecuteMock = jest.fn().mockReturnValue(Promise.resolve({ body: mockUpdatedCart }));
      const expandExecuteMock = jest.fn().mockReturnValue(Promise.resolve({ body: mockUpdatedCart }));

      const client = paymentSDK.ctAPI.client;
      const mockCarts = {
        post: jest.fn(() => ({
          execute: createExecuteMock,
        })),
        withId: jest.fn(() => ({
          post: jest.fn(() => ({
            execute: updateExecuteMock,
          })),
          get: jest.fn(() => ({
            execute: expandExecuteMock,
          })),
        })),
      };
      client.carts = jest.fn(() => mockCarts) as never;

      await createCartWithProduct(mockProduct, mockVariant, mockPrice, 'price-123', 'sub-123', 2);

      expect(mockCarts.post).toHaveBeenCalled();
      expect(mockCarts.withId).toHaveBeenCalled();
    });
  });
});
