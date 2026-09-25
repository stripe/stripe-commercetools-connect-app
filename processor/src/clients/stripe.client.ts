import Stripe from 'stripe';
import { getConfig } from '../config/config';
import { StripeApiError, StripeApiErrorData } from '../errors/stripe-api.error';
import { log } from '../libs/logger';

export const stripeApi = (): Stripe => {
  const properties = new Map(Object.entries(process.env));
  const appInfoUrl = properties.get('CONNECT_SERVICE_URL') ?? 'https://example.com';
  return new Stripe(getConfig().stripeSecretKey, {
    apiVersion: getConfig().stripeApiVersion as Stripe.LatestApiVersion,
    appInfo: {
      name: 'Stripe app for Commercetools Connect',
      version: '1.0.00',
      url: appInfoUrl, //need to be updated
      partner_id: 'pp_partner_c0mmercet00lsc0NNect', // Used by Stripe to identify your connector
    },
  });
};

export const wrapStripeError = (e: unknown): Error => {
  const raw = (e as { raw?: unknown } | null | undefined)?.raw;
  if (raw) {
    const errorData = JSON.parse(JSON.stringify(raw)) as StripeApiErrorData;
    return new StripeApiError(errorData, { cause: e });
  }

  log.error('Unexpected error calling Stripe API:', e);
  // Behaviour preserved deliberately: a non-Stripe value is returned unchanged, as it always has been.
  // The signature has always claimed `Error` while this branch could hand back anything a `catch` caught,
  // so callers doing `throw wrapStripeError(e)` can still throw a non-Error. That is a real latent defect
  // and not this branch's to fix — changing it alters what propagates out of every Stripe call site.
  return e as Error;
};
