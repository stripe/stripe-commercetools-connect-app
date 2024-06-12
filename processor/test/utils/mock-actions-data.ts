import Stripe from 'stripe';

export const mock__Stripe_createWebhookEndpoints_response: Stripe.Response<Stripe.WebhookEndpoint> = {
  id: 'we_11111',
  object: 'webhook_endpoint',
  api_version: null,
  application: null,
  created: 1718207841,
  description: null,
  enabled_events: [
    'payment_intent.payment_failed',
    'payment_intent.succeeded',
    'payment_intent.amount_capturable_updated',
    'charge.refunded',
    'payment_intent.canceled'
  ],
  livemode: false,
  metadata: {},
  secret: 'whsec_11111',
  status: 'enabled',
  url: 'https://host.com/stripe/webhooks',
  lastResponse: {
    headers: {},
    requestId: '11111',
    statusCode: 201,
  }
}

export const mock__Stripe_deleteWebhookEndpoints_response: Stripe.Response<Stripe.DeletedWebhookEndpoint> = {
  id: 'we_11111',
  object: 'webhook_endpoint',
  deleted: true,
  lastResponse: {
    headers: {},
    requestId: '11111',
    statusCode: 201,
  }
}