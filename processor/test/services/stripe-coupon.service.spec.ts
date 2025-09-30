/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock the dependencies
const mockStripeApi = jest.fn();
const mockConvertDateToUnixTimestamp = jest.fn();
const mockGetLocalizedString = jest.fn();
const mockLog = {
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

// Mock modules before importing
jest.doMock('../../src/clients/stripe.client', () => ({
  stripeApi: mockStripeApi,
}));

jest.doMock('../../src/libs/logger', () => ({
  log: mockLog,
}));

jest.doMock('../../src/utils', () => ({
  convertDateToUnixTimestamp: mockConvertDateToUnixTimestamp,
  getLocalizedString: mockGetLocalizedString,
}));

describe('StripeCouponService', () => {
  let service: any;
  let mockStripe: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up mock Stripe client
    mockStripe = {
      coupons: {
        retrieve: jest.fn(),
        create: jest.fn(),
        del: jest.fn(),
      },
    };
    mockStripeApi.mockReturnValue(mockStripe);

    // Set up mock utils
    mockConvertDateToUnixTimestamp.mockReturnValue(1234567890);
    mockGetLocalizedString.mockReturnValue('Test Discount');

    // Clear module cache and re-import
    jest.resetModules();
    const { StripeCouponService } = require('../../src/services/stripe-coupon.service');
    service = new StripeCouponService();
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

    it('should return existing valid coupon when found', async () => {
      const mockStripeCoupon = {
        id: 'coupon-123',
        valid: true,
        deleted: false,
        percent_off: 10,
        currency: 'USD',
        max_redemptions: 100,
        redeem_by: 1234567890,
      };

      const cart = {
        discountCodes: [
          {
            discountCode: {
              id: 'discount-123',
              obj: {
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
              },
            },
          },
        ],
      };

      mockStripe.coupons.retrieve.mockResolvedValue(mockStripeCoupon);

      const result = await service.getStripeCoupons(cart);

      expect(result).toEqual([{ coupon: 'coupon-123' }]);
      expect(mockStripe.coupons.retrieve).toHaveBeenCalledWith('discount-123');
    });

    it('should create new coupon when existing one is invalid', async () => {
      const mockStripeCoupon = {
        id: 'coupon-123',
        valid: false,
        deleted: false,
      };

      const cart = {
        discountCodes: [
          {
            discountCode: {
              id: 'discount-123',
              obj: {
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
              },
            },
          },
        ],
      };

      mockStripe.coupons.retrieve.mockResolvedValue(mockStripeCoupon);
      mockStripe.coupons.del.mockResolvedValue({});
      mockStripe.coupons.create.mockResolvedValue({ id: 'new-coupon-123' });

      const result = await service.getStripeCoupons(cart);

      expect(result).toEqual([{ coupon: 'new-coupon-123' }]);
      expect(mockStripe.coupons.del).toHaveBeenCalledWith('discount-123');
      expect(mockStripe.coupons.create).toHaveBeenCalled();
    });

    it('should create new coupon when no existing coupon found', async () => {
      const cart = {
        discountCodes: [
          {
            discountCode: {
              id: 'discount-123',
              obj: {
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
              },
            },
          },
        ],
      };

      mockStripe.coupons.retrieve.mockRejectedValue(new Error('Coupon not found'));
      mockStripe.coupons.create.mockResolvedValue({ id: 'new-coupon-123' });

      const result = await service.getStripeCoupons(cart);

      expect(result).toEqual([{ coupon: 'new-coupon-123' }]);
      expect(mockStripe.coupons.create).toHaveBeenCalled();
    });

    it('should stop processing after StopAfterThisDiscount stacking mode', async () => {
      const mockStripeCoupon1 = {
        id: 'coupon-123',
        valid: true,
        deleted: false,
        percent_off: 10,
      };

      const cart = {
        discountCodes: [
          {
            discountCode: {
              id: 'discount-123',
              obj: {
                id: 'discount-123',
                cartDiscounts: [
                  {
                    obj: {
                      value: {
                        type: 'relative',
                        permyriad: 1000,
                      },
                      stackingMode: 'StopAfterThisDiscount',
                    },
                  },
                ],
              },
            },
          },
          {
            discountCode: {
              id: 'discount-456',
              obj: {
                id: 'discount-456',
                cartDiscounts: [
                  {
                    obj: {
                      value: {
                        type: 'relative',
                        permyriad: 1500,
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      };

      mockStripe.coupons.retrieve.mockResolvedValue(mockStripeCoupon1);

      const result = await service.getStripeCoupons(cart);

      // Should only process the first discount due to StopAfterThisDiscount
      expect(result).toEqual([{ coupon: 'coupon-123' }]);
      expect(mockStripe.coupons.retrieve).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStripeCouponById', () => {
    it('should return undefined when coupon not found', async () => {
      mockStripe.coupons.retrieve.mockRejectedValue(new Error('Coupon not found'));
      const result = await service.getStripeCouponById('coupon-123');
      expect(result).toBeUndefined();
    });

    it('should return coupon when found successfully', async () => {
      const mockCoupon = {
        id: 'coupon-123',
        valid: true,
        deleted: false,
        percent_off: 10,
      };

      mockStripe.coupons.retrieve.mockResolvedValue(mockCoupon);
      const result = await service.getStripeCouponById('coupon-123');

      expect(result).toEqual(mockCoupon);
      expect(mockStripe.coupons.retrieve).toHaveBeenCalledWith('coupon-123');
    });

    it('should handle any error and return undefined', async () => {
      mockStripe.coupons.retrieve.mockRejectedValue(new Error('Network error'));
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

    it('should create percentage discount successfully', async () => {
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

      const mockCreatedCoupon = { id: 'discount-123' };
      mockStripe.coupons.create.mockResolvedValue(mockCreatedCoupon);

      const result = await service.createStripeDiscountCode(discountCode);

      expect(result).toBe('discount-123');
      expect(mockStripe.coupons.create).toHaveBeenCalledWith({
        id: 'discount-123',
        name: 'Test Discount',
        currency: undefined,
        duration: 'once',
        max_redemptions: 100,
        redeem_by: 1234567890,
        percent_off: 10,
      });
    });

    it('should create amount discount successfully', async () => {
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

      const mockCreatedCoupon = { id: 'discount-123' };
      mockStripe.coupons.create.mockResolvedValue(mockCreatedCoupon);

      const result = await service.createStripeDiscountCode(discountCode);

      expect(result).toBe('discount-123');
      expect(mockStripe.coupons.create).toHaveBeenCalledWith({
        id: 'discount-123',
        name: 'Test Discount',
        currency: 'USD',
        duration: 'once',
        max_redemptions: 100,
        redeem_by: 1234567890,
        amount_off: 1000,
      });
    });

    it('should create discount without expiration date', async () => {
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

      const mockCreatedCoupon = { id: 'discount-123' };
      mockStripe.coupons.create.mockResolvedValue(mockCreatedCoupon);

      const result = await service.createStripeDiscountCode(discountCode);

      expect(result).toBe('discount-123');
      expect(mockStripe.coupons.create).toHaveBeenCalledWith({
        id: 'discount-123',
        name: 'Test Discount',
        currency: undefined,
        duration: 'once',
        max_redemptions: 100,
        redeem_by: undefined,
        percent_off: 10,
      });
    });

    it('should create discount without max applications', async () => {
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
        maxApplications: undefined,
      };

      const mockCreatedCoupon = { id: 'discount-123' };
      mockStripe.coupons.create.mockResolvedValue(mockCreatedCoupon);

      const result = await service.createStripeDiscountCode(discountCode);

      expect(result).toBe('discount-123');
      expect(mockStripe.coupons.create).toHaveBeenCalledWith({
        id: 'discount-123',
        name: 'Test Discount',
        currency: undefined,
        duration: 'once',
        max_redemptions: undefined,
        redeem_by: 1234567890,
        percent_off: 10,
      });
    });
  });

  describe('deleteStripeDiscountCode', () => {
    it('should delete coupon successfully', async () => {
      mockStripe.coupons.del.mockResolvedValue({});

      await service.deleteStripeDiscountCode('coupon-123');

      expect(mockStripe.coupons.del).toHaveBeenCalledWith('coupon-123');
    });

    it('should handle deletion error gracefully', async () => {
      const mockError = new Error('Deletion failed');
      mockStripe.coupons.del.mockRejectedValue(mockError);

      // Should not throw error
      await expect(service.deleteStripeDiscountCode('coupon-123')).resolves.toBeUndefined();

      expect(mockStripe.coupons.del).toHaveBeenCalledWith('coupon-123');
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

      const result = service.validateDiscountCode(discountCode, mockStripeCoupon);
      expect(result).toBe(true);
    });

    it('should return false when percentage values differ', () => {
      const mockStripeCoupon = {
        id: 'coupon-123',
        valid: true,
        deleted: false,
        percent_off: 15, // Different from expected 10
      };

      const discountCode = {
        id: 'discount-123',
        cartDiscounts: [
          {
            obj: {
              value: {
                type: 'relative',
                permyriad: 1000, // This should be 10%
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

    it('should return false when amount values differ', () => {
      const mockStripeCoupon = {
        id: 'coupon-123',
        valid: true,
        deleted: false,
        amount_off: 2000, // Different from expected 1000
        currency: 'USD',
      };

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

      const result = service.validateDiscountCode(discountCode, mockStripeCoupon);
      expect(result).toBe(false);
    });

    it('should return false when expiration dates differ', () => {
      const mockStripeCoupon = {
        id: 'coupon-123',
        valid: true,
        deleted: false,
        percent_off: 10,
        redeem_by: 9999999999, // Different expiration date
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

    it('should return false when currency differs', () => {
      const mockStripeCoupon = {
        id: 'coupon-123',
        valid: true,
        deleted: false,
        amount_off: 1000,
        currency: 'EUR', // Different currency
      };

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

      const result = service.validateDiscountCode(discountCode, mockStripeCoupon);
      expect(result).toBe(false);
    });

    it('should return false when max redemptions differ', () => {
      const mockStripeCoupon = {
        id: 'coupon-123',
        valid: true,
        deleted: false,
        percent_off: 10,
        max_redemptions: 50, // Different from expected 100
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

    it('should return true when optional fields are undefined', () => {
      const mockStripeCoupon = {
        id: 'coupon-123',
        valid: true,
        deleted: false,
        percent_off: 10,
        currency: undefined,
        max_redemptions: undefined,
        redeem_by: undefined,
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
        validUntil: undefined,
        maxApplications: undefined,
      };

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
