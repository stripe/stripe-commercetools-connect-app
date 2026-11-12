jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {}),
}));

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { Errorx } from '@commercetools/connect-payments-sdk';
import { Cart, CartDiscount, CustomLineItem } from '@commercetools/platform-sdk';
import { StripeSubscriptionService } from '../../src/services/stripe-subscription.service';
import { CtPaymentCreationService } from '../../src/services/ct-payment-creation.service';
import { paymentSDK } from '../../src/payment-sdk';
import {
  mockGetCartResult,
  mockGetSubscriptionCart,
  mockGetSubscriptionCartWithTwoItems,
  mockGetSubscriptionCartWithVariant,
  lineItem,
  lineItemSubscription,
  customLineItem,
  customLineItemDiscounted,
  mockDiscountCodeInfo,
  getVariant,
  shippingInfo,
} from '../utils/mock-cart-data';
import { getSubscriptionAttributes } from '../../src/mappers/subscription-mapper';
import { StripeCouponService } from '../../src/services/stripe-coupon.service';
import { StripeCustomerService } from '../../src/services/stripe-customer.service';
import { stripeCustomerIdFieldName } from '../../src/custom-types/custom-types';
import * as CartClient from '../../src/services/commerce-tools/cart-client';
import Stripe from 'stripe';
import { BasicSubscriptionData } from '../../src/services/types/stripe-subscription.type';
import * as Config from '../../src/config/config';

jest.mock('../../src/libs/logger', () => ({
  log: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../src/payment-sdk', () => ({
  paymentSDK: {
    ctCartService: {},
    ctPaymentService: {},
    ctOrderService: {},
    ctAPI: {
      carts: jest.fn(() => ({
        withId: jest.fn(() => ({
          get: jest.fn(() => Promise.resolve({ body: mockGetSubscriptionCartWithVariant(1) })),
        })),
      })),
    },
  },
}));

jest.mock('../../src/libs/logger');

jest.mock('../../src/services/commerce-tools/cart-client', () => ({
  getCartExpanded: jest.fn(() => Promise.resolve(mockGetSubscriptionCartWithVariant(1))),
}));

interface FlexibleConfig {
  [key: string]: string | number | boolean | Config.PaymentFeatures;
}

function setupMockConfig(keysAndValues: Record<string, string>) {
  const mockConfig: FlexibleConfig = {};
  Object.keys(keysAndValues).forEach((key) => {
    mockConfig[key] = keysAndValues[key];
  });

  jest.spyOn(Config, 'getConfig').mockReturnValue(mockConfig as ReturnType<typeof Config.getConfig>);
}

describe('stripe-subscription.service.core', () => {
  const opts = {
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
    ctOrderService: paymentSDK.ctOrderService,
  };
  const stripeSubscriptionService = new StripeSubscriptionService(opts);

  beforeEach(async () => {
    jest.setTimeout(10000);
    jest.resetAllMocks();

    Stripe.prototype.prices = {
      search: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    } as unknown as Stripe.PricesResource;
    Stripe.prototype.products = {
      search: jest.fn(),
      create: jest.fn(),
      retrieve: jest.fn(),
    } as unknown as Stripe.ProductsResource;
    Stripe.prototype.subscriptions = {
      create: jest.fn(),
      retrieve: jest.fn(),
      update: jest.fn(),
      list: jest.fn(),
      cancel: jest.fn(),
    } as unknown as Stripe.SubscriptionsResource;
    Stripe.prototype.setupIntents = {
      create: jest.fn(),
      retrieve: jest.fn(),
    } as unknown as Stripe.SetupIntentsResource;
    Stripe.prototype.customers = {
      create: jest.fn(),
      retrieve: jest.fn(),
      update: jest.fn(),
    } as unknown as Stripe.CustomersResource;
    Stripe.prototype.paymentIntents = {
      create: jest.fn(),
      retrieve: jest.fn(),
      update: jest.fn(),
    } as unknown as Stripe.PaymentIntentsResource;
    Stripe.prototype.invoices = {
      create: jest.fn(),
      retrieve: jest.fn(),
      finalize: jest.fn(),
      send: jest.fn(),
      sendInvoice: jest.fn(),
      finalizeInvoice: jest.fn(),
    } as unknown as Stripe.InvoicesResource;
    Stripe.prototype.invoiceItems = { create: jest.fn() } as unknown as Stripe.InvoiceItemsResource;
    Stripe.prototype.coupons = { list: jest.fn() } as unknown as Stripe.CouponsResource;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('method createSetupIntent', () => {
    test('should create setup intent successfully', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);
      const mockSetupIntent = {
        clientSecret: 'secret_123',
        merchantReturnUrl: 'http://example.com',
        billingAddress: '123 Main St',
      };

      const spiedPrepareSubscriptionDataMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue({
          cart: mockCart,
          stripeCustomerId: 'cus_123',
          subscriptionParams: { customer: 'cus_123', off_session: false },
          billingAddress: '123 Main St',
          merchantReturnUrl: 'http://example.com',
        });
      const spiedCreateStripeSetupIntentMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'createStripeSetupIntent')
        .mockResolvedValue({
          id: 'seti_123',
          clientSecret: 'secret_123',
        });

      const result = await stripeSubscriptionService.createSetupIntent();

      expect(result).toEqual(mockSetupIntent);
      expect(spiedPrepareSubscriptionDataMock).toHaveBeenCalled();
      expect(spiedCreateStripeSetupIntentMock).toHaveBeenCalled();
    });

    test('should handle error when creating setup intent', async () => {
      const error = new Error('Failed to create setup intent');
      jest.spyOn(StripeSubscriptionService.prototype, 'createSetupIntent').mockRejectedValue(error);

      await expect(stripeSubscriptionService.createSetupIntent()).rejects.toThrow('Failed to create setup intent');
    });
  });

  // ADR-026, the subscription discount rule as one table: for each cart shape, every public create path must
  // either refuse it before any Stripe object is created (unsupported discount, code-less direct discount, a
  // negative fee), or accept it (no discount, or a cart-total discount). Drives the real prepareSubscriptionData
  // via getCartExpanded, so the refusal fires on the actual path, not on a mock.
  describe('the subscription discount rule across create paths (ADR-026)', () => {
    // Variant 1 is a trial product. The default cart here is a plain monthly subscription (trial attribute
    // removed), so the trial and anchor shapes below are the only ones that exercise billing timing.
    const variantWithout = (num: 1 | 6 | 8, ...names: string[]) => {
      const variant = getVariant(num);
      return { ...variant, attributes: (variant.attributes ?? []).filter((a) => !names.includes(a.name)) };
    };
    const PLAIN = variantWithout(1, 'trial_period_days', 'missing_payment_method_at_trial_end');
    const TRIAL = getVariant(1);
    const PRORATED_ANCHOR = getVariant(8);
    const ALWAYS_INVOICE_ANCHOR = {
      ...getVariant(8),
      attributes: (getVariant(8).attributes ?? []).map((a) =>
        a.name === 'proration_behavior' ? { ...a, value: { key: 'always_invoice', label: 'always_invoice' } } : a,
      ),
    };
    const FREE_ANCHOR = getVariant(6);
    const withVariant = (cart: Cart, variant: ReturnType<typeof getVariant>): Cart => ({
      ...cart,
      lineItems: cart.lineItems.map((item, i) => (i === 0 ? { ...item, variant } : item)),
    });
    const subCart = (overrides: Partial<Cart>, variant = PLAIN): Cart =>
      withVariant(
        {
          ...mockGetSubscriptionCartWithVariant(1),
          customLineItems: [],
          discountCodes: [],
          directDiscounts: [],
          ...overrides,
        },
        variant,
      );
    // The base case of the 2026-11-10 addendum: one relative line-item code commercetools applied to the only
    // line, quantity 1, nothing else billed.
    const money = (centAmount: number) =>
      ({ type: 'centPrecision', currencyCode: 'USD', centAmount, fractionDigits: 2 }) as const;
    const relativeLineCode = (): Cart['discountCodes'][number] => {
      const code = mockDiscountCodeInfo('lineItems');
      code.discountCode.obj!.cartDiscounts[0].obj = {
        target: { type: 'lineItems', predicate: 'true' },
        value: { type: 'relative', permyriad: 500 },
      } as unknown as CartDiscount;
      return code;
    };
    const baseCaseCart = (overrides: Partial<Cart> = {}, quantity = 1): Cart => {
      const cart = subCart({ shippingInfo: undefined, discountCodes: [relativeLineCode()] });
      return {
        ...cart,
        lineItems: [
          {
            ...cart.lineItems[0],
            quantity,
            discountedPricePerQuantity: [
              {
                quantity,
                discountedPrice: {
                  value: money(953),
                  includedDiscounts: [
                    { discount: { typeId: 'cart-discount', id: 'cd-dc-1' }, discountedAmount: money(50) },
                  ],
                },
              },
            ],
          },
        ],
        ...overrides,
      };
    };
    const negativeFee = {
      ...customLineItem,
      money: { type: 'centPrecision', currencyCode: 'USD', centAmount: -500, fractionDigits: 2 },
    };
    // commercetools records a total-price discount (coded, automatic or direct) in discountOnTotalPrice,
    // each portion referencing the CartDiscount/DirectDiscount it came from. mockDiscountCodeInfo('totalPrice')
    // carries cart discount id `cd-dc-1`, so a portion with that id is the accepted code's own discount.
    const totalDiscountFrom = (discountId: string) =>
      ({
        includedDiscounts: [
          {
            discount: { typeId: 'cart-discount', id: discountId },
            discountedAmount: { type: 'centPrecision', currencyCode: 'USD', centAmount: 100, fractionDigits: 2 },
          },
        ],
      }) as unknown as Cart['discountOnTotalPrice'];

    // [name, cart, refusal code | undefined when accepted]
    const CASES: Array<[string, Cart, string | undefined]> = [
      ['no discount, no fee', subCart({}), undefined],
      ['no discount, a fee', subCart({ customLineItems: [customLineItem] }), undefined],
      ['a cart-total code', subCart({ discountCodes: [mockDiscountCodeInfo('totalPrice')] }), undefined],
      [
        'a cart-total code + a fee',
        subCart({ customLineItems: [customLineItem], discountCodes: [mockDiscountCodeInfo('totalPrice')] }),
        undefined,
      ],
      [
        'a cart-total code whose own discount shows on the total',
        subCart({
          discountCodes: [mockDiscountCodeInfo('totalPrice')],
          discountOnTotalPrice: totalDiscountFrom('cd-dc-1'),
        }),
        undefined,
      ],
      [
        'a line-items code (no fee)',
        subCart({ discountCodes: [mockDiscountCodeInfo('lineItems')] }),
        'UnsupportedCartDiscountForSubscription',
      ],
      [
        'a shipping code',
        subCart({ discountCodes: [mockDiscountCodeInfo('shipping')] }),
        'UnsupportedCartDiscountForSubscription',
      ],
      [
        'a custom-line-item code + a fee',
        subCart({ customLineItems: [customLineItem], discountCodes: [mockDiscountCodeInfo('customLineItems')] }),
        'UnsupportedCartDiscountForSubscription',
      ],
      [
        'two codes, one non-total',
        subCart({ discountCodes: [mockDiscountCodeInfo('totalPrice', 'a'), mockDiscountCodeInfo('lineItems', 'b')] }),
        'UnsupportedCartDiscountForSubscription',
      ],
      [
        'two cart-total codes',
        subCart({ discountCodes: [mockDiscountCodeInfo('totalPrice', 'a'), mockDiscountCodeInfo('totalPrice', 'b')] }),
        'UnsupportedCartDiscountForSubscription',
      ],
      [
        'an automatic cart-total discount (no code)',
        subCart({ discountOnTotalPrice: totalDiscountFrom('automatic-total') }),
        'UnsupportedCartDiscountForSubscription',
      ],
      ['a negative (credit) fee', subCart({ customLineItems: [negativeFee] }), 'NegativeCustomLineItemNotSupported'],
      // ADR-026 addendum (2026-11-10) — A1, the single-line relative code.
      ['the base case: one relative line-items code on the only line, quantity 1', baseCaseCart(), undefined],
      ['the base case with quantity 2', baseCaseCart({}, 2), 'UnsupportedCartDiscountForSubscription'],
      // A1 leaves billing timing to A6: on its single line the base case behaves as a cart-total code does.
      ['the base case on a trial (only the subscription is billed)', withVariant(baseCaseCart(), TRIAL), undefined],
      ['the base case on a free anchor', withVariant(baseCaseCart(), FREE_ANCHOR), undefined],
      [
        'the base case on a prorating anchor',
        withVariant(baseCaseCart(), PRORATED_ANCHOR),
        'UnsupportedCartDiscountForSubscription',
      ],
      ['the base case + a shipping charge', baseCaseCart({ shippingInfo }), 'UnsupportedCartDiscountForSubscription'],
      [
        'the base case + a positive fee',
        baseCaseCart({ customLineItems: [customLineItem] }),
        'UnsupportedCartDiscountForSubscription',
      ],
      [
        'the base case + a one-time line item',
        { ...baseCaseCart(), lineItems: [...baseCaseCart().lineItems, lineItem] },
        'UnsupportedCartDiscountForSubscription',
      ],
      // ADR-026 addendum (2026-11-10) — A6, billing timing.
      [
        'a trial with only the subscription + a cart-total code',
        subCart({ discountCodes: [mockDiscountCodeInfo('totalPrice')] }, TRIAL),
        undefined,
      ],
      [
        'a trial + a one-time line item + a cart-total code',
        {
          ...subCart({ discountCodes: [mockDiscountCodeInfo('totalPrice')] }, TRIAL),
          lineItems: [...subCart({}, TRIAL).lineItems, lineItem],
        },
        'UnsupportedCartDiscountForSubscription',
      ],
      [
        'a trial + a positive fee + a cart-total code',
        subCart({ customLineItems: [customLineItem], discountCodes: [mockDiscountCodeInfo('totalPrice')] }, TRIAL),
        'UnsupportedCartDiscountForSubscription',
      ],
      ['a trial + a positive fee, no code', subCart({ customLineItems: [customLineItem] }, TRIAL), undefined],
      [
        'a prorated anchor + a cart-total code',
        subCart({ discountCodes: [mockDiscountCodeInfo('totalPrice')] }, PRORATED_ANCHOR),
        'UnsupportedCartDiscountForSubscription',
      ],
      ['a prorated anchor, no code', subCart({}, PRORATED_ANCHOR), undefined],
      [
        'an always_invoice anchor + a cart-total code (prorates like create_prorations — measured)',
        subCart({ discountCodes: [mockDiscountCodeInfo('totalPrice')] }, ALWAYS_INVOICE_ANCHOR),
        'UnsupportedCartDiscountForSubscription',
      ],
      [
        'a free anchor + a one-time line item + a cart-total code',
        {
          ...subCart({ discountCodes: [mockDiscountCodeInfo('totalPrice')] }, FREE_ANCHOR),
          lineItems: [...subCart({}, FREE_ANCHOR).lineItems, lineItem],
        },
        undefined,
      ],
    ];

    const PATHS: Array<[string, () => Promise<unknown>]> = [
      ['createSetupIntent', () => stripeSubscriptionService.createSetupIntent()],
      ['createSubscription', () => stripeSubscriptionService.createSubscription()],
      [
        'createSubscriptionFromSetupIntent',
        () => stripeSubscriptionService.createSubscriptionFromSetupIntent('seti_123'),
      ],
    ];

    beforeEach(() => {
      setupMockConfig({ projectKey: 'test-project-key', merchantReturnUrl: 'http://example.com' });
    });

    const refusedCases = CASES.filter((c): c is [string, Cart, string] => c[2] !== undefined);

    describe.each(PATHS)('via %s', (_pathName, run) => {
      it.each(refusedCases)('refuses %s before any Stripe object', async (_name, cart, code) => {
        jest.spyOn(CartClient, 'getCartExpanded').mockResolvedValue(cart);

        await expect(run()).rejects.toMatchObject({ code });
        if (code === 'UnsupportedCartDiscountForSubscription') {
          // The body names the reason only; ids stay in the warn log (ADR-026 addendum, 2026-11-10).
          await expect(run()).rejects.toMatchObject({ fields: { reason: expect.any(String) } });
          const error = (await run().catch((e: unknown) => e)) as Errorx;
          expect(Object.keys(error.fields ?? {})).toEqual(['reason']);
        }

        expect(Stripe.prototype.products.create).not.toHaveBeenCalled();
        expect(Stripe.prototype.prices.create).not.toHaveBeenCalled();
        expect(Stripe.prototype.setupIntents.create).not.toHaveBeenCalled();
        expect(Stripe.prototype.subscriptions.create).not.toHaveBeenCalled();
      });
    });

    // The accepted shapes pass the rule: prepareSubscriptionData runs its assertions without refusing. The
    // amount-equals-cart-total assertion for the accepted path lives in the getAllLineItemPrices and coupon
    // tests; here the rule's accept branch is what the table asserts.
    it.each(CASES.filter(([, , code]) => code === undefined))('accepts %s', (_name, cart) => {
      const internals = stripeSubscriptionService as unknown as {
        assertSupportedSubscriptionDiscounts: (c: Cart) => void;
        assertCodeBillableOnSubscriptionTiming: (c: Cart, p: Stripe.SubscriptionCreateParams) => void;
      };
      const params = getSubscriptionAttributes(cart.lineItems[0].variant.attributes);
      expect(() => internals.assertSupportedSubscriptionDiscounts.call(stripeSubscriptionService, cart)).not.toThrow();
      expect(() =>
        internals.assertCodeBillableOnSubscriptionTiming.call(stripeSubscriptionService, cart, params),
      ).not.toThrow();
    });

    // End to end through the real prepareSubscriptionData and getStripeCoupons: the base-case cart reaches
    // subscriptions.create with the code's coupon attached (not merely "not refused"). Downstream steps that
    // are not under test (prices, customer, payment record) are stubbed; what follows the create call is not
    // asserted here.
    it('creates the subscription for the base case with the code’s coupon attached (createSubscription)', async () => {
      const cart = baseCaseCart();
      jest.spyOn(CartClient, 'getCartExpanded').mockResolvedValue(cart);
      jest.spyOn(StripeCustomerService.prototype, 'getCtCustomer').mockResolvedValue({
        id: 'customer-1',
        custom: { fields: { [stripeCustomerIdFieldName]: 'cus_123' } },
      } as never);
      (paymentSDK.ctCartService as unknown as { getPaymentAmount: unknown }).getPaymentAmount = jest.fn(() =>
        Promise.resolve({ centAmount: 953, currencyCode: 'USD', fractionDigits: 2 }),
      );
      type Internals = {
        getAllLineItemPrices: () => Promise<unknown>;
        findExistingSubscriptionForCart: () => Promise<unknown>;
      };
      const internals = StripeSubscriptionService.prototype as unknown as Internals;
      jest.spyOn(StripeSubscriptionService.prototype, 'getCreateSubscriptionPriceId').mockResolvedValue('price_123');
      jest.spyOn(StripeSubscriptionService.prototype, 'getSubscriptionShippingPriceId').mockResolvedValue(undefined);
      jest.spyOn(internals, 'getAllLineItemPrices').mockResolvedValue([]);
      jest.spyOn(internals, 'findExistingSubscriptionForCart').mockResolvedValue(undefined);
      Stripe.prototype.coupons = {
        retrieve: jest.fn(() => Promise.reject(new Error('No such coupon'))),
        create: jest.fn(() => Promise.resolve({ id: 'dc-1' })),
      } as unknown as Stripe.CouponsResource;
      const createSpy = jest
        .spyOn(Stripe.prototype.subscriptions, 'create')
        .mockRejectedValue(new Error('stop after create') as never);

      await stripeSubscriptionService.createSubscription().catch(() => undefined);

      expect(Stripe.prototype.coupons.create).toHaveBeenCalledWith(
        expect.objectContaining({ percent_off: 5, duration: 'once' }),
      );
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ discounts: [{ coupon: 'dc-1' }] }),
        expect.anything(),
      );
    });

    // The base case reaches Stripe with the code's coupon (not just "not refused"): getStripeCoupons, the
    // second place the rule runs, translates it too.
    it('passes the base-case code to getStripeCoupons as a translatable coupon', () => {
      const couponService = (stripeSubscriptionService as unknown as { stripeCouponService: StripeCouponService })
        .stripeCouponService;
      const cart = baseCaseCart();
      expect(couponService.translatesToWholeInvoiceCoupon(cart.discountCodes[0], cart)).toBe(true);
    });
  });

  describe('method createSubscription', () => {
    test('should create subscription successfully', async () => {
      setupMockConfig({
        projectKey: 'test-project-key',
        stripeCollectBillingAddress: 'auto',
        stripeSecretKey: 'sk_test_123',
        authUrl: 'https://auth.test.com',
        apiUrl: 'https://api.test.com',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scope: 'test-scope',
        region: 'test-region',
        subscriptionPaymentHandling: 'createOrder',
      });
      const spiedPrepareSubscriptionDataMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue({
          cart: mockGetSubscriptionCartWithVariant(1),
          stripeCustomerId: 'cus_123',
          subscriptionParams: { customer: 'cus_123' },
          billingAddress: '123 Main St',
          merchantReturnUrl: 'http://example.com',
          lineItemAmount: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
          amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
          priceId: 'price_123',
          shippingPriceId: undefined,
        } as BasicSubscriptionData);
      jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue({
        id: 'sub_mock_id',
        latest_invoice: {
          id: 'in_123',
          confirmation_secret: {
            client_secret: 'pi_3MtwBwLkdIwHu7ix28a3tqPa_secret_YrKJUKribcBjcG8HVhfZluoGH',
            type: 'payment_intent',
          },
        },
      } as Stripe.Response<Stripe.Subscription>);

      jest.spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation').mockResolvedValue('payment_ref_123');
      const spiedSaveSubscriptionIdMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId')
        .mockResolvedValue();

      const result = await stripeSubscriptionService.createSubscription();

      expect(result).toMatchObject({
        subscriptionId: 'sub_mock_id',
        paymentReference: 'payment_ref_123',
        billingAddress: '123 Main St',
        clientSecret: 'pi_3MtwBwLkdIwHu7ix28a3tqPa_secret_YrKJUKribcBjcG8HVhfZluoGH',
        merchantReturnUrl: 'http://example.com',
      });
      expect(result).toHaveProperty('cartId');
      expect(spiedPrepareSubscriptionDataMock).toHaveBeenCalled();
      expect(spiedSaveSubscriptionIdMock).toHaveBeenCalled();
    });

    // Wiring test. The drift guard reads the cart total back off the subscription's metadata, so if
    // this seal is not actually written at creation the guard degrades to a no-op and every unit test
    // of the guard still passes. Assert it on the real `subscriptions.create` call.
    test('seals the cart total onto the subscription metadata', async () => {
      setupMockConfig({
        projectKey: 'test-project-key',
        stripeCollectBillingAddress: 'auto',
        stripeSecretKey: 'sk_test_123',
        subscriptionPaymentHandling: 'createOrder',
      });
      const cart = mockGetSubscriptionCartWithVariant(1);
      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        cart,
        stripeCustomerId: 'cus_123',
        subscriptionParams: { customer: 'cus_123' },
        billingAddress: '123 Main St',
        merchantReturnUrl: 'http://example.com',
        lineItemAmount: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        priceId: 'price_123',
        shippingPriceId: undefined,
      } as BasicSubscriptionData);
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue({
        id: 'sub_mock_id',
        latest_invoice: {
          id: 'in_123',
          confirmation_secret: { client_secret: 'pi_secret', type: 'payment_intent' },
        },
      } as Stripe.Response<Stripe.Subscription>);
      jest.spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation').mockResolvedValue('payment_ref_123');
      jest.spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId').mockResolvedValue();

      await stripeSubscriptionService.createSubscription();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            ct_cart_total_amount: String(cart.totalPrice.centAmount),
            ct_cart_total_currency: cart.totalPrice.currencyCode,
          }),
        }),
        expect.anything(),
      );
    });

    test('should handle error when creating subscription', async () => {
      const error = new Error('Failed to create subscription');
      jest.spyOn(StripeSubscriptionService.prototype, 'createSubscription').mockRejectedValue(error);

      await expect(stripeSubscriptionService.createSubscription()).rejects.toThrow('Failed to create subscription');
    });

    // ADR-026 / round-4 point 4: for an accepted cart (subscription + fee + a cart-total code) assert what
    // subscriptions.create actually receives — the fee in add_invoice_items at its totalPrice, and the coupon
    // in discounts. prepareSubscriptionData is mocked (so the customer/price plumbing is out of scope), but the
    // real getAllLineItemPrices and getStripeCoupons derive the payload.
    const totalPriceCode = {
      state: 'MatchesCart',
      discountCode: {
        id: 'dc-total',
        obj: {
          id: 'dc-total',
          name: { en: 'Ten percent' },
          validUntil: undefined,
          cartDiscounts: [
            { id: 'cd-total', obj: { value: { type: 'relative', permyriad: 1000 }, target: { type: 'totalPrice' } } },
          ],
        },
      },
    } as unknown as Cart['discountCodes'][number];

    const runAcceptedCartThroughCreate = async (create: () => Promise<unknown>) => {
      setupMockConfig({ projectKey: 'test-project-key', subscriptionPaymentHandling: 'createOrder' });
      const cart: Cart = {
        ...mockGetSubscriptionCartWithVariant(1),
        customLineItems: [customLineItem],
        discountCodes: [totalPriceCode],
      };
      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        cart,
        stripeCustomerId: 'cus_123',
        subscriptionParams: { customer: 'cus_123' },
        billingAddress: '123 Main St',
        merchantReturnUrl: 'http://example.com',
        lineItemAmount: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        priceId: 'price_sub',
        shippingPriceId: undefined,
      } as BasicSubscriptionData);
      // Fee Product found; coupon not found → created under the discount code id.
      Stripe.prototype.products.search = jest.fn().mockResolvedValue({ data: [{ id: 'prod_fee' }] }) as never;
      Stripe.prototype.coupons = {
        retrieve: jest.fn().mockRejectedValue(new Error('No such coupon')),
        create: jest.fn().mockResolvedValue({ id: 'dc-total' }),
        del: jest.fn(),
        list: jest.fn(),
      } as unknown as Stripe.CouponsResource;
      jest.spyOn(Stripe.prototype.setupIntents, 'retrieve').mockResolvedValue({ payment_method: 'pm_123' } as never);
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue({
        id: 'sub_mock_id',
        latest_invoice: { id: 'in_123', confirmation_secret: { client_secret: 'pi_secret', type: 'payment_intent' } },
      } as Stripe.Response<Stripe.Subscription>);
      jest.spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation').mockResolvedValue('payment_ref_123');
      jest.spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId').mockResolvedValue();

      await create();
      return createSpy;
    };

    test.each([
      ['createSubscription', () => stripeSubscriptionService.createSubscription()],
      [
        'createSubscriptionFromSetupIntent',
        () => stripeSubscriptionService.createSubscriptionFromSetupIntent('seti_1'),
      ],
    ])('%s sends the fee in add_invoice_items and the cart-total coupon in discounts', async (_name, create) => {
      const createSpy = await runAcceptedCartThroughCreate(create);

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          add_invoice_items: expect.arrayContaining([
            expect.objectContaining({
              price_data: expect.objectContaining({
                product: 'prod_fee',
                unit_amount: customLineItem.totalPrice.centAmount,
              }),
              quantity: 1,
            }),
          ]),
          discounts: [{ coupon: 'dc-total' }],
        }),
        expect.anything(),
      );
    });
  });

  describe('method createOneTimeItemsInvoice', () => {
    test('should create one time items invoice successfully', async () => {
      setupMockConfig({
        projectKey: 'test-project-key',
        stripeCollectBillingAddress: 'auto',
        stripeSecretKey: 'sk_test_123',
        authUrl: 'https://auth.test.com',
        apiUrl: 'https://api.test.com',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scope: 'test-scope',
        region: 'test-region',
        merchantReturnUrl: 'http://example.com',
      });

      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        cart: mockGetSubscriptionCartWithVariant(1),
        stripeCustomerId: 'cus_123',
        subscriptionParams: { customer: 'cus_123' },
        billingAddress: '123 Main St',
        merchantReturnUrl: 'http://example.com',
        lineItemAmount: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        priceId: 'price_123',
        shippingPriceId: undefined,
      } as BasicSubscriptionData);

      const result = await stripeSubscriptionService.prepareSubscriptionData();

      expect(result).toBeDefined();
      expect(result).toHaveProperty('cart');
      expect(result).toHaveProperty('stripeCustomerId');
      expect(result).toHaveProperty('subscriptionParams');
    });

    test('should handle error when creating one time items invoice', async () => {
      setupMockConfig({
        projectKey: 'test-project-key',
        stripeCollectBillingAddress: 'auto',
        stripeSecretKey: 'sk_test_123',
        authUrl: 'https://auth.test.com',
        apiUrl: 'https://api.test.com',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scope: 'test-scope',
        region: 'test-region',
        merchantReturnUrl: 'http://example.com',
      });

      jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockRejectedValue(new Error('Failed to create invoice'));

      try {
        await stripeSubscriptionService.prepareSubscriptionData();
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Failed to create invoice');
      }
    });
  });

  // The subscription first invoice must bill the cart's custom line items (a setup fee / service charge
  // carries no product id, so it cannot use the regular line-item pricing path). Each is billed via
  // price_data at its pre-discount `money × quantity`, and the cart coupon is kept off it when the
  // discount targets products only. Exercises getAllLineItemPrices directly.
  describe('method getAllLineItemPrices — custom line items on the first invoice', () => {
    const STRIPE_PRODUCT_ID = 'prod_customlineitem_mock';

    const getAllLineItemPrices = (cart: Cart) =>
      (
        stripeSubscriptionService as unknown as {
          getAllLineItemPrices: (c: Cart) => Promise<Stripe.SubscriptionCreateParams.AddInvoiceItem[]>;
        }
      ).getAllLineItemPrices(cart);

    const subscriptionCartWith = (
      customLineItems: CustomLineItem[],
      discountCodes: Cart['discountCodes'] = [],
    ): Cart => ({
      ...mockGetCartResult(),
      lineItems: [lineItemSubscription],
      customLineItems,
      discountCodes,
    });

    const oneCustomLineItem = (overrides: Partial<CustomLineItem> = {}): CustomLineItem => ({
      ...customLineItem,
      slug: 'setup-fee',
      ...overrides,
    });

    beforeEach(() => {
      // core's beforeEach resets these to bare mocks; this describe needs the builder's lookups to resolve.
      Stripe.prototype.products = {
        search: jest.fn().mockResolvedValue({ data: [] }),
        create: jest.fn().mockResolvedValue({ id: STRIPE_PRODUCT_ID }),
        retrieve: jest.fn(),
      } as unknown as Stripe.ProductsResource;
      Stripe.prototype.prices = {
        search: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      } as unknown as Stripe.PricesResource;
    });

    test('bills every custom line item at its totalPrice as a single unit, no tax_behavior', async () => {
      const items = await getAllLineItemPrices(subscriptionCartWith([oneCustomLineItem()]));

      // Exactly one invoice item — the custom line item (the subscription line item is excluded).
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({
        price_data: {
          currency: 'usd',
          product: STRIPE_PRODUCT_ID,
          unit_amount: customLineItem.totalPrice.centAmount,
        },
        quantity: 1,
      });
      // No tax_behavior → the invoice stays tax-free and comparable to the cart total.
      expect(
        (items[0].price_data as Stripe.SubscriptionCreateParams.AddInvoiceItem.PriceData).tax_behavior,
      ).toBeUndefined();
    });

    test('a total-price discount code does not change the fee amount — still billed at totalPrice, qty 1', async () => {
      // A total-price discount lives in cart.discountOnTotalPrice, not in the fee's totalPrice, so the
      // invoice-wide coupon applies it once over the whole invoice. The fee itself is billed at its own
      // totalPrice (customLineItemDiscounted: 18000). Non-total-price codes never reach here — they are
      // refused in prepareSubscriptionData (assertSupportedSubscriptionDiscounts) before any Stripe object.
      const items = await getAllLineItemPrices(
        subscriptionCartWith([customLineItemDiscounted], [mockDiscountCodeInfo('totalPrice')]),
      );

      expect(items).toHaveLength(1);
      expect((items[0].price_data as Stripe.SubscriptionCreateParams.AddInvoiceItem.PriceData).unit_amount).toBe(18000);
      expect(items[0].quantity).toBe(1);
    });

    test('a code-less direct discount is kept — the fee is billed at its already-net totalPrice', async () => {
      // A direct discount (no discount code) is netted into the fee's totalPrice; billing totalPrice keeps it.
      const items = await getAllLineItemPrices(subscriptionCartWith([customLineItemDiscounted], []));

      expect(items).toHaveLength(1);
      expect((items[0].price_data as Stripe.SubscriptionCreateParams.AddInvoiceItem.PriceData).unit_amount).toBe(18000);
      expect(items[0].quantity).toBe(1);
    });

    test('reuses an existing Stripe Product for the slug instead of creating a new one', async () => {
      Stripe.prototype.products.search = jest
        .fn()
        .mockResolvedValue({ data: [{ id: 'prod_existing' }] }) as unknown as typeof Stripe.prototype.products.search;

      const items = await getAllLineItemPrices(subscriptionCartWith([oneCustomLineItem()]));

      expect((items[0].price_data as Stripe.SubscriptionCreateParams.AddInvoiceItem.PriceData).product).toBe(
        'prod_existing',
      );
      expect(Stripe.prototype.products.create).not.toHaveBeenCalled();
    });

    test('skips a zero-amount custom line item — nothing to bill', async () => {
      const zero = { type: 'centPrecision', currencyCode: 'USD', centAmount: 0, fractionDigits: 2 } as const;
      const cart = subscriptionCartWith([oneCustomLineItem({ money: zero, totalPrice: zero })]);

      const items = await getAllLineItemPrices(cart);

      expect(items).toHaveLength(0);
      expect(Stripe.prototype.products.create).not.toHaveBeenCalled();
    });

    test('no regression: a subscription cart with no custom line items yields no price_data entries', async () => {
      const items = await getAllLineItemPrices(subscriptionCartWith([]));

      expect(items).toHaveLength(0);
    });
  });

  // ADR-026: on EVERY subscription cart (fees or not), only a cart-total discount is supported; every other
  // target, and any code-less direct discount, is refused before any Stripe object is created.
  describe('assertSupportedSubscriptionDiscounts — only a cart-total discount is supported', () => {
    const assertSupported = (cart: Cart): void =>
      (
        stripeSubscriptionService as unknown as { assertSupportedSubscriptionDiscounts: (c: Cart) => void }
      ).assertSupportedSubscriptionDiscounts(cart);

    const cartWith = (overrides: Partial<Cart>): Cart => ({ ...mockGetCartResult(), discountCodes: [], ...overrides });

    const expectRejected = (cart: Cart): void => {
      expect.assertions(2);
      try {
        assertSupported(cart);
      } catch (e) {
        expect(e).toBeInstanceOf(Errorx);
        expect((e as Errorx).code).toBe('UnsupportedCartDiscountForSubscription');
      }
    };

    test('accepts a total-price discount, with or without custom line items', () => {
      expect(() => assertSupported(cartWith({ discountCodes: [mockDiscountCodeInfo('totalPrice')] }))).not.toThrow();
      expect(() =>
        assertSupported(
          cartWith({ customLineItems: [customLineItem], discountCodes: [mockDiscountCodeInfo('totalPrice')] }),
        ),
      ).not.toThrow();
    });

    test('accepts a cart with no discounts at all', () => {
      expect(() => assertSupported(cartWith({}))).not.toThrow();
    });

    test('rejects a non-total-price code even on a cart WITHOUT custom line items (generalized rule)', () => {
      expectRejected(cartWith({ discountCodes: [mockDiscountCodeInfo('lineItems')] }));
    });

    test('rejects shipping, customLineItems and pattern targets', () => {
      expect(() => assertSupported(cartWith({ discountCodes: [mockDiscountCodeInfo('shipping')] }))).toThrow(Errorx);
      expect(() => assertSupported(cartWith({ discountCodes: [mockDiscountCodeInfo('customLineItems')] }))).toThrow(
        Errorx,
      );
      expect(() => assertSupported(cartWith({ discountCodes: [mockDiscountCodeInfo('pattern')] }))).toThrow(Errorx);
    });

    test('rejects when any applicable code is non-total-price, even mixed with a total-price one', () => {
      expectRejected(
        cartWith({ discountCodes: [mockDiscountCodeInfo('totalPrice', 'a'), mockDiscountCodeInfo('lineItems', 'b')] }),
      );
    });

    test('rejects an unexpanded discount whose target cannot be read', () => {
      const code = mockDiscountCodeInfo('totalPrice');
      const unexpanded = {
        ...code,
        discountCode: { ...code.discountCode, obj: { cartDiscounts: undefined } },
      } as unknown as Cart['discountCodes'][number];
      expectRejected(cartWith({ discountCodes: [unexpanded] }));
    });

    // commercetools records every applied discount on the cart; an automatic (code-less) or direct discount on
    // the total / line items / shipping appears in these portions and is refused unless it is the accepted
    // code's own. A discount landing only on custom line items is allowed (the fee bills at its totalPrice).
    const money = (c: number) => ({ type: 'centPrecision', currencyCode: 'USD', centAmount: c, fractionDigits: 2 });
    const portion = (id: string) => ({ discount: { typeId: 'cart-discount', id }, discountedAmount: money(100) });
    const perQuantity = (id: string) => [
      { quantity: 1, discountedPrice: { value: money(900), includedDiscounts: [portion(id)] } },
    ];

    test('rejects an automatic (code-less) cart-total discount — appears in discountOnTotalPrice', () => {
      expectRejected(
        cartWith({
          discountOnTotalPrice: {
            includedDiscounts: [portion('automatic-total')],
          } as unknown as Cart['discountOnTotalPrice'],
        }),
      );
    });

    test('accepts a cart-total discount whose portion is the accepted code own cart discount', () => {
      expect(() =>
        assertSupported(
          cartWith({
            discountCodes: [mockDiscountCodeInfo('totalPrice')],
            discountOnTotalPrice: {
              includedDiscounts: [portion('cd-dc-1')],
            } as unknown as Cart['discountOnTotalPrice'],
          }),
        ),
      ).not.toThrow();
    });

    test('rejects a line-item discount not from the accepted code (discountedPricePerQuantity)', () => {
      const li = { ...mockGetCartResult().lineItems[0], discountedPricePerQuantity: perQuantity('automatic-line') };
      expectRejected(cartWith({ lineItems: [li] as unknown as Cart['lineItems'] }));
    });

    test('rejects a shipping discount (shippingInfo.discountedPrice)', () => {
      expectRejected(
        cartWith({
          shippingInfo: {
            discountedPrice: { includedDiscounts: [portion('automatic-ship')] },
          } as unknown as Cart['shippingInfo'],
        }),
      );
    });

    test('accepts a discount landing only on custom line items (fee-only)', () => {
      const fee = { ...customLineItem, discountedPricePerQuantity: perQuantity('fee-disc') };
      expect(() =>
        assertSupported(cartWith({ customLineItems: [fee] as unknown as Cart['customLineItems'] })),
      ).not.toThrow();
    });

    test('ignores a non-total-price code commercetools does not apply (state != MatchesCart)', () => {
      const notApplied = {
        ...mockDiscountCodeInfo('lineItems'),
        state: 'DoesNotMatchCart',
      } as Cart['discountCodes'][number];
      expect(() => assertSupported(cartWith({ discountCodes: [notApplied] }))).not.toThrow();
    });
  });

  describe('assertNoNegativeCustomLineItem — reject credits before any Stripe object (#3)', () => {
    const assertNoNeg = (cart: Cart): void =>
      (
        stripeSubscriptionService as unknown as { assertNoNegativeCustomLineItem: (c: Cart) => void }
      ).assertNoNegativeCustomLineItem(cart);

    test('rejects a cart with a negative (credit) custom line item — Errorx 400', () => {
      const cart: Cart = {
        ...mockGetCartResult(),
        customLineItems: [
          {
            ...customLineItem,
            money: { type: 'centPrecision', currencyCode: 'USD', centAmount: -500, fractionDigits: 2 },
          },
        ],
      };

      expect.assertions(2);
      try {
        assertNoNeg(cart);
      } catch (e) {
        expect(e).toBeInstanceOf(Errorx);
        expect((e as Errorx).code).toBe('NegativeCustomLineItemNotSupported');
      }
    });

    test('accepts positive and zero custom line items', () => {
      expect(() => assertNoNeg({ ...mockGetCartResult(), customLineItems: [customLineItem] })).not.toThrow();
    });
  });

  describe('method prepareSubscriptionData', () => {
    test('should prepare subscription data successfully', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);

      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        cart: mockCart,
        stripeCustomerId: 'cus_123',
        subscriptionParams: { customer: 'cus_123' },
        billingAddress: '123 Main St',
        merchantReturnUrl: 'http://example.com',
        lineItemAmount: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        priceId: 'price_123',
        shippingPriceId: undefined,
      } as BasicSubscriptionData);

      const result = await stripeSubscriptionService.prepareSubscriptionData();

      expect(result).toBeDefined();
      expect(result).toHaveProperty('cart');
      expect(result).toHaveProperty('stripeCustomerId');
      expect(result).toHaveProperty('subscriptionParams');
    });

    test('should prepare subscription data with coupon', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);

      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        cart: mockCart,
        stripeCustomerId: 'cus_123',
        subscriptionParams: { customer: 'cus_123' },
        billingAddress: '123 Main St',
        merchantReturnUrl: 'http://example.com',
        lineItemAmount: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        priceId: 'price_123',
        shippingPriceId: undefined,
      } as BasicSubscriptionData);

      const result = await stripeSubscriptionService.prepareSubscriptionData();

      expect(result).toBeDefined();
      expect(result).toHaveProperty('cart');
      expect(result).toHaveProperty('stripeCustomerId');
      expect(result).toHaveProperty('subscriptionParams');
    });

    // A cart may carry at most one subscription line item. The create flow billed only
    // the first (findSubscriptionLineItem) and getAllLineItemPrices excluded every subscription item from
    // add_invoice_items, so a second subscription product was never sent to Stripe yet stayed in the cart
    // the order was minted from; with a discount code the first-cycle amount guard was exempt and the
    // cart-drift guard could not fire on an unchanged cart, so the order was minted Paid for goods Stripe
    // never billed. assertSingleSubscriptionLineItem rejects that cart shape before any Stripe object is
    // created, enforcing business-rules/mixed-carts.md Rule 4.
    describe('rejects a cart with more than one subscription line item (mixed-carts Rule 4)', () => {
      const assertSingle = (cart: Cart): void =>
        (
          stripeSubscriptionService as unknown as { assertSingleSubscriptionLineItem: (c: Cart) => void }
        ).assertSingleSubscriptionLineItem(cart);

      test('rejects two subscription line items — Errorx 400, MultipleSubscriptionsNotSupported', () => {
        expect.assertions(3);
        try {
          assertSingle(mockGetSubscriptionCartWithTwoItems);
        } catch (e) {
          expect(e).toBeInstanceOf(Errorx);
          expect((e as Errorx).code).toBe('MultipleSubscriptionsNotSupported');
          expect((e as Errorx).httpErrorStatus).toBe(400);
        }
      });

      test('rejects whether or not a discount code is present — the guard rejects on cart shape alone', () => {
        // A discount code is what disabled the downstream amount guard; this pre-create check never reads it.
        const withDiscount = {
          ...mockGetSubscriptionCartWithTwoItems,
          discountCodes: [{ discountCode: { typeId: 'discount-code', id: 'dc-1' }, state: 'MatchesCart' }],
        } as unknown as Cart;

        expect(() => assertSingle(withDiscount)).toThrow('at most one subscription item');
      });

      test('no regression: a single subscription line item is accepted', () => {
        expect(() => assertSingle(mockGetSubscriptionCart)).not.toThrow();
      });

      test('no regression: a single subscription line item WITH a discount code is accepted (AC-5)', () => {
        const singleWithDiscount = {
          ...mockGetSubscriptionCart,
          discountCodes: [{ discountCode: { typeId: 'discount-code', id: 'dc-1' }, state: 'MatchesCart' }],
        } as unknown as Cart;

        expect(() => assertSingle(singleWithDiscount)).not.toThrow();
      });

      test('no regression: one subscription item plus one-time line items is accepted (mixed cart)', () => {
        const mixed: Cart = { ...mockGetCartResult(), lineItems: [lineItemSubscription, lineItem] };

        expect(() => assertSingle(mixed)).not.toThrow();
      });

      test('wiring: prepareSubscriptionData rejects a two-subscription cart before any Stripe call', async () => {
        // Exercises the actual call site, not just the helper: getCartExpanded is the service's cart source
        // and the guard is its first cart-dependent action, so it rejects before findSubscriptionLineItem /
        // customerService / any Stripe call. If the guard call were removed, execution would fall through and
        // throw something else, failing this test.
        setupMockConfig({ merchantReturnUrl: 'http://example.com' });
        jest.spyOn(CartClient, 'getCartExpanded').mockResolvedValue(mockGetSubscriptionCartWithTwoItems);

        await expect(stripeSubscriptionService.prepareSubscriptionData()).rejects.toThrow(
          'at most one subscription item',
        );
      });
    });
  });

  describe('method saveSubscriptionId', () => {
    test('should save subscription ID successfully', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(6);
      const mockSubscriptionId = 'sub_123';

      jest.spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId').mockResolvedValue(undefined);

      const result = await stripeSubscriptionService.saveSubscriptionId(mockCart, mockSubscriptionId);

      expect(result).toBeUndefined();
      expect(mockSubscriptionId).toBe('sub_123');
    });
  });

  describe('method handleCtPaymentCreation', () => {
    test('should handle CT payment creation successfully', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);
      const mockSubscriptionId = 'sub_123';

      const spiedHandleCtPaymentCreationMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation')
        .mockResolvedValue('payment_ref_123');

      const result = await CtPaymentCreationService.prototype.handleCtPaymentCreation({
        cart: mockCart,
        amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        interactionId: mockSubscriptionId,
      });

      expect(result).toBe('payment_ref_123');
      expect(spiedHandleCtPaymentCreationMock).toHaveBeenCalled();
    });
  });
});
