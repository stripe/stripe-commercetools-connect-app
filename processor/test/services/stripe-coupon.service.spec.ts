/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { Cart, DiscountCodeInfo, LineItem } from '@commercetools/platform-sdk';
import { customLineItem, lineItem, mockGetSubscriptionCartWithVariant, shippingInfo } from '../utils/mock-cart-data';

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
  redactError: (error: unknown) =>
    error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) },
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
    // ADR-026 addendum (2026-11-10): the refusal body carries a stable code and a reason, never the cart,
    // discount code or discount ids — those stay in the warn log.
    it('refuses a non-representable code with a body of code + reason only, ids in the log', async () => {
      const cart = {
        ...mockGetSubscriptionCartWithVariant(1),
        discountCodes: [
          {
            state: 'MatchesCart',
            discountCode: {
              typeId: 'discount-code',
              id: 'discount-123',
              obj: { id: 'discount-123', cartDiscounts: [{ id: 'cd-1', obj: { target: { type: 'shipping' } } }] },
            },
          },
        ],
      };

      const error: any = await service.getStripeCoupons(cart).catch((e: unknown) => e);

      expect(error.code).toBe('UnsupportedCartDiscountForSubscription');
      expect(error.httpErrorStatus).toBe(400);
      expect(error.fields).toEqual({ reason: 'unsupported-code-target' });
      expect(error.message).not.toMatch(/discount-123|cd-1|shipping/);
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ ctDiscountCodeId: 'discount-123', discountTarget: 'shipping' }),
      );
      expect(mockStripe.coupons.create).not.toHaveBeenCalled();
    });

    it('should return undefined when cart has no discount codes', async () => {
      const cart = { discountCodes: [] };
      const result = await service.getStripeCoupons(cart);
      expect(result).toBeUndefined();
    });

    it('should throw error when discount code object is not found', async () => {
      const cart = {
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 10000, fractionDigits: 2 },
        discountCodes: [
          {
            state: 'MatchesCart',
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
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 10000, fractionDigits: 2 },
        discountCodes: [
          {
            state: 'MatchesCart',
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
        max_redemptions: null,
        redeem_by: 1234567890,
      };

      const cart = {
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 10000, fractionDigits: 2 },
        discountCodes: [
          {
            state: 'MatchesCart',
            discountCode: {
              id: 'discount-123',
              obj: {
                id: 'discount-123',
                // Same expiry Stripe stored (convertDateToUnixTimestamp is mocked to 1234567890): in sync.
                validUntil: '2009-02-13T23:31:30Z',
                cartDiscounts: [
                  {
                    obj: {
                      value: {
                        type: 'relative',
                        permyriad: 1000,
                      },
                      target: { type: 'totalPrice' },
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

    // The merchant-edit path Rule 3 exists for: the stored coupon is still usable, but its
    // configuration no longer reflects commercetools, so it is replaced.
    it('should re-sync a usable coupon whose configuration no longer matches commercetools', async () => {
      const mockStripeCoupon = {
        id: 'coupon-123',
        valid: true,
        deleted: false,
        percent_off: 5,
        max_redemptions: null,
        redeem_by: null,
      };

      const cart = {
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 10000, fractionDigits: 2 },
        discountCodes: [
          {
            state: 'MatchesCart',
            discountCode: {
              id: 'discount-123',
              obj: {
                id: 'discount-123',
                cartDiscounts: [
                  { obj: { value: { type: 'relative', permyriad: 1000 }, target: { type: 'totalPrice' } } },
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

    // The defect this fix closes: recreating the coupon on the same id hands it a fresh redemption
    // counter, so the limit Stripe was applying would be cleared every time it was reached.
    it('should not delete or recreate a coupon Stripe reports as spent while it matches commercetools', async () => {
      const mockStripeCoupon = {
        id: 'coupon-123',
        valid: false,
        deleted: false,
        percent_off: 10,
        max_redemptions: null,
        redeem_by: null,
      };

      const cart = {
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 10000, fractionDigits: 2 },
        discountCodes: [
          {
            state: 'MatchesCart',
            discountCode: {
              id: 'discount-123',
              obj: {
                id: 'discount-123',
                cartDiscounts: [
                  { obj: { value: { type: 'relative', permyriad: 1000 }, target: { type: 'totalPrice' } } },
                ],
              },
            },
          },
        ],
      };

      mockStripe.coupons.retrieve.mockResolvedValue(mockStripeCoupon);

      await expect(service.getStripeCoupons(cart)).rejects.toThrow('no longer applicable');
      expect(mockStripe.coupons.del).not.toHaveBeenCalled();
      expect(mockStripe.coupons.create).not.toHaveBeenCalled();
    });

    // Same path as the spent coupon: expiry is a reason Stripe will not apply it, not evidence that
    // commercetools changed anything. `redeem_by` still matches CT, so there is nothing to re-sync.
    it('should not delete or recreate a coupon that is past its redeem_by date', async () => {
      const mockStripeCoupon = {
        id: 'coupon-123',
        valid: false,
        deleted: false,
        percent_off: 10,
        max_redemptions: null,
        redeem_by: 1234567890,
      };

      const cart = {
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 10000, fractionDigits: 2 },
        discountCodes: [
          {
            state: 'MatchesCart',
            discountCode: {
              id: 'discount-123',
              obj: {
                id: 'discount-123',
                validUntil: '2023-12-31T23:59:59Z',
                cartDiscounts: [
                  { obj: { value: { type: 'relative', permyriad: 1000 }, target: { type: 'totalPrice' } } },
                ],
              },
            },
          },
        ],
      };

      mockStripe.coupons.retrieve.mockResolvedValue(mockStripeCoupon);

      await expect(service.getStripeCoupons(cart)).rejects.toThrow('no longer applicable');
      expect(mockStripe.coupons.del).not.toHaveBeenCalled();
      expect(mockStripe.coupons.create).not.toHaveBeenCalled();
    });

    // The merchant removed validUntil in commercetools after the coupon was created with redeem_by. Stripe
    // cannot edit redeem_by in place, so once the old date passes the coupon is unusable while commercetools
    // still reports MatchesCart. It must be recreated without the date, not refused on every checkout.
    it.each([
      ['after the old date passed (Stripe reports it unusable)', false],
      ['before the old date passes (still usable)', true],
    ])(
      'should recreate, once and without the date, a coupon whose expiration was removed in commercetools — %s',
      async (_phase, valid) => {
        mockStripe.coupons.retrieve.mockResolvedValue({
          id: 'discount-123',
          valid,
          deleted: false,
          percent_off: 10,
          max_redemptions: null,
          redeem_by: 1234567890,
        });
        mockStripe.coupons.create.mockResolvedValue({ id: 'discount-123' });

        const cart = {
          totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 10000, fractionDigits: 2 },
          discountCodes: [
            {
              state: 'MatchesCart',
              discountCode: {
                id: 'discount-123',
                obj: {
                  id: 'discount-123',
                  cartDiscounts: [
                    { obj: { value: { type: 'relative', permyriad: 1000 }, target: { type: 'totalPrice' } } },
                  ],
                },
              },
            },
          ],
        };

        await expect(service.getStripeCoupons(cart)).resolves.toEqual([{ coupon: 'discount-123' }]);
        expect(mockStripe.coupons.del).toHaveBeenCalledWith('discount-123');
        expect(mockStripe.coupons.create).toHaveBeenCalledTimes(1);
        expect(mockStripe.coupons.create).toHaveBeenCalledWith(expect.objectContaining({ redeem_by: undefined }));
      },
    );

    // Coupons created before the cap stopped being mirrored still carry one. They are replaced once,
    // on first touch, so they stop going invalid on exhaustion.
    it('should replace a stored coupon that still carries a mirrored redemption cap', async () => {
      const mockStripeCoupon = {
        id: 'coupon-123',
        valid: true,
        deleted: false,
        percent_off: 10,
        max_redemptions: 1,
        redeem_by: null,
      };

      const cart = {
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 10000, fractionDigits: 2 },
        discountCodes: [
          {
            state: 'MatchesCart',
            discountCode: {
              id: 'discount-123',
              obj: {
                id: 'discount-123',
                maxApplications: 1,
                cartDiscounts: [
                  { obj: { value: { type: 'relative', permyriad: 1000 }, target: { type: 'totalPrice' } } },
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
      expect(mockStripe.coupons.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ max_redemptions: expect.anything() }),
      );
    });

    it('should create new coupon when no existing coupon found', async () => {
      const cart = {
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 10000, fractionDigits: 2 },
        discountCodes: [
          {
            state: 'MatchesCart',
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
                      target: { type: 'totalPrice' },
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

    // Inverted. This asserted that a cart discount carrying StopAfterThisDiscount made the connector
    // drop every later code — re-deriving commercetools' stacking verdict from configuration, which
    // Rule 3 forbids, and getting it wrong: CT stacks by `sortOrder` while `cart.discountCodes` is in
    // insertion order, so a stopping discount that sorted last (and stopped nothing) still dropped a
    // code CT had applied, and Stripe collected more than the cart total. Anything CT actually stops
    // arrives as ApplicationStoppedByPreviousDiscount and never reaches the loop.
    it('should translate every code commercetools applied, ignoring StopAfterThisDiscount', async () => {
      const cart = {
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 10000, fractionDigits: 2 },
        discountCodes: [
          {
            state: 'MatchesCart',
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
                      target: { type: 'totalPrice' },
                      stackingMode: 'StopAfterThisDiscount',
                    },
                  },
                ],
              },
            },
          },
          {
            state: 'MatchesCart',
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
                      target: { type: 'totalPrice' },
                    },
                  },
                ],
              },
            },
          },
        ],
      };

      // Both codes now reach Stripe, so both need a coupon behind them. Each stored coupon matches its
      // own CT configuration, so neither is re-synced — the test is about how many are translated.
      const percentByCode: Record<string, number> = { 'discount-123': 10, 'discount-456': 20 };
      mockStripe.coupons.retrieve.mockImplementation((id: string) =>
        Promise.resolve({ id, valid: true, deleted: false, percent_off: percentByCode[id] }),
      );
      mockStripe.coupons.create.mockImplementation((params: { id: string }) => Promise.resolve({ id: params.id }));

      const result = await service.getStripeCoupons(cart);

      // Both codes are MatchesCart, so commercetools put both in the cart total and both must reach
      // the invoice — otherwise Stripe charges more than the cart is worth.
      expect(result).toHaveLength(2);
      expect(mockStripe.coupons.retrieve).toHaveBeenCalledTimes(2);
    });

    // Split from one `it.each` over every non-applying state. Skipping was necessary but not
    // sufficient: the subscription was still created and the shopper still charged, at the full
    // amount, and commercetools then refused the order for the same reason the code was skipped —
    // paid, with nothing to fulfil. Only `ApplicationStoppedByGroupBestDeal` may still be skipped,
    // because commercetools does create that order, just without the discount.
    it.each([
      'MaxApplicationReached',
      'DoesNotMatchCart',
      'NotActive',
      'NotValid',
      'ApplicationStoppedByPreviousDiscount',
      'SomeFutureStateCommercetoolsAdds',
    ])('should REFUSE before charging when commercetools reports %s', async (state) => {
      const cart = {
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 10000, fractionDigits: 2 },
        discountCodes: [
          {
            state,
            discountCode: {
              id: 'discount-123',
              obj: {
                id: 'discount-123',
                cartDiscounts: [
                  { obj: { value: { type: 'relative', permyriad: 1000 }, target: { type: 'totalPrice' } } },
                ],
              },
            },
          },
        ],
      };

      await expect(service.getStripeCoupons(cart)).rejects.toMatchObject({
        code: 'DiscountCodeNonApplicable',
        httpErrorStatus: 400,
      });

      // Nothing reached Stripe — the refusal happens before any object is created or charged.
      expect(mockStripe.coupons.retrieve).not.toHaveBeenCalled();
      expect(mockStripe.coupons.del).not.toHaveBeenCalled();
      expect(mockStripe.coupons.create).not.toHaveBeenCalled();
    });

    it('should SKIP, not refuse, ApplicationStoppedByGroupBestDeal — commercetools creates that order', async () => {
      const cart = {
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 10000, fractionDigits: 2 },
        discountCodes: [
          {
            state: 'ApplicationStoppedByGroupBestDeal',
            discountCode: {
              id: 'discount-123',
              obj: {
                id: 'discount-123',
                cartDiscounts: [
                  { obj: { value: { type: 'relative', permyriad: 1000 }, target: { type: 'totalPrice' } } },
                ],
              },
            },
          },
        ],
      };

      const result = await service.getStripeCoupons(cart);

      expect(result).toBeUndefined();
      expect(mockStripe.coupons.retrieve).not.toHaveBeenCalled();
      expect(mockStripe.coupons.create).not.toHaveBeenCalled();
    });

    // Was: "translate only the codes commercetools applies". A cart carrying BOTH a capped code and an
    // applicable one is not a cart commercetools will order from — the capped code blocks it — so
    // translating the good one and charging is the defect, not the feature.
    it('should refuse a cart mixing a blocking code with an applicable one', async () => {
      const cart = {
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 10000, fractionDigits: 2 },
        discountCodes: [
          {
            state: 'MaxApplicationReached',
            discountCode: {
              id: 'discount-capped',
              obj: {
                id: 'discount-capped',
                cartDiscounts: [
                  { obj: { value: { type: 'relative', permyriad: 3000 }, target: { type: 'totalPrice' } } },
                ],
              },
            },
          },
          {
            state: 'MatchesCart',
            discountCode: {
              id: 'discount-123',
              obj: {
                id: 'discount-123',
                cartDiscounts: [
                  { obj: { value: { type: 'relative', permyriad: 1000 }, target: { type: 'totalPrice' } } },
                ],
              },
            },
          },
        ],
      };

      mockStripe.coupons.retrieve.mockResolvedValue({
        id: 'coupon-123',
        valid: true,
        deleted: false,
        percent_off: 10,
      });

      await expect(service.getStripeCoupons(cart)).rejects.toMatchObject({
        code: 'DiscountCodeNonApplicable',
      });

      expect(mockStripe.coupons.retrieve).not.toHaveBeenCalled();
      expect(mockStripe.coupons.del).not.toHaveBeenCalled();
    });
  });

  // The Stripe coupon id is the CT discount code id, with no `applies_to` scoping. A cart carrying custom
  // line items only reaches here with a total-price discount (any other target is refused upstream in
  // prepareSubscriptionData), so the invoice-wide coupon discounts the whole first invoice correctly.
  describe('getStripeCoupons — coupon id is the discount code id, unscoped', () => {
    const cartWith = (targetType: string) => ({
      id: 'cart-xyz',
      totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 10000, fractionDigits: 2 },
      customLineItems: [{ id: 'cli-1', money: { centAmount: 500, currencyCode: 'USD' } }],
      discountCodes: [
        {
          state: 'MatchesCart',
          discountCode: {
            id: 'discount-123',
            obj: {
              id: 'discount-123',
              cartDiscounts: [{ obj: { value: { type: 'relative', permyriad: 1000 }, target: { type: targetType } } }],
            },
          },
        },
      ],
    });

    it('creates the coupon under the discount code id with no applies_to, on a fee cart', async () => {
      mockStripe.coupons.retrieve.mockRejectedValue(new Error('No such coupon')); // forces create
      mockStripe.coupons.create.mockResolvedValue({ id: 'discount-123' });

      const result = await service.getStripeCoupons(cartWith('totalPrice'));

      expect(result).toEqual([{ coupon: 'discount-123' }]);
      expect(mockStripe.coupons.create).toHaveBeenCalledWith(expect.objectContaining({ id: 'discount-123' }));
      expect(mockStripe.coupons.create.mock.calls[0][0]).not.toHaveProperty('applies_to');
    });
  });

  describe('appliesToCart', () => {
    it('should accept a code commercetools applies to the cart', () => {
      const applies = service.appliesToCart({ state: 'MatchesCart', discountCode: { id: 'discount-123' } });

      expect(applies).toBe(true);
      expect(mockLog.warn).not.toHaveBeenCalled();
    });

    it('should reject a code whose usage cap commercetools reports as reached, and log the state', () => {
      const applies = service.appliesToCart({
        state: 'MaxApplicationReached',
        discountCode: { id: 'discount-123' },
      });

      expect(applies).toBe(false);
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('commercetools does not apply it to this cart'),
        expect.objectContaining({ ctDiscountCodeId: 'discount-123', discountCodeState: 'MaxApplicationReached' }),
      );
    });
  });

  // ADR-026 / point 7: the coupon service owns which codes it can represent as an invoice-wide coupon. The
  // subscription flow refuses what this rejects rather than re-deriving the target rule itself.
  describe('translatesToWholeInvoiceCoupon', () => {
    const codeWith = (state: string, targetType?: string) => ({
      state,
      discountCode: {
        id: 'discount-123',
        obj: targetType ? { cartDiscounts: [{ obj: { target: { type: targetType } } }] } : { cartDiscounts: undefined },
      },
    });

    const anyCart = mockGetSubscriptionCartWithVariant(1);
    const translates = (code: unknown, cart: Cart = anyCart) =>
      service.translatesToWholeInvoiceCoupon(code as DiscountCodeInfo, cart);

    it('is true only for a MatchesCart code whose single cart discount targets the cart total', () => {
      expect(translates(codeWith('MatchesCart', 'totalPrice'))).toBe(true);
    });

    it('is false for a non-total target (lineItems, shipping, customLineItems, pattern)', () => {
      for (const target of ['lineItems', 'shipping', 'customLineItems', 'pattern', 'multiBuyLineItems']) {
        expect(translates(codeWith('MatchesCart', target))).toBe(false);
      }
    });

    it('is false for an unexpanded discount whose target cannot be read', () => {
      expect(translates(codeWith('MatchesCart'))).toBe(false);
    });

    it('is false for a code commercetools does not apply (state != MatchesCart)', () => {
      expect(translates(codeWith('DoesNotMatchCart', 'totalPrice'))).toBe(false);
    });

    // ADR-026 addendum (2026-11-10), the base case: a relative line-item code on a cart whose first invoice is
    // that one line. Measured in Stripe test mode: 5 % of 1003 bills 953, as commercetools' line discount does.
    describe('the single-line relative code (base case)', () => {
      const money = (centAmount: number) =>
        ({ type: 'centPrecision', currencyCode: 'USD', centAmount, fractionDigits: 2 }) as const;
      const lineCode = (valueType: 'relative' | 'absolute' = 'relative') =>
        ({
          state: 'MatchesCart',
          discountCode: {
            typeId: 'discount-code',
            id: 'dc-1',
            obj: {
              cartDiscounts: [
                {
                  typeId: 'cart-discount',
                  id: 'cd-dc-1',
                  obj: { target: { type: 'lineItems' }, value: { type: valueType, permyriad: 500 } },
                },
              ],
            },
          },
        }) as unknown as DiscountCodeInfo;
      const reachedBy = (discountId: string, quantity = 1) => [
        {
          quantity,
          discountedPrice: {
            value: money(953),
            includedDiscounts: [{ discount: { typeId: 'cart-discount', id: discountId }, discountedAmount: money(50) }],
          },
        },
      ];
      const baseCart = (overrides: Partial<Cart> = {}, lineOverrides: Partial<LineItem> = {}): Cart => {
        const cart = mockGetSubscriptionCartWithVariant(1);
        return {
          ...cart,
          shippingInfo: undefined,
          customLineItems: [],
          lineItems: [
            { ...cart.lineItems[0], quantity: 1, discountedPricePerQuantity: reachedBy('cd-dc-1'), ...lineOverrides },
          ],
          ...overrides,
        };
      };

      it('accepts it when the only line, quantity 1, carries the code’s discount and nothing else is billed', () => {
        expect(translates(lineCode(), baseCart())).toBe(true);
      });

      it('accepts a zero shipping charge and a zero fee (nothing for the coupon to over-discount)', () => {
        const cart = baseCart({
          shippingInfo: { ...shippingInfo, price: money(0) },
          customLineItems: [{ ...customLineItem, totalPrice: money(0) }],
        });
        expect(translates(lineCode(), cart)).toBe(true);
      });

      it.each<[string, Cart]>([
        [
          'quantity 2 (per-unit vs subtotal rounding)',
          baseCart({}, { quantity: 2, discountedPricePerQuantity: reachedBy('cd-dc-1', 2) }),
        ],
        ['a shipping charge', baseCart({ shippingInfo })],
        ['a positive fee', baseCart({ customLineItems: [customLineItem] })],
        ['a second line item', { ...baseCart(), lineItems: [...baseCart().lineItems, lineItem] }],
        [
          'a line the code did not reach (cart predicate matched, line predicate did not)',
          baseCart({}, { discountedPricePerQuantity: [] }),
        ],
        [
          'a line reached by another discount only',
          baseCart({}, { discountedPricePerQuantity: reachedBy('cd-other') }),
        ],
      ])('refuses it with %s', (_name, cart) => {
        expect(translates(lineCode(), cart)).toBe(false);
      });

      it('refuses an absolute line-item amount even in the base case (not measured)', () => {
        expect(translates(lineCode('absolute'), baseCart())).toBe(false);
      });
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

      await expect(service.createStripeDiscountCode(discountCode, 'USD')).rejects.toThrow(
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

      await expect(service.createStripeDiscountCode(discountCode, 'USD')).rejects.toThrow(
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
              target: { type: 'totalPrice' },
            },
          },
        ],
        name: { en: 'Test Discount' },
        validUntil: '2023-12-31T23:59:59Z',
        maxApplications: 100,
      };

      const mockCreatedCoupon = { id: 'discount-123' };
      mockStripe.coupons.create.mockResolvedValue(mockCreatedCoupon);

      const result = await service.createStripeDiscountCode(discountCode, 'USD');

      expect(result).toBe('discount-123');
      expect(mockStripe.coupons.create).toHaveBeenCalledWith({
        id: 'discount-123',
        name: 'Test Discount',
        currency: undefined,
        duration: 'once',
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

      const result = await service.createStripeDiscountCode(discountCode, 'USD');

      expect(result).toBe('discount-123');
      expect(mockStripe.coupons.create).toHaveBeenCalledWith({
        id: 'discount-123',
        name: 'Test Discount',
        currency: 'USD',
        duration: 'once',
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
              target: { type: 'totalPrice' },
            },
          },
        ],
        name: { en: 'Test Discount' },
        validUntil: undefined,
        maxApplications: 100,
      };

      const mockCreatedCoupon = { id: 'discount-123' };
      mockStripe.coupons.create.mockResolvedValue(mockCreatedCoupon);

      const result = await service.createStripeDiscountCode(discountCode, 'USD');

      expect(result).toBe('discount-123');
      expect(mockStripe.coupons.create).toHaveBeenCalledWith({
        id: 'discount-123',
        name: 'Test Discount',
        currency: undefined,
        duration: 'once',
        redeem_by: undefined,
        percent_off: 10,
      });
    });

    // The cap belongs to commercetools and is enforced there. Mirroring it was what made Stripe mark
    // the coupon invalid on exhaustion, which drove the delete-and-recreate that reset the counter.
    it('should not mirror the commercetools usage cap onto the Stripe coupon', async () => {
      const discountCode = {
        id: 'discount-123',
        cartDiscounts: [
          {
            obj: {
              value: {
                type: 'relative',
                permyriad: 1000,
              },
              target: { type: 'totalPrice' },
            },
          },
        ],
        name: { en: 'Test Discount' },
        validUntil: '2023-12-31T23:59:59Z',
        maxApplications: 1,
      };

      const mockCreatedCoupon = { id: 'discount-123' };
      mockStripe.coupons.create.mockResolvedValue(mockCreatedCoupon);

      const result = await service.createStripeDiscountCode(discountCode, 'USD');

      expect(result).toBe('discount-123');
      expect(mockStripe.coupons.create).toHaveBeenCalledWith({
        id: 'discount-123',
        name: 'Test Discount',
        currency: undefined,
        duration: 'once',
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

    // a swallowed failure here left the following create failing on a duplicate id, with the
    // real cause already logged away.
    it('should surface a deletion failure instead of swallowing it', async () => {
      const mockError = new Error('Deletion failed');
      mockStripe.coupons.del.mockRejectedValue(mockError);

      await expect(service.deleteStripeDiscountCode('coupon-123')).rejects.toThrow('Deletion failed');

      expect(mockStripe.coupons.del).toHaveBeenCalledWith('coupon-123');
      expect(mockLog.error).toHaveBeenCalled();
    });

    it('should not attempt to recreate a coupon whose deletion failed', async () => {
      const mockStripeCoupon = {
        id: 'coupon-123',
        valid: true,
        deleted: false,
        percent_off: 5,
        max_redemptions: null,
        redeem_by: null,
      };

      const cart = {
        totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 10000, fractionDigits: 2 },
        discountCodes: [
          {
            state: 'MatchesCart',
            discountCode: {
              id: 'discount-123',
              obj: {
                id: 'discount-123',
                cartDiscounts: [
                  { obj: { value: { type: 'relative', permyriad: 1000 }, target: { type: 'totalPrice' } } },
                ],
              },
            },
          },
        ],
      };

      mockStripe.coupons.retrieve.mockResolvedValue(mockStripeCoupon);
      mockStripe.coupons.del.mockRejectedValue(new Error('Deletion failed'));

      await expect(service.getStripeCoupons(cart)).rejects.toThrow('Deletion failed');
      expect(mockStripe.coupons.create).not.toHaveBeenCalled();
    });
  });

  describe('getDiscountConfig — multi-currency absolute discounts', () => {
    /** An absolute CT cart discount defined for several currencies, cart's own listed last. */
    const multiCurrencyDiscount = {
      id: 'discount-abs',
      cartDiscounts: [
        {
          obj: {
            value: {
              type: 'absolute',
              money: [
                { type: 'centPrecision', currencyCode: 'EUR', centAmount: 500, fractionDigits: 2 },
                { type: 'centPrecision', currencyCode: 'JPY', centAmount: 900, fractionDigits: 0 },
                { type: 'centPrecision', currencyCode: 'USD', centAmount: 700, fractionDigits: 2 },
              ],
            },
          },
        },
      ],
    };

    // Kills `money[0]`: the cart's currency is the LAST entry, so taking the first one would build a
    // coupon for 500 EUR on a USD cart — the wrong amount in the wrong currency.
    it('selects the amount for the cart currency, not the first one listed', () => {
      const config = service.getDiscountConfig(multiCurrencyDiscount, 'USD');

      expect(config.amountOff).toBe(700);
      expect(config.currency).toBe('USD');
    });

    it('matches the currency case-insensitively', () => {
      const config = service.getDiscountConfig(multiCurrencyDiscount, 'usd');

      expect(config.amountOff).toBe(700);
    });

    // Kills the removed throw: without it the coupon is built with an undefined amount and Stripe
    // rejects the subscription create, after this checkout's products and prices already exist.
    it('refuses when the discount is not defined for the cart currency', () => {
      expect(() => service.getDiscountConfig(multiCurrencyDiscount, 'GBP')).toThrow(
        expect.objectContaining({ code: 'DiscountCodeCurrencyMismatch' }) as unknown as Error,
      );
    });

    it('leaves percentage discounts alone — they carry no currency', () => {
      const relative = {
        id: 'discount-rel',
        cartDiscounts: [{ obj: { value: { type: 'relative', permyriad: 1500 }, target: { type: 'totalPrice' } } }],
      };

      const config = service.getDiscountConfig(relative, 'GBP');

      expect(config.percentOff).toBe(15);
      expect(config.currency).toBeUndefined();
    });
  });

  describe('hasDivergentConfig', () => {
    const percentageDiscountCode = (overrides = {}) => ({
      id: 'discount-123',
      cartDiscounts: [{ obj: { value: { type: 'relative', permyriad: 1000 }, target: { type: 'totalPrice' } } }],
      name: { en: 'Test Discount' },
      validUntil: '2023-12-31T23:59:59Z',
      maxApplications: 100,
      ...overrides,
    });

    const inSyncCoupon = (overrides = {}) => ({
      id: 'coupon-123',
      valid: true,
      deleted: false,
      percent_off: 10,
      currency: undefined,
      max_redemptions: null,
      redeem_by: 1234567890,
      ...overrides,
    });

    it('should report a coupon that mirrors commercetools as in sync', () => {
      expect(service.hasDivergentConfig(percentageDiscountCode(), inSyncCoupon())).toBe(false);
    });

    // The distinction this fix turns on: usability is not sync. A spent coupon still mirrors its CT
    // discount code, so it must not be deleted and recreated on a fresh redemption counter.
    it('should not report a spent coupon as divergent', () => {
      expect(service.hasDivergentConfig(percentageDiscountCode(), inSyncCoupon({ valid: false }))).toBe(false);
    });

    it('should report a coupon whose percentage differs as divergent', () => {
      expect(service.hasDivergentConfig(percentageDiscountCode(), inSyncCoupon({ percent_off: 5 }))).toBe(true);
    });

    it('should report a coupon whose expiration date differs as divergent', () => {
      expect(service.hasDivergentConfig(percentageDiscountCode(), inSyncCoupon({ redeem_by: 999 }))).toBe(true);
    });

    it('should report a coupon whose amount off differs as divergent', () => {
      const discountCode = {
        id: 'discount-123',
        cartDiscounts: [{ obj: { value: { type: 'absolute', money: [{ centAmount: 1000, currencyCode: 'USD' }] } } }],
        name: { en: 'Test Discount' },
        validUntil: '2023-12-31T23:59:59Z',
      };

      const coupon = inSyncCoupon({ percent_off: undefined, amount_off: 500, currency: 'usd' });

      expect(service.hasDivergentConfig(discountCode, coupon, 'USD')).toBe(true);
    });

    it('should report a coupon whose currency differs as divergent', () => {
      const discountCode = {
        id: 'discount-123',
        cartDiscounts: [{ obj: { value: { type: 'absolute', money: [{ centAmount: 1000, currencyCode: 'USD' }] } } }],
        name: { en: 'Test Discount' },
        validUntil: '2023-12-31T23:59:59Z',
      };

      const coupon = inSyncCoupon({ percent_off: undefined, amount_off: 1000, currency: 'eur' });

      expect(service.hasDivergentConfig(discountCode, coupon, 'USD')).toBe(true);
    });

    // Coupons created while the cap was still mirrored. Replaced once so they stop going invalid on
    // exhaustion; the cap itself is enforced by commercetools.
    it('should report a coupon that still carries a mirrored redemption cap as divergent', () => {
      expect(service.hasDivergentConfig(percentageDiscountCode(), inSyncCoupon({ max_redemptions: 100 }))).toBe(true);
    });

    it('should not treat an absent max_redemptions as a mirrored cap', () => {
      expect(service.hasDivergentConfig(percentageDiscountCode(), inSyncCoupon({ max_redemptions: undefined }))).toBe(
        false,
      );
    });

    it('should report a coupon in sync when the optional commercetools fields are unset', () => {
      const discountCode = percentageDiscountCode({ validUntil: undefined, maxApplications: undefined });
      const coupon = inSyncCoupon({ redeem_by: undefined });

      expect(service.hasDivergentConfig(discountCode, coupon, 'USD')).toBe(false);
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

      expect(() => service.getDiscountConfig(discountCode, 'USD')).toThrow(
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

      expect(() => service.getDiscountConfig(discountCode, 'USD')).toThrow('Cart discount type is not supported');
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
              target: { type: 'totalPrice' },
            },
          },
        ],
        name: { en: 'Test Discount' },
        validUntil: '2023-12-31T23:59:59Z',
        maxApplications: 100,
      };

      const result = service.getDiscountConfig(discountCode, 'USD');

      expect(result).toEqual({
        isPercentage: true,
        isAmountOff: false,
        expirationDate: 1234567890,
        name: 'Test Discount',
        currency: undefined,
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

      const result = service.getDiscountConfig(discountCode, 'USD');

      expect(result).toEqual({
        isPercentage: false,
        isAmountOff: true,
        expirationDate: 1234567890,
        name: 'Test Discount',
        currency: 'USD',
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
              target: { type: 'totalPrice' },
            },
          },
        ],
        name: { en: 'Test Discount' },
        validUntil: undefined,
        maxApplications: 100,
      };

      const result = service.getDiscountConfig(discountCode, 'USD');

      expect(result).toEqual({
        isPercentage: true,
        isAmountOff: false,
        expirationDate: undefined,
        name: 'Test Discount',
        currency: undefined,
        amountOff: undefined,
        percentOff: 10,
        amount: { percent_off: 10 },
      });
    });
  });
});
