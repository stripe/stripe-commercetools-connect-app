import Stripe from 'stripe';
import { DiscountCode, DiscountCodeInfo, Cart } from '@commercetools/platform-sdk';
import { Errorx } from '@commercetools/connect-payments-sdk';
import { stripeApi } from '../clients/stripe.client';
import { convertDateToUnixTimestamp, getLocalizedString } from '../utils';
import { log } from '../libs/logger';

const stripe = stripeApi();

export class StripeCouponService {
  /**
   * Translates the discount codes commercetools applies to this cart into Stripe coupons.
   *
   * There is deliberately no `StopAfterThisDiscount` handling here any more. The loop used to break
   * when a code's cart discount carried that stacking mode, which re-derived commercetools' stacking
   * verdict from configuration — the thing Rule 3 exists to stop. It also got it wrong: commercetools
   * applies cart discounts by `sortOrder`, while `cart.discountCodes` is in insertion order, so a
   * stopping discount that sorted last (and therefore stopped nothing) still broke the loop and
   * dropped a code commercetools HAD applied. Stripe then collected more than the cart total.
   *
   * commercetools already reports the outcome: anything it stopped carries
   * `ApplicationStoppedByPreviousDiscount`, which never reaches this loop. Every code that does reach
   * it is one commercetools put into the cart total, so every one of them is translated.
   */
  public async getStripeCoupons(cart: Cart): Promise<Stripe.SubscriptionCreateParams.Discount[] | undefined> {
    if (!cart.discountCodes.length) {
      return undefined;
    }

    const coupons: Stripe.SubscriptionCreateParams.Discount[] = [];
    // An absolute CT discount carries one amount per currency; only the cart's own is meaningful here.
    const cartCurrency = cart.totalPrice.currencyCode;

    for (const code of cart.discountCodes) {
      this.assertOrderableWithCode(code);

      if (!this.appliesToCart(code)) {
        continue;
      }

      const discountCode = code.discountCode.obj;

      if (!discountCode) {
        throw new Error(`Discount code "${code.discountCode.id}" not found`);
      }

      if (!(discountCode.cartDiscounts.length === 1)) {
        throw new Error(`Discount "${code.discountCode.id}" has multiple cart discounts. Not supported by Stripe.`);
      }

      const stripeDiscount = await this.getStripeCouponById(discountCode.id);
      coupons.push({ coupon: await this.resolveStripeCoupon(discountCode, stripeDiscount, cartCurrency) });
    }

    // Every code on the cart may have been skipped. Report that the same way as a cart that carries no
    // codes at all, so the caller passes no `discounts` to Stripe rather than an empty array.
    return coupons.length ? coupons : undefined;
  }

  /**
   * States commercetools will still create an order from. Everything else makes `createOrderFromCart`
   * fail with `DiscountCodeNonApplicable`, quoting the SDK's own documentation of `DiscountCodeState`:
   *
   *   "If an Order is created from a Cart with a state other than `MatchesCart` or
   *    `ApplicationStoppedByGroupBestDeal`, a DiscountCodeNonApplicable error is returned."
   *
   * Deliberately a whitelist: a state commercetools adds later is unknown to us and must not be
   * assumed orderable.
   */
  private static readonly ORDERABLE_STATES = ['MatchesCart', 'ApplicationStoppedByGroupBestDeal'];

  /**
   * Refuses the checkout while refusing is still free.
   *
   * Skipping a non-applicable code is necessary but not sufficient: the subscription is still created
   * and the shopper is still charged — at the FULL amount, since no coupon was attached — and only
   * afterwards does commercetools refuse to create the order, for the same reason the code was
   * skipped. That error is not retryable, so it is logged, Stripe receives HTTP 200 and never
   * redelivers, and the shopper is left having paid with nothing to fulfil and nothing to refund
   * against. The cap fix made that outcome *more* expensive for the shopper, not less: before it, the
   * resurrected coupon at least meant they were charged the discounted amount.
   *
   * Everything needed to decide this is on the cart before any money moves, so it is decided here.
   * Thrown from inside `getStripeCoupons`, which is awaited as an argument to `subscriptions.create`,
   * so the subscription is never created, no invoice exists, and no CT payment is recorded.
   *
   * `ApplicationStoppedByGroupBestDeal` is the one non-applying state that must NOT refuse:
   * commercetools creates that order and simply does not apply the discount, which is a legitimate
   * outcome the shopper should not be blocked on.
   */
  private assertOrderableWithCode(code: DiscountCodeInfo): void {
    if (StripeCouponService.ORDERABLE_STATES.includes(code.state)) {
      return;
    }

    log.warn('Refusing subscription creation: commercetools will not create an order from this cart.', {
      ctDiscountCodeId: code.discountCode.id,
      discountCodeState: code.state,
    });

    throw new Errorx({
      code: 'DiscountCodeNonApplicable',
      message:
        `The discount code on this cart cannot be applied (commercetools reports "${code.state}"), and ` +
        `commercetools will not create an order while it is on the cart. Remove the code and try again.`,
      httpErrorStatus: 400,
      fields: { ctDiscountCodeId: code.discountCode.id, discountCodeState: code.state },
    });
  }

  /**
   * commercetools decides whether a discount code applies to a cart; this connector never re-derives
   * that verdict from the code's own configuration.
   *
   * `MatchesCart` is the only state in which the discount is part of the CT cart total, so it is the
   * only state in which a Stripe coupon may be attached to the subscription. By the time this runs,
   * `assertOrderableWithCode` has already refused every state commercetools would reject the order
   * for, so the only state that reaches the `false` branch is `ApplicationStoppedByGroupBestDeal` —
   * an order commercetools creates without the discount, which is why it is skipped and not refused.
   */
  public appliesToCart(code: DiscountCodeInfo): boolean {
    if (code.state === 'MatchesCart') {
      return true;
    }

    log.warn('Discount code not applied to the Stripe subscription: commercetools does not apply it to this cart.', {
      ctDiscountCodeId: code.discountCode.id,
      discountCodeState: code.state,
    });
    return false;
  }

  /**
   * Resolves the Stripe coupon that carries a CT discount code onto the subscription invoice.
   *
   * A coupon Stripe reports as no longer applicable is NOT a re-sync trigger. Only a coupon whose
   * stored configuration diverges from the CT discount code is deleted and recreated, because the
   * coupon id is the CT discount code id and Stripe hands a recreated id a fresh redemption counter.
   * Reissuing on `valid: false` would therefore clear whatever limit Stripe was applying every time
   * that limit was reached. See `business-rules/coupon-sync.md` Rule 3 and ADR-018.
   */
  public async resolveStripeCoupon(
    discount: DiscountCode,
    stripeDiscount: Stripe.Coupon | undefined,
    cartCurrency: string,
  ): Promise<string> {
    if (!stripeDiscount || stripeDiscount.deleted) {
      return this.createStripeDiscountCode(discount, cartCurrency);
    }

    if (this.hasDivergentConfig(discount, stripeDiscount, cartCurrency)) {
      await this.deleteStripeDiscountCode(discount.id);
      return this.createStripeDiscountCode(discount, cartCurrency);
    }

    if (stripeDiscount.valid) {
      return stripeDiscount.id;
    }

    // In sync with CT, yet Stripe will not apply it. Reissuing would discount the invoice past what
    // Stripe still permits; dropping it would charge the shopper more than the CT cart says. Neither
    // is ours to choose silently, so the subscription creation fails and the operator reconciles.
    throw new Error(
      `Stripe coupon "${discount.id}" matches its commercetools discount code but Stripe reports it as ` +
        `no longer applicable. Refusing to reissue or drop it.`,
    );
  }

  public async getStripeCouponById(id: string): Promise<Stripe.Coupon | undefined> {
    try {
      const coupon = await stripe.coupons.retrieve(id);
      return coupon;
    } catch {
      log.warn('Stripe coupon not found:', id);
      return undefined;
    }
  }

  /**
   * The CT usage cap is deliberately not mirrored into `max_redemptions`. commercetools enforces it
   * (see `appliesToCart`), and mirroring it only made Stripe mark the coupon `valid: false` once the
   * cap was reached, which is what drove the delete-and-recreate that reset the counter. The Stripe
   * coupon exists to carry the price onto the invoice, not to enforce the limit. See ADR-018.
   */
  public async createStripeDiscountCode(discount: DiscountCode, cartCurrency: string): Promise<string> {
    const { expirationDate, currency, amount, name } = this.getDiscountConfig(discount, cartCurrency);

    const newDiscount = await stripe.coupons.create({
      id: discount.id,
      name,
      currency,
      duration: 'once',
      redeem_by: expirationDate,
      ...amount,
    });
    return newDiscount.id;
  }

  /**
   * Deletion failures are surfaced, not swallowed (KI-007). The coupon id is the CT discount code id,
   * so a delete that quietly failed left the following create failing on a duplicate id, with the
   * cause already logged away and gone.
   */
  public async deleteStripeDiscountCode(id: string): Promise<void> {
    try {
      await stripe.coupons.del(id);
      log.info(`Stripe coupon "${id}" deleted; it no longer matched its commercetools discount code.`);
    } catch (error) {
      log.error(`Failed to delete Stripe discount code: "${id}"`, error);
      throw error;
    }
  }

  /**
   * True when the stored Stripe coupon no longer reflects the CT discount code and must be replaced.
   *
   * This answers only "is it in sync", never "can it still be used" — the two questions were fused
   * before, which is how an exhausted coupon came to be treated as a merchant edit and reissued.
   *
   * `max_redemptions` is compared against nothing because it is no longer mirrored: a stored coupon
   * that still carries one predates that change, and is replaced once, on first touch.
   */
  public hasDivergentConfig(discount: DiscountCode, stripeDiscount: Stripe.Coupon, cartCurrency: string): boolean {
    const { isPercentage, isAmountOff, amountOff, percentOff, expirationDate, currency } = this.getDiscountConfig(
      discount,
      cartCurrency,
    );
    const hasDifferentPercentage = !!(isPercentage && stripeDiscount.percent_off !== percentOff);
    const hasDifferentAmountOff = !!(isAmountOff && stripeDiscount.amount_off !== amountOff);
    // Compared in both directions. A code whose validUntil was REMOVED in commercetools still has a stored
    // coupon carrying the old redeem_by; Stripe cannot edit redeem_by in place, and once that date passes
    // Stripe reports the coupon unusable while commercetools still applies the code. Treating that as
    // divergence recreates the coupon once, without the date; ignoring it made every checkout with the
    // code fail on the "in sync yet unusable" branch below. Absent and null both mean "no date".
    const hasDifferentExpirationDate = (stripeDiscount.redeem_by ?? null) !== (expirationDate ?? null);
    const hasDifferentCurrency = !!(currency && stripeDiscount.currency?.toLowerCase() !== currency.toLowerCase());
    // Absent, not merely null, also counts as "no cap stored" — an unreadable field must never be the
    // reason a coupon is destroyed and recreated.
    const hasStaleMaxRedemptions =
      stripeDiscount.max_redemptions !== null && stripeDiscount.max_redemptions !== undefined;

    return (
      hasDifferentPercentage ||
      hasDifferentAmountOff ||
      hasDifferentExpirationDate ||
      hasDifferentCurrency ||
      hasStaleMaxRedemptions
    );
  }

  public getDiscountConfig(discount: DiscountCode, cartCurrency: string) {
    const cartDiscount = discount.cartDiscounts[0].obj;
    if (!cartDiscount) {
      throw new Error(`Cart discount not found for discount code "${discount.id}"`);
    }

    const discountType = cartDiscount.value.type;
    if (discountType === 'fixed' || discountType === 'giftLineItem') {
      throw new Error('Cart discount type is not supported');
    }

    const name = getLocalizedString(discount.name);
    const isPercentage = cartDiscount.value.type === 'relative';
    const isAmountOff = cartDiscount.value.type === 'absolute';
    const expirationDate = discount.validUntil ? convertDateToUnixTimestamp(discount.validUntil) : undefined;
    const percentOff = isPercentage ? cartDiscount.value.permyriad / 100 : undefined;
    // An absolute CT cart discount holds one CentPrecisionMoney per currency it is defined for.
    // Taking `money[0]` took whichever the API happened to list first: on a multi-currency discount
    // that is the wrong amount in the wrong currency, and Stripe then rejects the subscription create
    // — after the products, prices and customer for this checkout have already been created. Select
    // the cart's own currency, and refuse if the discount is not defined for it, because there is no
    // correct coupon to build in that case and guessing one charges the shopper the wrong number.
    const money = isAmountOff
      ? cartDiscount.value.money.find((m) => m.currencyCode.toLowerCase() === cartCurrency.toLowerCase())
      : undefined;

    if (isAmountOff && !money) {
      throw new Errorx({
        code: 'DiscountCodeCurrencyMismatch',
        message:
          `The discount code on this cart is not defined for ${cartCurrency}. Remove the code and try ` +
          `again, or ask the merchant to add an amount for this currency.`,
        httpErrorStatus: 400,
        fields: {
          ctDiscountCodeId: discount.id,
          cartCurrency,
          definedFor: cartDiscount.value.money.map((m) => m.currencyCode),
        },
      });
    }

    const amountOff = money?.centAmount;
    const currency = money?.currencyCode;
    const amount = isPercentage ? { percent_off: percentOff } : isAmountOff ? { amount_off: amountOff } : null;

    return {
      isPercentage,
      isAmountOff,
      expirationDate,
      name,
      currency,
      amountOff,
      percentOff,
      amount,
    };
  }
}
