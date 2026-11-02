jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {}),
}));

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { Errorx } from '@commercetools/connect-payments-sdk';
import { Cart } from '@commercetools/platform-sdk';
import { StripeSubscriptionService } from '../../src/services/stripe-subscription.service';
import { paymentSDK } from '../../src/payment-sdk';
import * as CartClient from '../../src/services/commerce-tools/cart-client';
import {
  mockGetCartResult,
  mockGetSubscriptionCart,
  mockGetSubscriptionCartWithTwoItems,
  lineItem,
  lineItemSubscription,
} from '../utils/mock-cart-data';

jest.mock('../../src/libs/logger');

/**
 * SB3-242 / KI-018 — a cart with more than one subscription line item must be rejected before any
 * Stripe object is created. Before the fix the connector billed only the first subscription item and
 * silently dropped the rest; with a discount code the first-cycle amount guard was exempt and the
 * cart-drift guard could not fire on an unchanged cart, so the order was minted Paid for goods Stripe
 * never billed. assertSingleSubscriptionLineItem — called from prepareSubscriptionData, the single
 * point every create entry (createSetupIntent, createSubscription, createSubscriptionFromSetupIntent)
 * shares — enforces business-rules/mixed-carts.md Rule 4.
 */
describe('stripe-subscription.service — SB3-242 reject carts with more than one subscription item', () => {
  const opts = {
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
    ctOrderService: paymentSDK.ctOrderService,
  };
  const service = new StripeSubscriptionService(opts);
  const assertSingle = (cart: Cart): void =>
    (service as unknown as { assertSingleSubscriptionLineItem: (c: Cart) => void }).assertSingleSubscriptionLineItem(
      cart,
    );

  test('rejects a cart with two subscription line items — Errorx 400, MultipleSubscriptionsNotSupported', () => {
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
    // SB3-242: a discount code is what disables the amount guard downstream; this pre-create check
    // never consults the discount, so it closes the hole with OR without a code applied.
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
    // The legitimate discounted single-subscription flow must still pass — the guard counts line items
    // and never reads discountCodes, so a discount present on a single-subscription cart is irrelevant to it.
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

  describe('wiring — the guard runs inside prepareSubscriptionData, before any Stripe object is created', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('prepareSubscriptionData rejects a two-subscription cart (the one line that fixes the bug is reached)', async () => {
      // Exercises the actual call site at prepareSubscriptionData, not just the helper: getCartExpanded
      // is the service's own cart source, and the guard is its first cart-dependent action — so this
      // rejects before findSubscriptionLineItem / customerService / any Stripe call. If the guard call
      // were removed, execution would fall through to those and throw something else, failing this test.
      jest.spyOn(CartClient, 'getCartExpanded').mockResolvedValue(mockGetSubscriptionCartWithTwoItems);

      await expect(service.prepareSubscriptionData()).rejects.toThrow('at most one subscription item');
    });
  });
});
