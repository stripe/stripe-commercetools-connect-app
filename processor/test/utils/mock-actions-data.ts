import Stripe from 'stripe';

export const mock_Stripe_retrieveWebhookEnpoints_response: Stripe.Response<Stripe.WebhookEndpoint> = {
  id: 'we_11111',
  object: 'webhook_endpoint',
  api_version: null,
  application: null,
  created: 1718392528,
  description: null,
  enabled_events: [
    'charge.succeeded',
    'charge.refunded',
    'payment_intent.canceled',
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'payment_intent.requires_action',
  ],
  livemode: false,
  metadata: {},
  status: 'enabled',
  url: 'https://myApp.com/stripe/webhooks',
  lastResponse: {
    headers: {},
    requestId: '11111',
    statusCode: 201,
  },
};

export const mock_Stripe_updateWebhookEnpoints_response: Stripe.Response<Stripe.WebhookEndpoint> = {
  id: 'we_11111',
  object: 'webhook_endpoint',
  api_version: null,
  application: null,
  created: 1718392528,
  description: null,
  enabled_events: [
    'charge.succeeded',
    'charge.refunded',
    'payment_intent.canceled',
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'payment_intent.requires_action',
  ],
  livemode: false,
  metadata: {},
  status: 'enabled',
  url: 'https://yourApp.com/stripe/webhooks',
  lastResponse: {
    headers: {},
    requestId: '11111',
    statusCode: 201,
  },
};
