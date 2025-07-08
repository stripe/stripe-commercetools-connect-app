import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { _BaseAddress } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/common';
import { paymentSDK } from '../../../src/payment-sdk';
import { mockGetCartResult } from '../../utils/mock-cart-data';
import {
  getShippingMethodsFromCart,
  updateShippingAddress,
  updateShippingRate,
  removeShippingRate,
} from '../../../src/services/commerce-tools/shipping-client';
import { updateCartById } from '../../../src/services/commerce-tools/cart-client';

// Mock the cart-client
jest.mock('../../../src/services/commerce-tools/cart-client');

describe('ShippingClient testing', () => {
  const mockShippingMethodsResponse = {
    body: {
      results: [
        {
          id: 'shipping-method-1',
          name: 'Standard Shipping',
          description: 'Standard Shipping 3-5 days',
          isDefault: true,
        },
        {
          id: 'shipping-method-2',
          name: 'Express Shipping',
          description: 'Express Shipping 1-2 days',
          isDefault: false,
        },
      ],
      total: 2,
    },
  };

  const mockAddress: _BaseAddress = {
    country: 'US',
    state: 'NY',
    city: 'New York',
    streetName: 'Broadway',
    streetNumber: '123',
    postalCode: '10001',
    additionalStreetInfo: 'Floor 5',
    region: 'Northeast',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getShippingMethodsFromCart', () => {
    it('should return shipping methods for a cart', async () => {
      // Arrange
      const mockCart = mockGetCartResult();
      const executeMock = jest.fn().mockReturnValue(Promise.resolve(mockShippingMethodsResponse));
      const getMock = jest.fn().mockReturnValue({ execute: executeMock });
      const matchingCartMock = jest.fn().mockReturnValue({ get: getMock });

      const client = paymentSDK.ctAPI.client;
      client.shippingMethods = jest.fn(() => ({
        matchingCart: matchingCartMock,
      })) as never;

      // Act
      const result = await getShippingMethodsFromCart(mockCart);

      // Assert
      expect(client.shippingMethods).toHaveBeenCalled();
      expect(matchingCartMock).toHaveBeenCalled();
      expect(getMock).toHaveBeenCalledWith({
        queryArgs: {
          cartId: mockCart.id,
        },
      });
      expect(executeMock).toHaveBeenCalled();
      expect(result).toEqual(mockShippingMethodsResponse.body);
    });

    it('should throw an error when API call fails', async () => {
      // Arrange
      const mockCart = mockGetCartResult();
      const errorMessage = 'Failed to get shipping methods';
      const executeMock = jest.fn().mockReturnValue(Promise.reject(new Error(errorMessage)));
      const getMock = jest.fn().mockReturnValue({ execute: executeMock });
      const matchingCartMock = jest.fn().mockReturnValue({ get: getMock });

      const client = paymentSDK.ctAPI.client;
      client.shippingMethods = jest.fn(() => ({
        matchingCart: matchingCartMock,
      })) as never;

      // Act & Assert
      await expect(getShippingMethodsFromCart(mockCart)).rejects.toThrow(errorMessage);
      expect(client.shippingMethods).toHaveBeenCalled();
      expect(matchingCartMock).toHaveBeenCalled();
      expect(getMock).toHaveBeenCalled();
      expect(executeMock).toHaveBeenCalled();
    });
  });

  describe('updateShippingAddress', () => {
    it('should update shipping address successfully', async () => {
      // Arrange
      const mockCart = mockGetCartResult();
      const actions = [
        {
          action: 'setShippingAddress',
          address: mockAddress,
        },
      ];
      const updatedCart = { ...mockCart, shippingAddress: mockAddress };

      (updateCartById as jest.Mock).mockReturnValue(Promise.resolve(updatedCart));

      // Act
      const result = await updateShippingAddress(mockCart, mockAddress);

      // Assert
      expect(updateCartById).toHaveBeenCalledWith(mockCart, actions);
      expect(result).toEqual(updatedCart);
    });
  });

  describe('updateShippingRate', () => {
    it('should update shipping rate successfully', async () => {
      // Arrange
      const mockCart = mockGetCartResult();
      const shippingRateId = 'shipping-method-1';
      const updatedCart = {
        ...mockCart,
        shippingInfo: {
          shippingMethod: {
            id: shippingRateId,
            typeId: 'shipping-method',
          },
        },
      };

      (updateCartById as jest.Mock).mockReturnValue(Promise.resolve(updatedCart));

      // Act
      const result = await updateShippingRate(mockCart, shippingRateId);

      // Assert
      expect(updateCartById).toHaveBeenCalledWith(mockCart, [
        {
          action: 'setShippingMethod',
          shippingMethod: {
            typeId: 'shipping-method',
            id: shippingRateId,
          },
        },
      ]);
      expect(result).toEqual(updatedCart);
    });

    it('should throw and log an error when update fails', async () => {
      // Arrange
      const mockCart = mockGetCartResult();
      const shippingRateId = 'shipping-method-1';
      const errorMessage = 'Failed to update shipping rate';
      const mockError = new Error(errorMessage);

      (updateCartById as jest.Mock).mockReturnValue(Promise.reject(mockError));

      // Act & Assert
      await expect(updateShippingRate(mockCart, shippingRateId)).rejects.toThrow(mockError);
      expect(updateCartById).toHaveBeenCalled();
    });
  });

  describe('removeShippingRate', () => {
    it('should remove shipping rate successfully', async () => {
      // Arrange
      const mockCart = mockGetCartResult();
      const updatedCart = { ...mockCart, shippingInfo: null };

      (updateCartById as jest.Mock).mockReturnValue(updatedCart);

      // Act
      const result = await removeShippingRate(mockCart);

      // Assert
      expect(updateCartById).toHaveBeenCalledWith(mockCart, [
        {
          action: 'setShippingMethod',
        },
      ]);
      expect(result).toEqual(updatedCart);
    });

    it('should throw and log an error when remove fails', async () => {
      // Arrange
      const mockCart = mockGetCartResult();
      const errorMessage = 'Failed to remove shipping rate';
      const mockError = new Error(errorMessage);

      (updateCartById as jest.Mock).mockReturnValue(Promise.reject(mockError));

      // Act & Assert
      await expect(removeShippingRate(mockCart)).rejects.toThrow(mockError);
      expect(updateCartById).toHaveBeenCalled();
    });
  });
});
