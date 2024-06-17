import Stripe from 'stripe';
import { log } from '../libs/logger/index';
import { stripeApi } from '../clients/stripe.client';

export async function retrieveWebhookEndpoint(weId: string): Promise<Stripe.WebhookEndpoint> {
  log.info(`[RETRIEVE_WEBHOOK_ENDPOINT] Starting the process for retrieving webhook endpoint[${weId}].`);

  try {
    return await stripeApi().webhookEndpoints.retrieve(weId);
  } catch (error: any) {
    log.error('[RETRIEVE_WEBHOOK_ENDPOINT]', error);
    throw new Error(error);
  }
}

export async function updateWebhookEndpoint(weId: string, weAppUrl: string): Promise<void> {
  log.info(
    `[UPDATE_WEBHOOK_ENDPOINT] Starting the process for updating webhook endpoint[${weId}] with url[${weAppUrl}].`,
  );

  try {
    await stripeApi().webhookEndpoints.update(weId, {
      url: weAppUrl,
    });
  } catch (error: any) {
    log.error('[UPDATE_WEBHOOK_ENDPOINT]', error);
    throw new Error(error);
  }
}