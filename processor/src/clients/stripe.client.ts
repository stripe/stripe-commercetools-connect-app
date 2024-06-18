import Stripe from 'stripe';
import { getConfig } from '../config/config';
import { StripeApiError, StripeApiErrorData } from '../errors/stripe-api.error';
import { log } from '../libs/logger';

export const stripeApi = (): Stripe => {
  const properties = new Map(Object.entries(process.env));
  const appInfoUrl = properties.get('CONNECT_SERVICE_URL') ?? 'https://example.com';
  return new Stripe(getConfig().stripeSecretKey, {
    appInfo: {
      name: 'Stripe app for Commercetools Connect',
      version: '1.0.00',
      url: appInfoUrl, //need to be updated
      partner_id: 'pp_partner_c0mmercet00lsc0NNect', // Used by Stripe to identify your connector
    },
  });
};

export const wrapStripeError = (e: any): Error => {
  if (e?.raw) {
    const errorData = JSON.parse(JSON.stringify(e.raw)) as StripeApiErrorData;
    return new StripeApiError(errorData, { cause: e });
  }

  log.error('Unexpected error calling Stripe API:', e);
  return e;
};
