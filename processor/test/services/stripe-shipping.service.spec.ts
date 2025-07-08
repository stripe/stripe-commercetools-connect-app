import { describe, beforeEach, afterEach, test, expect, jest } from '@jest/globals';
import { Cart, LineItem, LocalizedString } from '@commercetools/platform-sdk';
import { StripeShippingService } from '../../src/services/stripe-shipping.service';
import { CommercetoolsCartService } from '@commercetools/connect-payments-sdk';
import { mockGetCartResult } from '../utils/mock-cart-data';
import * as ShippingClient from '../../src/services/commerce-tools/shipping-client';
import { ShippingMethodPagedQueryResponse } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/shipping-method';
import { CentPrecisionMoney } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/common';

// Mock the shipping client
jest.mock('../../src/services/commerce-tools/shipping-client');

describe('StripeShippingService', () => {
  let stripeShippingService: StripeShippingService;
  let mockCtCartService: CommercetoolsCartService;

  // Create a properly typed mock cart with shipping
  const mockCartWithShipping: Cart = {
    ...mockGetCartResult(),
    shippingInfo: {
      shippingMethodName: 'Standard Shipping',
      price: {
        centAmount: 500,
        currencyCode: 'USD',
        fractionDigits: 2,
        type: 'centPrecision',
      } as CentPrecisionMoney,
      shippingRate: {
        price: {
          centAmount: 500,
          currencyCode: 'USD',
          fractionDigits: 2,
          type: 'centPrecision',
        } as CentPrecisionMoney,
        tiers: [],
      },
      shippingMethodState: 'MatchesCart' as const,
    },
    lineItems: [
      {
        ...mockGetCartResult().lineItems[0],
        name: { en: 'Test Product' } as LocalizedString,
        price: {
          value: {
            centAmount: 1000,
            currencyCode: 'USD',
          },
        },
        quantity: 1,
      } as LineItem,
    ],
  } as Cart;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCtCartService = {
      getCart: jest.fn(),
    } as unknown as CommercetoolsCartService;

    stripeShippingService = new StripeShippingService({
      ctCartService: mockCtCartService,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getShippingMethods', () => {
    test('should return shipping methods and line items', async () => {
      // Given
      const request = {
        country: 'US',
        state: 'CA',
      };

      const mockCart = mockGetCartResult();
      const mockShippingMethodsResponse: ShippingMethodPagedQueryResponse = {
        offset: 0,
        count: 2,
        total: 2,
        results: [
          {
            id: 'c747be7e-3c41-43bf-a5f0-49c10ef88dae',
            version: 6,
            versionModifiedAt: '2025-07-04T21:16:34.092Z',
            createdAt: '2024-10-25T23:58:45.413Z',
            lastModifiedAt: '2025-07-04T21:16:34.092Z',
            lastModifiedBy: {
              isPlatformClient: true,
              user: {
                typeId: 'user',
                id: '61f7495c-fbfe-4bb2-a657-e233482cb5fe',
              },
            },
            createdBy: {
              isPlatformClient: true,
            },
            name: 'US Delivery',
            localizedName: {
              'en-US': 'US Delivery',
              'de-DE': 'US Delivery',
              'en-GB': 'US Delivery',
            },
            taxCategory: {
              typeId: 'tax-category',
              id: '7546235d-8c8e-410d-b34d-d43cf09765cf',
            },
            zoneRates: [
              {
                zone: {
                  typeId: 'zone',
                  id: '9312c1ec-263d-4d0b-b884-24087cbe527e',
                },
                shippingRates: [
                  {
                    price: {
                      type: 'centPrecision',
                      currencyCode: 'USD',
                      centAmount: 1000,
                      fractionDigits: 2,
                    },
                    freeAbove: {
                      type: 'centPrecision',
                      currencyCode: 'USD',
                      centAmount: 100000,
                      fractionDigits: 2,
                    },
                    isMatching: true,
                    tiers: [],
                  },
                ],
              },
            ],
            active: true,
            isDefault: false,
            predicate: '1 = 1',
            key: 'us-delivery',
            references: [],
          },
          {
            id: '281caa65-73ef-4164-9110-fb82768131cd',
            version: 5,
            createdAt: '2025-07-03T22:54:04.550Z',
            lastModifiedAt: '2025-07-04T21:16:43.893Z',
            lastModifiedBy: {},
            createdBy: {},
            name: 'Express US Delivery',
            localizedName: {
              'en-US': 'Express US Delivery',
            },
            taxCategory: {
              typeId: 'tax-category',
              id: '7546235d-8c8e-410d-b34d-d43cf09765cf',
            },
            zoneRates: [
              {
                zone: {
                  typeId: 'zone',
                  id: '9312c1ec-263d-4d0b-b884-24087cbe527e',
                },
                shippingRates: [
                  {
                    price: {
                      type: 'centPrecision',
                      currencyCode: 'USD',
                      centAmount: 2000,
                      fractionDigits: 2,
                    },
                    freeAbove: {
                      type: 'centPrecision',
                      currencyCode: 'USD',
                      centAmount: 50000,
                      fractionDigits: 2,
                    },
                    isMatching: true,
                    tiers: [],
                  },
                ],
              },
            ],
            active: true,
            isDefault: false,
            predicate: '1 = 1',
          },
        ],
      } as ShippingMethodPagedQueryResponse;

      jest.spyOn(mockCtCartService, 'getCart').mockResolvedValue(mockCart);
      jest.spyOn(ShippingClient, 'getShippingMethodsFromCart').mockResolvedValue(mockShippingMethodsResponse);

      // When
      const result = await stripeShippingService.getShippingMethods(request);

      // Then
      expect(mockCtCartService.getCart).toHaveBeenCalled();
      expect(result.shippingRates).toBeDefined();
      console.log('Shipping Rates:', result.shippingRates![0]);
      expect(result.shippingRates![0]).toEqual({
        id: 'c747be7e-3c41-43bf-a5f0-49c10ef88dae',
        displayName: 'US Delivery',
        amount: 1000,
      });
      expect(result.lineItems).toEqual([]);
    });
  });

  describe('updateShippingRate', () => {
    test('should update shipping rate and return line items with shipping', async () => {
      // Given
      const request = {
        id: 'shipping-method-1',
      };

      const mockCart = mockGetCartResult();
      const updatedCart = mockCartWithShipping;

      jest.spyOn(mockCtCartService, 'getCart').mockResolvedValue(mockCart);
      jest.spyOn(ShippingClient, 'updateShippingRate').mockResolvedValue(updatedCart);

      // When
      const result = await stripeShippingService.updateShippingRate(request);

      // Then
      expect(mockCtCartService.getCart).toHaveBeenCalled();
      expect(ShippingClient.updateShippingRate).toHaveBeenCalledWith(mockCart, 'shipping-method-1');
      expect(result.lineItems).toEqual([
        {
          name: 'Test Product',
          amount: 1000,
        },
        {
          name: 'Shipping',
          amount: 500,
        },
      ]);
    });

    test('should handle cart without shipping info', async () => {
      // Given
      const request = {
        id: 'shipping-method-1',
      };

      const mockCart = mockGetCartResult();
      const updatedCart = {
        ...mockCart,
        shippingInfo: undefined,
      };

      jest.spyOn(mockCtCartService, 'getCart').mockResolvedValue(mockCart);
      jest.spyOn(ShippingClient, 'updateShippingRate').mockResolvedValue(updatedCart);

      // When
      const result = await stripeShippingService.updateShippingRate(request);

      // Then
      expect(result.lineItems).toEqual([
        {
          name: 'lineitem-name-1',
          amount: 150000,
        },
      ]);
    });
  });

  describe('removeShippingRate', () => {
    test('should remove shipping rate and return line items without shipping', async () => {
      // Given
      const mockCart = mockCartWithShipping;
      const updatedCart = {
        ...mockCart,
        shippingInfo: undefined,
      } as Cart;

      jest.spyOn(mockCtCartService, 'getCart').mockResolvedValue(mockCart);
      jest.spyOn(ShippingClient, 'removeShippingRate').mockResolvedValue(updatedCart);

      // When
      const result = await stripeShippingService.removeShippingRate();

      // Then
      expect(mockCtCartService.getCart).toHaveBeenCalled();
      expect(ShippingClient.removeShippingRate).toHaveBeenCalledWith(mockCart);
      expect(result.lineItems).toEqual([
        {
          name: 'Test Product',
          amount: 1000,
        },
      ]);
    });
  });
});
