import Stripe from 'stripe';
import { DiscountCode, Cart } from '@commercetools/platform-sdk';
import { stripeApi } from '../clients/stripe.client';
import { convertDateToUnixTimestamp, getLocalizedString } from '../utils';
import { log } from '../libs/logger';

const stripe = stripeApi();

export class StripeCouponService {
  public async getStripeCoupons(cart: Cart): Promise<Stripe.SubscriptionCreateParams.Discount[] | undefined> {
    if (!cart.discountCodes.length) {
      return undefined;
    }

    const coupons: Stripe.SubscriptionCreateParams.Discount[] = [];

    for (const code of cart.discountCodes) {
      const discountCode = code.discountCode.obj;

      if (!discountCode) {
        throw new Error(`Discount code "${code.discountCode.id}" not found`);
      }

      if (!(discountCode.cartDiscounts.length === 1)) {
        throw new Error(`Discount "${code.discountCode.id}" has multiple cart discounts. Not supported by Stripe.`);
      }

      const stripeDiscount = await this.getStripeCouponById(discountCode.id);
      const isValidCoupon = this.validateDiscountCode(discountCode, stripeDiscount);

      if (isValidCoupon && stripeDiscount) {
        coupons.push({ coupon: stripeDiscount.id });
      } else {
        if (stripeDiscount) {
          await this.deleteStripeDiscountCode(discountCode.id);
        }
        const newCode = await this.createStripeDiscountCode(discountCode);
        coupons.push({ coupon: newCode });
      }

      const stackingMode = discountCode.cartDiscounts[0].obj?.stackingMode;
      if (stackingMode === 'StopAfterThisDiscount') {
        break;
      }
    }
    return coupons;
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

  public async createStripeDiscountCode(discount: DiscountCode): Promise<string> {
    const { expirationDate, maxRedemptions, currency, amount, name } = this.getDiscountConfig(discount);

    const newDiscount = await stripe.coupons.create({
      id: discount.id,
      name,
      currency,
      duration: 'once',
      max_redemptions: maxRedemptions,
      redeem_by: expirationDate,
      ...amount,
    });
    return newDiscount.id;
  }

  public async deleteStripeDiscountCode(id: string): Promise<void> {
    try {
      await stripe.coupons.del(id);
      log.info(`Stripe discount code "${id}" is no longer valid, has been deleted successfully`);
    } catch (error) {
      log.error(`Failed to delete Stripe discount code: "${id}"`, error);
    }
  }

  public validateDiscountCode(discount: DiscountCode, stripeDiscount?: Stripe.Coupon) {
    if (!stripeDiscount || !stripeDiscount.valid || stripeDiscount.deleted) {
      return false;
    }

    const { isPercentage, isAmountOff, amountOff, percentOff, expirationDate, currency, maxRedemptions } =
      this.getDiscountConfig(discount);
    const hasDifferentPercentage = !!(isPercentage && stripeDiscount.percent_off !== percentOff);
    const hasDifferentAmountOff = !!(isAmountOff && stripeDiscount.amount_off !== amountOff);
    const hasDifferentExpirationDate = !!(expirationDate && stripeDiscount.redeem_by !== expirationDate);
    const hasDifferentCurrency = !!(currency && stripeDiscount.currency?.toLowerCase() !== currency.toLowerCase());
    const hasDifferentMaxRedemptions = !!(maxRedemptions && stripeDiscount.max_redemptions !== maxRedemptions);

    return !(
      hasDifferentPercentage ||
      hasDifferentAmountOff ||
      hasDifferentExpirationDate ||
      hasDifferentCurrency ||
      hasDifferentMaxRedemptions
    );
  }

  public getDiscountConfig(discount: DiscountCode) {
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
    const amountOff = isAmountOff ? cartDiscount.value.money[0].centAmount : undefined;
    const currency = isAmountOff ? cartDiscount.value.money[0].currencyCode : undefined;
    const amount = isPercentage ? { percent_off: percentOff } : isAmountOff ? { amount_off: amountOff } : null;

    return {
      isPercentage,
      isAmountOff,
      expirationDate,
      name,
      currency,
      maxRedemptions: discount.maxApplications,
      amountOff,
      percentOff,
      amount,
    };
  }
}
