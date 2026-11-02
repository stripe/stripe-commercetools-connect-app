jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {}),
}));

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import Stripe from 'stripe';
import { StripeSubscriptionService } from '../../src/services/stripe-subscription.service';
import { paymentSDK } from '../../src/payment-sdk';
import { mockGetCartResult, lineItemSubscription, customLineItem } from '../utils/mock-cart-data';
import { Cart, CustomLineItem } from '@commercetools/platform-sdk';

jest.mock('../../src/libs/logger');

/**
 * SB3-241 — the subscription first invoice must bill the cart's custom line items.
 *
 * Before the fix, getAllLineItemPrices iterated cart.lineItems only, so a custom line item (setup
 * fee / service charge) was dropped from add_invoice_items and the first invoice undercharged. These
 * tests exercise that private builder directly: each FAILS on the pre-fix code (no price_data entry
 * for the custom line item) and PASSES after.
 */
describe('stripe-subscription.service — SB3-241 custom line items on the first invoice', () => {
  const opts = {
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
    ctOrderService: paymentSDK.ctOrderService,
  };
  const service = new StripeSubscriptionService(opts);
  // getAllLineItemPrices is private; the fix is about what it returns for add_invoice_items.
  const getAllLineItemPrices = (cart: Cart) =>
    (
      service as unknown as {
        getAllLineItemPrices: (c: Cart) => Promise<Stripe.SubscriptionCreateParams.AddInvoiceItem[]>;
      }
    ).getAllLineItemPrices(cart);

  const STRIPE_PRODUCT_ID = 'prod_customlineitem_mock';

  beforeEach(() => {
    jest.resetAllMocks();
    Stripe.prototype.products = {
      // No existing Stripe product for the slug → the builder creates one.
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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** A subscription cart whose only non-subscription charge is one custom line item. */
  const subscriptionCartWithCustomLineItem = (overrides: Partial<CustomLineItem> = {}): Cart => ({
    ...mockGetCartResult(),
    lineItems: [lineItemSubscription],
    customLineItems: [{ ...customLineItem, slug: 'setup-fee', ...overrides }],
  });

  test('bills the custom line item: an add_invoice_items entry carries its totalPrice as unit_amount', async () => {
    const cart = subscriptionCartWithCustomLineItem();

    const items = await getAllLineItemPrices(cart);

    // Exactly one invoice item — the custom line item (the subscription line item is excluded).
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({
        quantity: 1,
        price_data: expect.objectContaining({
          product: STRIPE_PRODUCT_ID,
          currency: 'usd',
          // The amount cart.totalPrice is composed from — the whole point of SB3-241.
          unit_amount: customLineItem.totalPrice.centAmount,
        }),
      }),
    );
    // No tax_behavior is set, so the invoice stays tax-free and comparable to cart.totalPrice (KI-056).
    expect(
      (items[0].price_data as Stripe.SubscriptionCreateParams.AddInvoiceItem.PriceData).tax_behavior,
    ).toBeUndefined();
  });

  test('reuses an existing Stripe Product for the slug instead of creating a new one', async () => {
    Stripe.prototype.products.search = jest
      .fn()
      .mockResolvedValue({ data: [{ id: 'prod_existing' }] }) as unknown as typeof Stripe.prototype.products.search;

    const items = await getAllLineItemPrices(subscriptionCartWithCustomLineItem());

    expect((items[0].price_data as Stripe.SubscriptionCreateParams.AddInvoiceItem.PriceData).product).toBe(
      'prod_existing',
    );
    expect(Stripe.prototype.products.create).not.toHaveBeenCalled();
  });

  test('skips a zero-amount custom line item — nothing to bill', async () => {
    const cart = subscriptionCartWithCustomLineItem({
      totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: 0, fractionDigits: 2 },
    });

    const items = await getAllLineItemPrices(cart);

    expect(items).toHaveLength(0);
    expect(Stripe.prototype.products.create).not.toHaveBeenCalled();
  });

  test('skips a negative (credit) custom line item — Stripe unit_amount cannot be negative (KI-081)', async () => {
    // A credit cannot be expressed on add_invoice_items; the connector logs and skips it (KI-081).
    const cart = subscriptionCartWithCustomLineItem({
      totalPrice: { type: 'centPrecision', currencyCode: 'USD', centAmount: -500, fractionDigits: 2 },
    });

    const items = await getAllLineItemPrices(cart);

    expect(items).toHaveLength(0);
    expect(Stripe.prototype.products.create).not.toHaveBeenCalled();
  });

  test('no regression: a subscription cart with no custom line items yields no price_data entries', async () => {
    const cart: Cart = { ...mockGetCartResult(), lineItems: [lineItemSubscription], customLineItems: [] };

    const items = await getAllLineItemPrices(cart);

    expect(items).toHaveLength(0);
  });
});
