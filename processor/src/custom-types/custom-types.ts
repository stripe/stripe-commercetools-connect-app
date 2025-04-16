import { TypeDraft } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/type';
import { ProductTypeDraft } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/product-type';
import { FieldDefinition } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/type';

export const launchpadPurchaseOrderCustomType = {
  key: 'payment-launchpad-purchase-order',
  purchaseOrderNumber: 'launchpadPurchaseOrderNumber',
  invoiceMemo: 'launchpadPurchaseOrderInvoiceMemo',
};

export const stripeCustomerIdCustomType = {
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
      name: 'stripeConnector_stripeCustomerId',
      label: {
        en: 'Stripe Customer ID',
      },
      required: false,
      inputHint: 'SingleLine',
    },
  ],
};

export const stripeCustomerIdField: FieldDefinition = stripeCustomerIdCustomType.fieldDefinitions[0] as FieldDefinition;

//TODO Type definition for the line item subscription (https://docs.commercetools.com/api/projects/types)
export const typeLineItem: TypeDraft = {
  key: 'line-item-subscription-type',
  name: {
    'en-US': 'Subscription Line Item Type',
    'en-CA': 'Subscription Line Item Type',
    'fr-CA': 'Subscription Line Item Type',
  },
  description: {
    'en-US': 'Type for subscription items',
    'en-CA': 'Type for subscription items',
    'fr-CA': 'Type for subscription items',
  },
  resourceTypeIds: ['line-item'],
  fieldDefinitions: [
    {
      type: {
        name: 'String',
      },
      name: 'product-subscription-id',
      label: {
        'en-US': 'Product Subscription ID',
        'en-CA': 'Product Subscription ID',
        'fr-CA': 'Product Subscription ID',
      },
      required: true,
    },
    {
      type: {
        name: 'String',
      },
      name: 'stripe-subscription-id',
      label: {
        'en-US': 'Stripe Subscription ID',
        'en-CA': 'Stripe Subscription ID',
        'fr-CA': 'Stripe Subscription ID',
      },
      required: false,
    },
    {
      type: {
        name: 'String',
      },
      name: 'stripe-subscription-error',
      label: {
        'en-US': 'Stripe Subscription Error',
        'en-CA': 'Stripe Subscription Error',
        'fr-CA': 'Stripe Subscription Error',
      },
      required: false,
    },
  ],
};

//TODO Subscription information product type for the subscription product variant (https://docs.stripe.com/api/subscriptions/create)
export const productTypeSubscription: ProductTypeDraft = {
  key: 'subscription-information',
  name: 'subscription-information',
  description: 'The subscription-information product type.',
  attributes: [
    {
      name: 'application_fee_percent',
      type: {
        name: 'number',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Application Fee Percent',
      },
    },
    {
      name: 'billing_cycle_anchor',
      type: {
        name: 'number',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Billing Cycle Anchor',
      },
    },
    /*{
      name: 'billing_thresholds',
      type: {
        name: 'object',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Billing Thresholds',
      },
    },*/
    {
      name: 'cancel_at',
      type: {
        name: 'number',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Cancel At',
      },
    },
    {
      name: 'cancel_at_period_end',
      type: {
        name: 'boolean',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Cancel At Period End',
      },
    },
    {
      name: 'collection_method',
      type: {
        name: 'text',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Collection Method',
      },
    },
    {
      name: 'coupon',
      type: {
        name: 'text',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Coupon',
      },
    },
    {
      name: 'days_until_due',
      type: {
        name: 'number',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Days Until Due',
      },
    },
    {
      name: 'default_payment_method',
      type: {
        name: 'text',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Default Payment Method',
      },
    },
    {
      name: 'default_source',
      type: {
        name: 'text',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Default Source',
      },
    } /*
    {
      name: 'default_tax_rates',
      type: {
        name: 'array',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Default Tax Rates',
      },
    },*/,
    {
      name: 'description',
      type: {
        name: 'text',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Description',
      },
    } /*
    {
      name: 'discounts',
      type: {
        name: 'array',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Discounts',
      },
    },
    {
      name: 'expand',
      type: {
        name: 'array',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Expand',
      },
    },
    {
      name: 'metadata',
      type: {
        name: 'object',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Metadata',
      },
    },*/,
    {
      name: 'off_session',
      type: {
        name: 'boolean',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Off Session',
      },
    },
    {
      name: 'payment_behavior',
      type: {
        name: 'text',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Payment Behavior',
      },
    } /*
    {
      name: 'payment_settings',
      type: {
        name: 'object',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Payment Settings',
      },
    },
    {
      name: 'pending_invoice_item_interval',
      type: {
        name: 'object',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Pending Invoice Item Interval',
      },
    },*/,
    {
      name: 'promotion_code',
      type: {
        name: 'text',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Promotion Code',
      },
    },
    {
      name: 'proration_behavior',
      type: {
        name: 'text',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Proration Behavior',
      },
    } /*
    {
      name: 'transfer_data',
      type: {
        name: 'object',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Transfer Data',
      },
    },*/,
    {
      name: 'trial_end',
      type: {
        name: 'number',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Trial End',
      },
    },
    {
      name: 'trial_from_plan',
      type: {
        name: 'boolean',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Trial From Plan',
      },
    },
    {
      name: 'trial_period_days',
      type: {
        name: 'number',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      label: {
        'en-US': 'Trial Period Days',
      },
    },
  ],
};
