jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {}),
}));

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { Errorx } from '@commercetools/connect-payments-sdk';
import { Cart, CustomLineItem } from '@commercetools/platform-sdk';
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
} from '../utils/mock-cart-data';
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

    test('bills the custom line item as an exact add_invoice_items entry (money × quantity, no tax_behavior)', async () => {
      const items = await getAllLineItemPrices(subscriptionCartWith([oneCustomLineItem()]));

      // Exactly one invoice item — the custom line item (the subscription line item is excluded).
      expect(items).toHaveLength(1);
      // The exact payload the connector sends to subscriptions.create for a custom line item.
      expect(items[0]).toEqual({
        price_data: {
          currency: 'usd',
          product: STRIPE_PRODUCT_ID,
          unit_amount: customLineItem.money.centAmount,
        },
        quantity: customLineItem.quantity,
      });
      // No tax_behavior → the invoice stays tax-free and comparable to the cart total.
      expect(
        (items[0].price_data as Stripe.SubscriptionCreateParams.AddInvoiceItem.PriceData).tax_behavior,
      ).toBeUndefined();
      // No coupon on the cart → the item is not opted out of any subscription discount.
      expect(items[0].discounts).toBeUndefined();
    });

    test('bills money × quantity, not totalPrice — a discount on the custom line item is not applied twice', async () => {
      // customLineItemDiscounted: money 10000 × qty 2 = 20000; totalPrice 18000 (a 2000 discount). The cart
      // also carries a totalPrice-targeted coupon, which Stripe applies once. Billing totalPrice here would
      // subtract the discount twice; the connector must send the pre-discount money × quantity.
      const items = await getAllLineItemPrices(
        subscriptionCartWith([customLineItemDiscounted], [mockDiscountCodeInfo('totalPrice')]),
      );

      expect(items).toHaveLength(1);
      expect((items[0].price_data as Stripe.SubscriptionCreateParams.AddInvoiceItem.PriceData).unit_amount).toBe(10000);
      expect(items[0].quantity).toBe(2);
      // The discount targets the total → the coupon legitimately applies to the custom line item.
      expect(items[0].discounts).toBeUndefined();
    });

    test('a product-targeted discount is kept off the custom line item (discounts: [])', async () => {
      // commercetools does not discount a custom line item when the cart discount targets lineItems only,
      // so the Stripe coupon must not either — otherwise Stripe collects less than the cart total.
      const items = await getAllLineItemPrices(
        subscriptionCartWith([oneCustomLineItem()], [mockDiscountCodeInfo('lineItems')]),
      );

      expect(items).toHaveLength(1);
      expect(items[0].discounts).toEqual([]);
    });

    test('a customLineItems-targeted discount keeps the coupon on the custom line item', async () => {
      const items = await getAllLineItemPrices(
        subscriptionCartWith([oneCustomLineItem()], [mockDiscountCodeInfo('customLineItems')]),
      );

      expect(items).toHaveLength(1);
      expect(items[0].discounts).toBeUndefined();
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
      const cart = subscriptionCartWith([
        oneCustomLineItem({ money: { type: 'centPrecision', currencyCode: 'USD', centAmount: 0, fractionDigits: 2 } }),
      ]);

      const items = await getAllLineItemPrices(cart);

      expect(items).toHaveLength(0);
      expect(Stripe.prototype.products.create).not.toHaveBeenCalled();
    });

    test('rejects a negative (credit) custom line item with Errorx 400 — a credit cannot be billed on add_invoice_items', async () => {
      const cart = subscriptionCartWith([
        oneCustomLineItem({
          money: { type: 'centPrecision', currencyCode: 'USD', centAmount: -500, fractionDigits: 2 },
        }),
      ]);

      await expect(getAllLineItemPrices(cart)).rejects.toThrow(Errorx);
      await expect(getAllLineItemPrices(cart)).rejects.toMatchObject({
        code: 'NegativeCustomLineItemNotSupported',
        httpErrorStatus: 400,
      });
      expect(Stripe.prototype.products.create).not.toHaveBeenCalled();
    });

    test('no regression: a subscription cart with no custom line items yields no price_data entries', async () => {
      const items = await getAllLineItemPrices(subscriptionCartWith([]));

      expect(items).toHaveLength(0);
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

    // SB3-242 / KI-018 — a cart may carry at most one subscription line item. The create flow billed only
    // the first (findSubscriptionLineItem) and getAllLineItemPrices excluded every subscription item from
    // add_invoice_items, so a second subscription product was never sent to Stripe yet stayed in the cart
    // the order was minted from; with a discount code the first-cycle amount guard was exempt and the
    // cart-drift guard could not fire on an unchanged cart, so the order was minted Paid for goods Stripe
    // never billed. assertSingleSubscriptionLineItem rejects that cart shape before any Stripe object is
    // created, enforcing business-rules/mixed-carts.md Rule 4. Security invariant:
    // context/validated-flows/security/sb3-242-multi-subscription-cart.md
    describe('rejects a cart with more than one subscription line item (mixed-carts Rule 4 / KI-018, SB3-242)', () => {
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
