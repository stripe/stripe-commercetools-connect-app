import Stripe from 'stripe';
import {
  Type,
  TypeAddFieldDefinitionAction,
  TypeDraft,
} from '@commercetools/platform-sdk/dist/declarations/src/generated/models/type';
import {
  CustomerSetCustomFieldAction,
  CustomerSetCustomTypeAction,
  Product,
  ProductType,
} from '@commercetools/platform-sdk';
import { mockStripeCustomerId } from './mock-customer-data';

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

export const mock_CustomType_withManyFieldDefinition: Type = {
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
    {
      name: 'stripeConnector_stripeTest',
      label: {
        en: 'Stripe Test',
      },
      required: false,
      type: {
        name: 'String',
      },
      inputHint: 'SingleLine',
    },
  ],
};

export const mock_CustomType_withDifferentFieldDefinition: Type = {
  id: 'mock-type-id',
  version: 1,
  createdAt: '2023-01-01T00:00:00.000Z',
  lastModifiedAt: '2023-01-01T00:00:00.000Z',
  key: 'payment-connector-stripe-customer-id-different',
  name: {
    en: 'Stripe Customer ID',
  },
  description: {
    en: 'Stores the Stripe Customer ID on a commercetools customer',
  },
  resourceTypeIds: ['customer'],
  fieldDefinitions: [
    {
      name: 'stripeConnector_stripeTest',
      label: {
        en: 'Stripe Test',
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

export const mock_SetCustomTypeActions: CustomerSetCustomTypeAction[] = [
  {
    action: 'setCustomType',
    type: {
      typeId: 'type',
      key: 'payment-connector-stripe-customer-id',
    },
    fields: {
      stripeConnector_stripeCustomerId: mockStripeCustomerId,
    },
  },
];

export const mock_SetCustomFieldActions: CustomerSetCustomFieldAction[] = [
  {
    action: 'setCustomField',
    name: 'stripeConnector_stripeCustomerId',
    value: mockStripeCustomerId,
  },
];

export const mock_AddFieldDefinitionActions: TypeAddFieldDefinitionAction[] = [
  {
    action: 'addFieldDefinition',
    fieldDefinition: mock_CustomType_withFieldDefinition.fieldDefinitions[0],
  },
];

export const mock_ProductType: ProductType = {
  id: 'mock-product-type-id',
  version: 1,
  name: 'Mock Product Type',
  key: 'mock',
  description: 'Mock description',
  attributes: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  lastModifiedAt: '2025-01-01T00:00:00.000Z',
};

export const mock_Product = {
  id: 'mock-product-id',
  key: 'subscription-test',
  version: 32,
  createdAt: '2025-03-31T22:18:38.763Z',
  lastModifiedAt: '2025-04-21T17:22:40.009Z',
  productType: {
    typeId: 'product-type',
    id: 'mock-product-type-id',
  },
  masterData: {},
} as Product;
