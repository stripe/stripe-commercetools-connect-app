import Stripe from 'stripe';
import { Type, TypeDraft } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/type';

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

export const mock_CustomType_withFieldDefinition: Type = {
  id: 'mock-type-id',
  version: 1,
  createdAt: '2023-01-01T00:00:00.000Z',
  lastModifiedAt: '2023-01-01T00:00:00.000Z',
  key: 'payment-connector-stripe-customer-id',
  name: {
    en: 'Stripe Customer ID',
  },
  description: {
    en: 'Stores the Stripe Customer ID on a commercetools customer',
  },
  resourceTypeIds: ['customer'],
  fieldDefinitions: [
    {
      name: 'stripeConnector_stripeCustomerId',
      label: {
        en: 'Stripe Customer ID',
      },
      required: false,
      type: {
        name: 'String',
      },
      inputHint: 'SingleLine',
    },
  ],
};

export const mock_CustomType_withNoFieldDefinition: Type = {
  id: 'mock-type-id',
  version: 1,
  createdAt: '2023-01-01T00:00:00.000Z',
  lastModifiedAt: '2023-01-01T00:00:00.000Z',
  key: 'payment-connector-stripe-customer-id',
  name: {
    en: 'Stripe Customer ID',
  },
  description: {
    en: 'Stores the Stripe Customer ID on a commercetools customer',
  },
  resourceTypeIds: ['customer'],
  fieldDefinitions: [],
};

export const mock_CustomTypeDraft: TypeDraft = {
  key: 'payment-connector-stripe-customer-id',
  name: {
    en: 'Stripe Customer ID',
  },
  description: {
    en: 'Stores the Stripe Customer ID on a commercetools customer',
  },
  resourceTypeIds: ['customer'],
  fieldDefinitions: [
    {
      name: 'stripeConnector_stripeCustomerId',
      label: {
        en: 'Stripe Customer ID',
      },
      required: false,
      type: {
        name: 'String',
      },
      inputHint: 'SingleLine',
    },
  ],
};

//mock the get types for fot launchpad purchase order number
export const mock_CustomType_withLaunchpadPurchaseOrderNumber: Type = {
  id: 'mock-type-id',
  key: 'payment-launchpad-purchase-order',
  version: 1,
  name: {
    en: 'Mock Launchpad Purchase Order Number Custom Type',
  },
  description: {
    en: 'Mock description for the custom type.',
  },
  fieldDefinitions: [
    {
      name: 'mockField',
      label: {
        en: 'Mock Field',
      },
      type: {
        name: 'String',
      },
      required: false,
    },
  ],
  createdAt: '2023-01-01T00:00:00.000Z',
  lastModifiedAt: '2023-01-01T00:00:00.000Z',
  resourceTypeIds: ['customer'],
};
