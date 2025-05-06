import { TypeDraft } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/type';
import { ProductTypeDraft } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/product-type';

export const launchpadPurchaseOrderCustomType = {
  key: 'payment-launchpad-purchase-order',
  purchaseOrderNumber: 'launchpadPurchaseOrderNumber',
  invoiceMemo: 'launchpadPurchaseOrderInvoiceMemo',
};

export const stripeCustomerIdFieldName = 'stripeConnector_stripeCustomerId';

export const stripeCustomerIdCustomType: TypeDraft = {
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
      type: {
        name: 'String',
      },
      name: stripeCustomerIdFieldName,
      label: {
        en: 'Stripe Customer ID',
      },
      required: false,
      inputHint: 'SingleLine',
    },
  ],
};

export const typeLineItem: TypeDraft = {
  key: 'payment-connector-subscription-line-item-type',
  name: {
    'en-US': 'Subscription Line Item Type',
  },
  description: {
    'en-US': 'Product Type for subscription items',
  },
  resourceTypeIds: ['line-item'],
  fieldDefinitions: [
    {
      type: {
        name: 'String',
      },
      name: 'stripeConnector_productSubscriptionId',
      label: {
        'en-US': 'Product Subscription ID',
      },
      required: true,
    },
    {
      type: {
        name: 'String',
      },
      name: 'stripeConnector_stripeSubscriptionId',
      label: {
        'en-US': 'Stripe Subscription ID',
      },
      required: false,
    },
    {
      type: {
        name: 'String',
      },
      name: 'stripeConnector_stripeSubscriptionError',
      label: {
        'en-US': 'Stripe Subscription Error',
      },
      required: false,
    },
  ],
};

export const productTypeSubscription: ProductTypeDraft = {
  name: 'subscription-information',
  key: 'subscription-information',
  description: 'The subscription-information product type.',
  attributes: [
    {
      name: 'billing_cycle_anchor',
      label: {
        'en-US': 'Billing Cycle Anchor',
      },
      type: {
        name: 'number',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
    },
    {
      name: 'cancel_at',
      label: {
        'en-US': 'Cancel At',
      },
      isRequired: false,
      type: {
        name: 'number',
      },
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
    },
    {
      name: 'cancel_at_period_end',
      label: {
        'en-US': 'Cancel At Period End',
      },
      isRequired: false,
      type: {
        name: 'boolean',
      },
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
    },
    {
      name: 'days_until_due',
      label: {
        'en-US': 'Days Until Due',
      },
      isRequired: false,
      type: {
        name: 'number',
      },
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
    },
    {
      name: 'description',
      label: {
        'en-US': 'Description',
      },
      isRequired: false,
      type: {
        name: 'text',
      },
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
    },
    {
      name: 'off_session',
      label: {
        'en-US': 'Off Session',
      },
      isRequired: true,
      type: {
        name: 'boolean',
      },
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
    },
    {
      name: 'trial_end',
      label: {
        'en-US': 'Trial End',
      },
      isRequired: false,
      type: {
        name: 'number',
      },
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
    },
    {
      name: 'trial_period_days',
      label: {
        'en-US': 'Trial Period Days',
      },
      isRequired: false,
      type: {
        name: 'number',
      },
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
    },
    {
      name: 'collection_method',
      label: {
        'en-US': 'collection method',
      },
      isRequired: true,
      type: {
        name: 'enum',
        values: [
          {
            key: 'charge_automatically',
            label: 'charge_automatically',
          },
          {
            key: 'send_invoice',
            label: 'send_invoice',
          },
        ],
      },
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
    },
    {
      name: 'proration_behavior',
      label: {
        'en-US': 'proration_behavior',
      },
      isRequired: false,
      type: {
        name: 'enum',
        values: [
          {
            key: 'none',
            label: 'none',
          },
          {
            key: 'create_prorations',
            label: 'create_prorations',
          },
          {
            key: 'always_invoice',
            label: 'always_invoice',
          },
        ],
      },
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
    },
    {
      name: 'missing_payment_method_at_trial_end',
      label: {
        'en-US': 'missing_payment_method',
      },
      isRequired: false,
      type: {
        name: 'enum',
        values: [
          {
            key: 'cancel',
            label: 'cancel',
          },
          {
            key: 'create_invoice',
            label: 'create_invoice',
          },
          {
            key: 'pause',
            label: 'pause',
          },
        ],
      },
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
    },
    {
      name: 'payment_behavior',
      label: {
        'en-US': 'payment_behavior',
      },
      isRequired: true,
      type: {
        name: 'enum',
        values: [
          {
            key: 'default_incomplete',
            label: 'default_incomplete',
          },
          {
            key: 'allow_incomplete',
            label: 'allow_incomplete',
          },
          {
            key: 'error_if_incomplete',
            label: 'error_if_incomplete',
          },
          {
            key: 'pending_if_incomplete',
            label: 'pending_if_incomplete',
          },
        ],
      },
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
    },
    {
      name: 'recurring_interval',
      label: {
        'en-US': 'recurring_interval',
      },
      isRequired: true,
      type: {
        name: 'enum',
        values: [
          {
            key: 'day',
            label: 'day',
          },
          {
            key: 'week',
            label: 'week',
          },
          {
            key: 'month',
            label: 'month',
          },
          {
            key: 'year',
            label: 'year',
          },
        ],
      },
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
    },
    {
      name: 'recurring_interval_count',
      label: {
        'en-US': 'recurring_interval',
      },
      isRequired: true,
      type: {
        name: 'number',
      },
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
    },
  ],
};
