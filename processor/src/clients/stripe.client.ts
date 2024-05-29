import Stripe from 'stripe';
import { getConfig } from '../config/config';
import { StripeApiError, StripeApiErrorData } from '../errors/stripe-api.error';
import { log } from '../libs/logger';

export const stripeApi = (): Stripe => {
  return new Stripe(getConfig().stripeSecretKey);
}

export const wrapStripeError = (e: any): Error => {
  if (e?.raw) {
    const errorData = JSON.parse(JSON.stringify(e.raw)) as StripeApiErrorData;
    return new StripeApiError(errorData, { cause: e });
  }

  log.error('Unexpected error calling Stripe API:', e);
  return e;
};