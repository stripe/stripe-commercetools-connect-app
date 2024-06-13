import Stripe from 'stripe';
import { log } from '../libs/logger/index';
import { stripeApi } from '../clients/stripe.client';

export async function createStripeWebhook(applicationUrl: string): Promise<void> {
  log.info(`Starting the process for creating Stripe Webhook for this application[${applicationUrl}].`);

  try {
    const result: Stripe.WebhookEndpoint = await stripeApi().webhookEndpoints.create({
      enabled_events: [
        'charge.succeeded',
        'charge.refunded',
        'payment_intent.canceled',
        'payment_intent.succeeded',
        'payment_intent.payment_failed',
        'payment_intent.requires_action',
      ],
      url: `${applicationUrl}stripe/webhooks`,
    });

    log.info(`[CREATE_STRIPE_WEBHOOK] Stripe webhook endpoint created: ${result.id}`);
  } catch (error) {
    log.error('[CREATE_STRIPE_WEBHOOK]', error);
  }
}

export async function deleteStripeWebhook(): Promise<void> {
  log.info(
    `[DELETE_STRIPE_WEBHOOK] Starting the process for deleting Stripe Webhook[${process.env.STRIPE_WEBHOOK_ID}] of this application.`,
  );

  try {
    const webhookId = process.env.STRIPE_WEBHOOK_ID || '';
    await stripeApi().webhookEndpoints.del(webhookId);
  } catch (error) {
    log.error('[DELETE_STRIPE_WEBHOOK]', error);
  }
}