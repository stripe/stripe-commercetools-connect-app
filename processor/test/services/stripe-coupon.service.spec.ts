/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-require-imports */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock the dependencies
jest.mock('../../src/clients/stripe.client');
jest.mock('../../src/libs/logger');
jest.mock('../../src/utils');

describe('StripeCouponService', () => {
  let service: any;
  let mockStripe: any;
  let mockUtils: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up mock Stripe client
    const { stripeApi } = require('../../src/clients/stripe.client');
    mockStripe = {
      coupons: {
        retrieve: jest.fn(),
        create: jest.fn(),
        del: jest.fn(),
      },
    };
    stripeApi.mockReturnValue(mockStripe);

    // Set up mock utils
    mockUtils = require('../../src/utils');

    // Import and create service
    const { StripeCouponService } = require('../../src/services/stripe-coupon.service');
    service = new StripeCouponService();

    // Manually replace the stripe instance
    Object.defineProperty(service, 'stripe', {
      value: mockStripe,
      writable: true,
    });
  });

  describe('getStripeCoupons', () => {
    it('should return undefined when cart has no discount codes', async () => {
      const cart = { discountCodes: [] };
      const result = await service.getStripeCoupons(cart);
      expect(result).toBeUndefined();
    });

    it('should throw error when discount code object is not found', async () => {
      const cart = {
        discountCodes: [
          {
            discountCode: {
              id: 'discount-123',
              obj: undefined,
            },
          },
        ],
      };

      await expect(service.getStripeCoupons(cart)).rejects.toThrow('Discount code "discount-123" not found');
    });

    it('should throw error when discount has multiple cart discounts', async () => {
      const cart = {
        discountCodes: [
          {
            discountCode: {
              id: 'discount-123',
              obj: {
                cartDiscounts: [{ id: 'cart-discount-1' }, { id: 'cart-discount-2' }],
              },
            },
          },
        ],
      };

      await expect(service.getStripeCoupons(cart)).rejects.toThrow(
        'Discount "discount-123" has multiple cart discounts. Not supported by Stripe.',
      );
    });
  });

  describe('getStripeCouponById', () => {
    it('should return undefined when coupon not found', async () => {
      mockStripe.coupons.retrieve.mockRejectedValue(new Error('Coupon not found'));
      const result = await service.getStripeCouponById('coupon-123');
      expect(result).toBeUndefined();
    });
  });

  describe('createStripeDiscountCode', () => {
    it('should throw error when cart discount not found', async () => {
      const discountCode = {
        id: 'discount-123',
        cartDiscounts: [{ obj: undefined }],
        name: { en: 'Test Discount' },
        validUntil: '2023-12-31T23:59:59Z',
        maxApplications: 100,
      };

      await expect(service.createStripeDiscountCode(discountCode)).rejects.toThrow(
        'Cart discount not found for discount code "discount-123"',
      );
    });

    it('should throw error for unsupported discount types', async () => {
      const discountCode = {
        id: 'discount-123',
        cartDiscounts: [
          {
            obj: {
              value: { type: 'fixed' },
            },
          },
        ],
        name: { en: 'Test Discount' },
        validUntil: '2023-12-31T23:59:59Z',
        maxApplications: 100,
      };

      await expect(service.createStripeDiscountCode(discountCode)).rejects.toThrow(
        'Cart discount type is not supported',
      );
    });
  });

  describe('validateDiscountCode', () => {
    it('should return false when no Stripe coupon provided', () => {
      const discountCode = {
        id: 'discount-123',
        cartDiscounts: [
          {
            obj: {
              value: {
                type: 'relative',
                permyriad: 1000,
              },
            },
          },
        ],
        name: { en: 'Test Discount' },
        validUntil: '2023-12-31T23:59:59Z',
        maxApplications: 100,
      };

      const result = service.validateDiscountCode(discountCode);
      expect(result).toBe(false);
    });

    it('should return false when Stripe coupon is invalid', () => {
      const mockStripeCoupon = {
        id: 'coupon-123',
        valid: false,
        deleted: false,
      };

      const discountCode = {
        id: 'discount-123',
        cartDiscounts: [
          {
            obj: {
              value: {
                type: 'relative',
                permyriad: 1000,
              },
            },
          },
        ],
        name: { en: 'Test Discount' },
        validUntil: '2023-12-31T23:59:59Z',
        maxApplications: 100,
      };

      const result = service.validateDiscountCode(discountCode, mockStripeCoupon);
      expect(result).toBe(false);
    });

    it('should return false when Stripe coupon is deleted', () => {
      const mockStripeCoupon = {
        id: 'coupon-123',
        valid: true,
        deleted: true,
      };

      const discountCode = {
        id: 'discount-123',
        cartDiscounts: [
          {
            obj: {
              value: {
                type: 'relative',
                permyriad: 1000,
              },
            },
          },
        ],
        name: { en: 'Test Discount' },
        validUntil: '2023-12-31T23:59:59Z',
        maxApplications: 100,
      };

      const result = service.validateDiscountCode(discountCode, mockStripeCoupon);
      expect(result).toBe(false);
    });

    it('should return true when all values match', () => {
      const mockStripeCoupon = {
        id: 'coupon-123',
        valid: true,
        deleted: false,
        percent_off: 10,
        currency: 'USD',
        max_redemptions: 100,
        redeem_by: 1234567890,
      };

      const discountCode = {
        id: 'discount-123',
        cartDiscounts: [
          {
            obj: {
              value: {
                type: 'relative',
                permyriad: 1000,
              },
            },
          },
        ],
        name: { en: 'Test Discount' },
        validUntil: '2023-12-31T23:59:59Z',
        maxApplications: 100,
      };

      mockUtils.convertDateToUnixTimestamp.mockReturnValue(1234567890);

      const result = service.validateDiscountCode(discountCode, mockStripeCoupon);
      expect(result).toBe(true);
    });
  });

  describe('getDiscountConfig', () => {
    it('should throw error when cart discount not found', () => {
      const discountCode = {
        id: 'discount-123',
        cartDiscounts: [{ obj: undefined }],
        name: { en: 'Test Discount' },
        validUntil: '2023-12-31T23:59:59Z',
        maxApplications: 100,
      };

      expect(() => service.getDiscountConfig(discountCode)).toThrow(
        'Cart discount not found for discount code "discount-123"',
      );
    });

    it('should throw error for unsupported discount types', () => {
      const discountCode = {
        id: 'discount-123',
        cartDiscounts: [
          {
            obj: {
              value: { type: 'giftLineItem' },
            },
          },
        ],
        name: { en: 'Test Discount' },
        validUntil: '2023-12-31T23:59:59Z',
        maxApplications: 100,
      };

      expect(() => service.getDiscountConfig(discountCode)).toThrow('Cart discount type is not supported');
    });

    it('should return correct config for percentage discount', () => {
      const discountCode = {
        id: 'discount-123',
        cartDiscounts: [
          {
            obj: {
              value: {
                type: 'relative',
                permyriad: 1000,
              },
            },
          },
        ],
        name: { en: 'Test Discount' },
        validUntil: '2023-12-31T23:59:59Z',
        maxApplications: 100,
      };

      mockUtils.convertDateToUnixTimestamp.mockReturnValue(1234567890);
      mockUtils.getLocalizedString.mockReturnValue('Test Discount');

      const result = service.getDiscountConfig(discountCode);

      expect(result).toEqual({
        isPercentage: true,
        isAmountOff: false,
        expirationDate: 1234567890,
        name: 'Test Discount',
        currency: undefined,
        maxRedemptions: 100,
        amountOff: undefined,
        percentOff: 10,
        amount: { percent_off: 10 },
      });
    });

    it('should return correct config for amount discount', () => {
      const discountCode = {
        id: 'discount-123',
        cartDiscounts: [
          {
            obj: {
              value: {
                type: 'absolute',
                money: [
                  {
                    centAmount: 1000,
                    currencyCode: 'USD',
                  },
                ],
              },
            },
          },
        ],
        name: { en: 'Test Discount' },
        validUntil: '2023-12-31T23:59:59Z',
        maxApplications: 100,
      };

      mockUtils.convertDateToUnixTimestamp.mockReturnValue(1234567890);
      mockUtils.getLocalizedString.mockReturnValue('Test Discount');

      const result = service.getDiscountConfig(discountCode);

      expect(result).toEqual({
        isPercentage: false,
        isAmountOff: true,
        expirationDate: 1234567890,
        name: 'Test Discount',
        currency: 'USD',
        maxRedemptions: 100,
        amountOff: 1000,
        percentOff: undefined,
        amount: { amount_off: 1000 },
      });
    });

    it('should handle discount without expiration date', () => {
      const discountCode = {
        id: 'discount-123',
        cartDiscounts: [
          {
            obj: {
              value: {
                type: 'relative',
                permyriad: 1000,
              },
            },
          },
        ],
        name: { en: 'Test Discount' },
        validUntil: undefined,
        maxApplications: 100,
      };

      mockUtils.getLocalizedString.mockReturnValue('Test Discount');

      const result = service.getDiscountConfig(discountCode);

      expect(result).toEqual({
        isPercentage: true,
        isAmountOff: false,
        expirationDate: undefined,
        name: 'Test Discount',
        currency: undefined,
        maxRedemptions: 100,
        amountOff: undefined,
        percentOff: 10,
        amount: { percent_off: 10 },
      });
    });
  });
});
