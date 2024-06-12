import { log } from '../libs/logger/index';
import { stripeApi } from '../clients/stripe.client';

export async function createStripeWebhook(applicationUrl: string): Promise<void> {
  log.info(`Starting the process to create Stripe Webhook for this application[${applicationUrl}].`);

  try {
    await stripeApi().webhookEndpoints.create({
      enabled_events: [
        'payment_intent.payment_failed',
        'payment_intent.succeeded',
        'payment_intent.amount_capturable_updated',
        'charge.refunded',
        'payment_intent.canceled',
      ],
      url: `${applicationUrl}stripe/webhooks`,
    });
  } catch (error) {
    log.error('[REGISTER_STRIPE_WEBHOOK]', error);
  }
}

export async function deleteStripeWebhook(): Promise<void> {
  log.info(`Starting the process to delete Stripe Webhook[${process.env.STRIPE_WEBHOOK_ID}] of this application.`);

  try {
    const webhookId = process.env.STRIPE_WEBHOOK_ID || '';
    await stripeApi().webhookEndpoints.del(webhookId);
  } catch (error) {
    log.error('[DELETE_STRIPE_WEBHOOK]', error);
  }
}