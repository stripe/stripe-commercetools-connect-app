import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { paymentSDK } from '../../../src/payment-sdk';
import { mockGetCartResult, orderMock } from '../../utils/mock-cart-data';
import { addOrderPayment, createOrderFromCart } from '../../../src/services/commerce-tools/order-client';

describe('CartClient testing', () => {
  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createOrderFromCart', () => {
    it('should create the order successfully', async () => {
      const mockCart = mockGetCartResult();
      jest.spyOn(paymentSDK.ctCartService, 'getCart').mockResolvedValue(mockCart);
      const executeMock = jest.fn().mockReturnValue(Promise.resolve({ body: orderMock }));

      // Mock ctCartService.getCart to return the latest cart version
      jest.spyOn(paymentSDK.ctCartService, 'getCart').mockResolvedValue(mockCart);

      const client = paymentSDK.ctAPI.client;
      client.orders = jest.fn(() => ({
        post: jest.fn(() => ({
          execute: executeMock,
        })),
      })) as never;
      const result = await createOrderFromCart(mockCart);
      expect(result).toEqual(orderMock);
    });
  });

  describe('addOrderPayment', () => {
    it('should add the payment to the order successfully', async () => {
      const executeMock = jest.fn().mockReturnValue(Promise.resolve({ body: orderMock }));
      const client = paymentSDK.ctAPI.client;
      client.orders = jest.fn(() => ({
        withId: jest.fn(() => ({
          post: jest.fn(() => ({
            execute: executeMock,
          })),
        })),
      })) as never;
      const result = await addOrderPayment(orderMock, 'payment-id');
      expect(result).toEqual(orderMock);
    });
  });
});
