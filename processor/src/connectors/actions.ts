import { launchpadPurchaseOrderCustomType } from '../custom-types/custom-types';
import { log } from '../libs/logger';
import { paymentSDK } from '../payment-sdk';
import Stripe from 'stripe';
import { stripeApi } from '../clients/stripe.client';

export async function createLaunchpadPurchaseOrderNumberCustomType(): Promise<void> {
  const apiClient = paymentSDK.ctAPI.client;

  const getRes = await apiClient
    .types()
    .get({
      queryArgs: {
        where: `key="${launchpadPurchaseOrderCustomType.key}"`,
      },
    })
    .execute();

  if (getRes.body.results.length) {
    log.info('Launchpad purchase order number custom type already exists. Skipping creation.');
    return;
  }
}

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
      enabled_events: [
        'charge.succeeded',
        'charge.captured',
        'payment_intent.succeeded',
        'charge.refunded',
        'payment_intent.canceled',
        'payment_intent.payment_failed',
        'payment_intent.requires_action',
      ],
      url: weAppUrl,
    });
  } catch (error: any) {
    log.error('[UPDATE_WEBHOOK_ENDPOINT]', error);
    throw new Error(error);
  }
}
