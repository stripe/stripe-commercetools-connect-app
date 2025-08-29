import { describe, beforeEach, afterEach, test, expect, jest } from '@jest/globals';
import { Cart, LineItem, LocalizedString, ShippingMethod } from '@commercetools/platform-sdk';
import { StripeShippingService } from '../../src/services/stripe-shipping.service';
import { CommercetoolsCartService } from '@commercetools/connect-payments-sdk';
import { mockGetCartResult } from '../utils/mock-cart-data';
import * as ShippingClient from '../../src/services/commerce-tools/shipping-client';
import { ShippingMethodPagedQueryResponse } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/shipping-method';
import { CentPrecisionMoney } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/common';
import * as Context from '../../src/libs/fastify/context/context';
import * as StripeClient from '../../src/clients/stripe.client';

// Mock the shipping client
jest.mock('../../src/services/commerce-tools/shipping-client');
jest.mock('../../src/libs/fastify/context/context');
jest.mock('../../src/clients/stripe.client');
jest.mock('../../src/libs/logger');

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
      shippingMethod: {
        id: 'existing-shipping-method-id',
        typeId: 'shipping-method',
      },
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

  const mockCartWithExistingShippingMethod: Cart = {
    ...mockGetCartResult(),
    shippingInfo: {
      shippingMethodName: 'Existing Method',
      price: {
        centAmount: 300,
        currencyCode: 'USD',
        fractionDigits: 2,
        type: 'centPrecision',
      } as CentPrecisionMoney,
      shippingRate: {
        price: {
          centAmount: 300,
          currencyCode: 'USD',
          fractionDigits: 2,
          type: 'centPrecision',
        } as CentPrecisionMoney,
        tiers: [],
      },
      shippingMethodState: 'MatchesCart' as const,
      shippingMethod: {
        id: 'existing-method-id',
        typeId: 'shipping-method',
      },
    },
  } as Cart;

  const mockCartWithMissingLineItems: Cart = {
    ...mockGetCartResult(),
    lineItems: undefined as unknown as LineItem[],
  } as Cart;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCtCartService = {
      getCart: jest.fn(),
    } as unknown as CommercetoolsCartService;

    stripeShippingService = new StripeShippingService({
      ctCartService: mockCtCartService,
    });

    (Context.getCartIdFromContext as jest.Mock).mockReturnValue('test-cart-id');
    (StripeClient.wrapStripeError as jest.Mock).mockImplementation((error) => error);
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
      jest.spyOn(ShippingClient, 'updateShippingAddress').mockResolvedValue(mockCart);
      jest.spyOn(ShippingClient, 'updateShippingRate').mockResolvedValue(mockCart);

      // When
      const result = await stripeShippingService.getShippingMethods(request);

      // Then
      expect(mockCtCartService.getCart).toHaveBeenCalled();
      expect(result.shippingRates).toBeDefined();
      expect(result.shippingRates![0]).toEqual({
        id: 'c747be7e-3c41-43bf-a5f0-49c10ef88dae',
        displayName: 'US Delivery',
        amount: 1000,
      });
      expect(result.lineItems).toEqual([
        {
          name: 'lineitem-name-1',
          amount: 150000,
        },
        {
          name: 'Shipping',
          amount: 150000,
        },
      ]);
    });

    test('should prioritize existing shipping method in cart', async () => {
      // Given
      const request = {
        country: 'US',
        state: 'CA',
      };

      const mockShippingMethodsResponse: ShippingMethodPagedQueryResponse = {
        offset: 0,
        count: 2,
        total: 2,
        results: [
          {
            id: 'new-method-id',
            name: 'New Method',
            zoneRates: [
              {
                shippingRates: [
                  {
                    price: {
                      type: 'centPrecision',
                      currencyCode: 'USD',
                      centAmount: 1000,
                      fractionDigits: 2,
                    },
                  },
                ],
              },
            ],
          } as unknown as ShippingMethod,
          {
            id: 'existing-method-id',
            name: 'Existing Method',
            zoneRates: [
              {
                shippingRates: [
                  {
                    price: {
                      type: 'centPrecision',
                      currencyCode: 'USD',
                      centAmount: 300,
                      fractionDigits: 2,
                    },
                  },
                ],
              },
            ],
          } as unknown as ShippingMethod,
        ],
      };

      jest.spyOn(mockCtCartService, 'getCart').mockResolvedValue(mockCartWithExistingShippingMethod);
      jest.spyOn(ShippingClient, 'getShippingMethodsFromCart').mockResolvedValue(mockShippingMethodsResponse);
      jest.spyOn(ShippingClient, 'updateShippingAddress').mockResolvedValue(mockCartWithExistingShippingMethod);

      // When
      const result = await stripeShippingService.getShippingMethods(request);

      // Then
      expect(result.shippingRates![0].id).toBe('existing-method-id');
      expect(result.shippingRates![0].displayName).toBe('Existing Method');
    });

    test('should throw error when no shipping methods found', async () => {
      // Given
      const request = {
        country: 'US',
        state: 'CA',
      };

      const mockCart = mockGetCartResult();
      const mockShippingMethodsResponse: ShippingMethodPagedQueryResponse = {
        offset: 0,
        count: 0,
        total: 0,
        results: [],
      };

      jest.spyOn(mockCtCartService, 'getCart').mockResolvedValue(mockCart);
      jest.spyOn(ShippingClient, 'getShippingMethodsFromCart').mockResolvedValue(mockShippingMethodsResponse);
      jest.spyOn(ShippingClient, 'updateShippingAddress').mockResolvedValue(mockCart);

      // When & Then
      await expect(stripeShippingService.getShippingMethods(request)).rejects.toThrow(
        'No shipping methods found for the given address.',
      );
    });

    test('should handle shipping methods with missing zoneRates', async () => {
      // Given
      const request = {
        country: 'US',
        state: 'CA',
      };

      const mockCart = mockGetCartResult();
      const mockShippingMethodsResponse: ShippingMethodPagedQueryResponse = {
        offset: 0,
        count: 1,
        total: 1,
        results: [
          {
            id: 'method-without-zones',
            name: 'Method Without Zones',
            zoneRates: [],
          } as unknown as ShippingMethod,
        ],
      };

      jest.spyOn(mockCtCartService, 'getCart').mockResolvedValue(mockCart);
      jest.spyOn(ShippingClient, 'getShippingMethodsFromCart').mockResolvedValue(mockShippingMethodsResponse);
      jest.spyOn(ShippingClient, 'updateShippingAddress').mockResolvedValue(mockCart);

      // When
      const result = await stripeShippingService.getShippingMethods(request);

      // Then
      expect(result.shippingRates![0].amount).toBe(0);
    });

    test('should handle shipping methods with missing shippingRates', async () => {
      // Given
      const request = {
        country: 'US',
        state: 'CA',
      };

      const mockCart = mockGetCartResult();
      const mockShippingMethodsResponse: ShippingMethodPagedQueryResponse = {
        offset: 0,
        count: 1,
        total: 1,
        results: [
          {
            id: 'method-without-rates',
            name: 'Method Without Rates',
            zoneRates: [
              {
                shippingRates: [],
              },
            ],
          } as unknown as ShippingMethod,
        ],
      };

      jest.spyOn(mockCtCartService, 'getCart').mockResolvedValue(mockCart);
      jest.spyOn(ShippingClient, 'getShippingMethodsFromCart').mockResolvedValue(mockShippingMethodsResponse);
      jest.spyOn(ShippingClient, 'updateShippingAddress').mockResolvedValue(mockCart);

      const result = await stripeShippingService.getShippingMethods(request);

      expect(result.shippingRates![0].amount).toBe(0);
    });

    test('should handle shipping methods with missing price', async () => {
      const request = {
        country: 'US',
        state: 'CA',
      };

      const mockCart = mockGetCartResult();
      const mockShippingMethodsResponse: ShippingMethodPagedQueryResponse = {
        offset: 0,
        count: 1,
        total: 1,
        results: [
          {
            id: 'method-without-price',
            name: 'Method Without Price',
            zoneRates: [
              {
                shippingRates: [
                  {
                    price: undefined,
                  },
                ],
              },
            ],
          } as unknown as ShippingMethod,
        ],
      };

      jest.spyOn(mockCtCartService, 'getCart').mockResolvedValue(mockCart);
      jest.spyOn(ShippingClient, 'getShippingMethodsFromCart').mockResolvedValue(mockShippingMethodsResponse);
      jest.spyOn(ShippingClient, 'updateShippingAddress').mockResolvedValue(mockCart);

      const result = await stripeShippingService.getShippingMethods(request);

      expect(result.shippingRates![0].amount).toBe(0);
    });

    test('should handle error in getShippingMethods', async () => {
      const request = {
        country: 'US',
        state: 'CA',
      };

      const mockError = new Error('Test error');
      jest.spyOn(mockCtCartService, 'getCart').mockRejectedValue(mockError);

      await expect(stripeShippingService.getShippingMethods(request)).rejects.toThrow('Test error');
      expect(StripeClient.wrapStripeError).toHaveBeenCalledWith(mockError);
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
          amount: 150000,
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

    test('should handle error in updateShippingRate', async () => {
      const request = {
        id: 'shipping-method-1',
      };

      const mockError = new Error('Test error');
      jest.spyOn(mockCtCartService, 'getCart').mockRejectedValue(mockError);

      await expect(stripeShippingService.updateShippingRate(request)).rejects.toThrow('Test error');
      expect(StripeClient.wrapStripeError).toHaveBeenCalledWith(mockError);
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
          amount: 150000,
        },
      ]);
    });

    test('should handle error in removeShippingRate', async () => {
      const mockError = new Error('Test error');
      jest.spyOn(mockCtCartService, 'getCart').mockRejectedValue(mockError);

      await expect(stripeShippingService.removeShippingRate()).rejects.toThrow('Test error');
      expect(StripeClient.wrapStripeError).toHaveBeenCalledWith(mockError);
    });
  });

  describe('getCartLineItems (private method)', () => {
    test('should handle cart with missing lineItems', async () => {
      const request = {
        id: 'shipping-method-1',
      };

      const mockCart = mockCartWithMissingLineItems;
      const updatedCart = {
        ...mockCart,
        shippingInfo: {
          shippingMethodName: 'Test Shipping',
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
      };

      jest.spyOn(mockCtCartService, 'getCart').mockResolvedValue(mockCart);
      jest.spyOn(ShippingClient, 'updateShippingRate').mockResolvedValue(updatedCart);

      const result = await stripeShippingService.updateShippingRate(request);

      expect(result.lineItems).toEqual([]);
    });

    test('should handle cart with missing shippingInfo.price', async () => {
      const request = {
        id: 'shipping-method-1',
      };

      const mockCart = mockGetCartResult();
      const updatedCart = {
        ...mockCart,
        shippingInfo: {
          shippingMethodName: 'Test Shipping',
          price: {
            centAmount: 0,
            currencyCode: 'USD',
            fractionDigits: 2,
            type: 'centPrecision',
          } as CentPrecisionMoney,
          shippingRate: {
            price: {
              centAmount: 0,
              currencyCode: 'USD',
              fractionDigits: 2,
              type: 'centPrecision',
            } as CentPrecisionMoney,
            tiers: [],
          },
          shippingMethodState: 'MatchesCart' as const,
        },
      };

      jest.spyOn(mockCtCartService, 'getCart').mockResolvedValue(mockCart);
      jest.spyOn(ShippingClient, 'updateShippingRate').mockResolvedValue(updatedCart);

      const result = await stripeShippingService.updateShippingRate(request);

      expect(result.lineItems).toEqual([
        {
          name: 'lineitem-name-1',
          amount: 150000,
        },
        {
          name: 'Shipping',
          amount: 0,
        },
      ]);
    });

    test('should handle error in getCartLineItems and return empty array', async () => {
      // Given
      const request = {
        id: 'shipping-method-1',
      };

      const mockCart = mockGetCartResult();
      const updatedCart = {
        ...mockCart,
        lineItems: [
          {
            ...mockGetCartResult().lineItems[0],
            totalPrice: null, // This will cause an error when accessing centAmount
          },
        ],
      } as unknown as Cart;

      jest.spyOn(mockCtCartService, 'getCart').mockResolvedValue(mockCart);
      jest.spyOn(ShippingClient, 'updateShippingRate').mockResolvedValue(updatedCart);

      const result = await stripeShippingService.updateShippingRate(request);

      expect(result.lineItems).toEqual([]);
    });

    test('should handle cart with undefined shippingInfo.price', async () => {
      const request = {
        id: 'shipping-method-1',
      };

      const mockCart = mockGetCartResult();
      const updatedCart = {
        ...mockCart,
        shippingInfo: {
          shippingMethodName: 'Test Shipping',
          price: undefined,
          shippingRate: {
            price: {
              centAmount: 0,
              currencyCode: 'USD',
              fractionDigits: 2,
              type: 'centPrecision',
            } as CentPrecisionMoney,
            tiers: [],
          },
          shippingMethodState: 'MatchesCart' as const,
        },
      } as unknown as Cart;

      jest.spyOn(mockCtCartService, 'getCart').mockResolvedValue(mockCart);
      jest.spyOn(ShippingClient, 'updateShippingRate').mockResolvedValue(updatedCart);

      const result = await stripeShippingService.updateShippingRate(request);

      expect(result.lineItems).toEqual([
        {
          name: 'lineitem-name-1',
          amount: 150000,
        },
      ]);
    });
  });

  describe('getShippingMethods - additional branch coverage', () => {
    test('should handle cart with existing shipping method that does not match found methods', async () => {
      const request = {
        country: 'US',
        state: 'CA',
      };

      const mockCart = mockGetCartResult();
      const updatedCart = {
        ...mockCart,
        shippingInfo: {
          shippingMethodName: 'Existing Method',
          price: {
            centAmount: 300,
            currencyCode: 'USD',
            fractionDigits: 2,
            type: 'centPrecision',
          } as CentPrecisionMoney,
          shippingRate: {
            price: {
              centAmount: 300,
              currencyCode: 'USD',
              fractionDigits: 2,
              type: 'centPrecision',
            } as CentPrecisionMoney,
            tiers: [],
          },
          shippingMethodState: 'MatchesCart' as const,
          shippingMethod: {
            id: 'non-matching-method-id',
            typeId: 'shipping-method',
          },
        },
      } as unknown as Cart;

      const mockShippingMethodsResponse: ShippingMethodPagedQueryResponse = {
        offset: 0,
        count: 1,
        total: 1,
        results: [
          {
            id: 'found-method-id',
            name: 'Found Method',
            zoneRates: [
              {
                shippingRates: [
                  {
                    price: {
                      type: 'centPrecision',
                      currencyCode: 'USD',
                      centAmount: 1000,
                      fractionDigits: 2,
                    },
                  },
                ],
              },
            ],
          } as unknown as ShippingMethod,
        ],
      };

      jest.spyOn(mockCtCartService, 'getCart').mockResolvedValue(mockCart);
      jest.spyOn(ShippingClient, 'getShippingMethodsFromCart').mockResolvedValue(mockShippingMethodsResponse);
      jest.spyOn(ShippingClient, 'updateShippingAddress').mockResolvedValue(updatedCart);
      jest.spyOn(ShippingClient, 'updateShippingRate').mockResolvedValue(updatedCart);

      const result = await stripeShippingService.getShippingMethods(request);

      expect(result.shippingRates![0].id).toBe('found-method-id');
      expect(result.shippingRates![0].displayName).toBe('Found Method');
      expect(ShippingClient.updateShippingRate).not.toHaveBeenCalled();
    });

    test('should handle cart with no shippingInfo (null)', async () => {
      const request = {
        country: 'US',
        state: 'CA',
      };

      const mockCart = mockGetCartResult();
      const updatedCart = {
        ...mockCart,
        shippingInfo: null,
      } as unknown as Cart;

      const mockShippingMethodsResponse: ShippingMethodPagedQueryResponse = {
        offset: 0,
        count: 1,
        total: 1,
        results: [
          {
            id: 'found-method-id',
            name: 'Found Method',
            zoneRates: [
              {
                shippingRates: [
                  {
                    price: {
                      type: 'centPrecision',
                      currencyCode: 'USD',
                      centAmount: 1000,
                      fractionDigits: 2,
                    },
                  },
                ],
              },
            ],
          } as unknown as ShippingMethod,
        ],
      };

      jest.spyOn(mockCtCartService, 'getCart').mockResolvedValue(mockCart);
      jest.spyOn(ShippingClient, 'getShippingMethodsFromCart').mockResolvedValue(mockShippingMethodsResponse);
      jest.spyOn(ShippingClient, 'updateShippingAddress').mockResolvedValue(updatedCart);
      jest.spyOn(ShippingClient, 'updateShippingRate').mockResolvedValue(updatedCart);

      const result = await stripeShippingService.getShippingMethods(request);

      expect(result.shippingRates![0].id).toBe('found-method-id');
      expect(ShippingClient.updateShippingRate).toHaveBeenCalledWith(updatedCart, 'found-method-id');
    });

    test('should handle cart with shippingInfo but no shippingMethod', async () => {
      const request = {
        country: 'US',
        state: 'CA',
      };

      const mockCart = mockGetCartResult();
      const updatedCart = {
        ...mockCart,
        shippingInfo: {
          shippingMethodName: 'Test Shipping',
          price: {
            centAmount: 300,
            currencyCode: 'USD',
            fractionDigits: 2,
            type: 'centPrecision',
          } as CentPrecisionMoney,
          shippingRate: {
            price: {
              centAmount: 300,
              currencyCode: 'USD',
              fractionDigits: 2,
              type: 'centPrecision',
            } as CentPrecisionMoney,
            tiers: [],
          },
          shippingMethodState: 'MatchesCart' as const,
          // Missing shippingMethod
        },
      } as unknown as Cart;

      const mockShippingMethodsResponse: ShippingMethodPagedQueryResponse = {
        offset: 0,
        count: 1,
        total: 1,
        results: [
          {
            id: 'found-method-id',
            name: 'Found Method',
            zoneRates: [
              {
                shippingRates: [
                  {
                    price: {
                      type: 'centPrecision',
                      currencyCode: 'USD',
                      centAmount: 1000,
                      fractionDigits: 2,
                    },
                  },
                ],
              },
            ],
          } as unknown as ShippingMethod,
        ],
      };

      jest.spyOn(mockCtCartService, 'getCart').mockResolvedValue(mockCart);
      jest.spyOn(ShippingClient, 'getShippingMethodsFromCart').mockResolvedValue(mockShippingMethodsResponse);
      jest.spyOn(ShippingClient, 'updateShippingAddress').mockResolvedValue(updatedCart);
      jest.spyOn(ShippingClient, 'updateShippingRate').mockResolvedValue(updatedCart);

      const result = await stripeShippingService.getShippingMethods(request);

      expect(result.shippingRates![0].id).toBe('found-method-id');
      expect(ShippingClient.updateShippingRate).toHaveBeenCalledWith(updatedCart, 'found-method-id');
    });

    test('should handle cart with existing shipping method at index 0 (no reordering)', async () => {
      const request = {
        country: 'US',
        state: 'CA',
      };

      const mockCart = mockGetCartResult();
      const updatedCart = {
        ...mockCart,
        shippingInfo: {
          shippingMethodName: 'Existing Method',
          price: {
            centAmount: 300,
            currencyCode: 'USD',
            fractionDigits: 2,
            type: 'centPrecision',
          } as CentPrecisionMoney,
          shippingRate: {
            price: {
              centAmount: 300,
              currencyCode: 'USD',
              fractionDigits: 2,
              type: 'centPrecision',
            } as CentPrecisionMoney,
            tiers: [],
          },
          shippingMethodState: 'MatchesCart' as const,
          shippingMethod: {
            id: 'existing-method-id',
            typeId: 'shipping-method',
          },
        },
      } as unknown as Cart;

      const mockShippingMethodsResponse: ShippingMethodPagedQueryResponse = {
        offset: 0,
        count: 2,
        total: 2,
        results: [
          {
            id: 'existing-method-id',
            name: 'Existing Method',
            zoneRates: [
              {
                shippingRates: [
                  {
                    price: {
                      type: 'centPrecision',
                      currencyCode: 'USD',
                      centAmount: 300,
                      fractionDigits: 2,
                    },
                  },
                ],
              },
            ],
          } as unknown as ShippingMethod,
          {
            id: 'other-method-id',
            name: 'Other Method',
            zoneRates: [
              {
                shippingRates: [
                  {
                    price: {
                      type: 'centPrecision',
                      currencyCode: 'USD',
                      centAmount: 1000,
                      fractionDigits: 2,
                    },
                  },
                ],
              },
            ],
          } as unknown as ShippingMethod,
        ],
      };

      jest.spyOn(mockCtCartService, 'getCart').mockResolvedValue(mockCart);
      jest.spyOn(ShippingClient, 'getShippingMethodsFromCart').mockResolvedValue(mockShippingMethodsResponse);
      jest.spyOn(ShippingClient, 'updateShippingAddress').mockResolvedValue(updatedCart);

      const result = await stripeShippingService.getShippingMethods(request);

      expect(result.shippingRates![0].id).toBe('existing-method-id');
      expect(result.shippingRates![1].id).toBe('other-method-id');
      expect(ShippingClient.updateShippingRate).not.toHaveBeenCalled();
    });
  });
});
