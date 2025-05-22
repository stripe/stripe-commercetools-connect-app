import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { paymentSDK } from '../../../src/payment-sdk';
import { mockGetCartResult } from '../../utils/mock-cart-data';
import { getCartExpanded, updateCartById } from '../../../src/services/commerce-tools/cart-client';

describe('CartClient testing', () => {
  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
  });
});
