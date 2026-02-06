import { TypeDraft } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/type';
import { ProductTypeDraft } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/product-type';

export const launchpadPurchaseOrderCustomType = {
  key: process.env.CT_CUSTOM_TYPE_LAUNCHPAD_PURCHASE_ORDER_KEY || 'payment-launchpad-purchase-order',
  purchaseOrderNumber: 'launchpadPurchaseOrderNumber',
  invoiceMemo: 'launchpadPurchaseOrderInvoiceMemo',
};

export const stripeCustomerIdFieldName = 'stripeConnector_stripeCustomerId';

export const stripeCustomerIdCustomType: TypeDraft = {
  key: process.env.CT_CUSTOM_TYPE_STRIPE_CUSTOMER_KEY || 'payment-connector-stripe-customer-id',
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

export const lineItemProductSubscriptionIdField = 'stripeConnector_productSubscriptionId';
export const lineItemStripeSubscriptionIdField = 'stripeConnector_stripeSubscriptionId';
export const lineItemStripeSubscriptionErrorField = 'stripeConnector_stripeSubscriptionError';

export const typeLineItem: TypeDraft = {
  key: process.env.CT_CUSTOM_TYPE_SUBSCRIPTION_LINE_ITEM_KEY || 'payment-connector-subscription-line-item-type',
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
      name: lineItemProductSubscriptionIdField,
      label: {
        'en-US': 'Product Subscription ID',
      },
      required: false,
    },
    {
      type: {
        name: 'String',
      },
      name: lineItemStripeSubscriptionIdField,
      label: {
        'en-US': 'Stripe Subscription ID',
      },
      required: false,
    },
    {
      type: {
        name: 'String',
      },
      name: lineItemStripeSubscriptionErrorField,
      label: {
        'en-US': 'Stripe Subscription Error',
      },
      required: false,
    },
  ],
};

export const productTypeSubscription: ProductTypeDraft = {
  name: 'payment-connector-subscription-information',
  key: process.env.CT_PRODUCT_TYPE_SUBSCRIPTION_KEY || 'payment-connector-subscription-information',
  description: 'The subscription-information product type.',
  attributes: [
    {
      name: 'stripeConnector_description',
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
      name: 'stripeConnector_recurring_interval',
      label: {
        'en-US': 'Recurring Interval',
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
      name: 'stripeConnector_recurring_interval_count',
      label: {
        'en-US': 'Recurring Interval Count',
      },
      isRequired: true,
      type: {
        name: 'number',
      },
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
    },
    {
      name: 'stripeConnector_off_session',
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
      name: 'stripeConnector_collection_method',
      label: {
        'en-US': 'Collection Method',
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
      name: 'stripeConnector_days_until_due',
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
      inputTip: {
        'en-US':
          "Number of days a customer has to pay invoices generated by this subscription. Only applies when collection method is assigned as 'send_invoice'.",
      },
    },
    {
      name: 'stripeConnector_cancel_at_period_end',
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
      name: 'stripeConnector_cancel_at',
      label: {
        'en-US': 'Cancel At',
      },
      isRequired: false,
      type: {
        name: 'datetime',
      },
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
      inputTip: {
        'en-US': 'Date and Time when the subscription should be canceled. (Displayed as Local Date Time)',
      },
    },
    {
      name: 'stripeConnector_billing_cycle_anchor_day',
      label: {
        'en-US': 'Billing Cycle Anchor Day',
      },
      type: {
        name: 'number',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
      inputTip: {
        'en-US':
          'The day of the month when the billing cycle should start. If a specific date time is needed, use the Billing Cycle Date field instead.',
      },
    },
    {
      name: 'stripeConnector_billing_cycle_anchor_time',
      label: {
        'en-US': 'Billing Cycle Anchor Time',
      },
      inputTip: {
        'en-US':
          'UTC Time of day to indicate when the billing cycle should start, this value works together with the Billing Cycle Anchor Day. If a specific date time is needed use the Billing Cycle Date field instead.',
      },
      type: {
        name: 'time',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
    },
    {
      name: 'stripeConnector_billing_cycle_anchor_date',
      label: {
        'en-US': 'Billing Cycle Anchor Date',
      },
      type: {
        name: 'datetime',
      },
      isRequired: false,
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
      inputTip: {
        'en-US': 'The exact date and time when the billing cycle should start. (Displayed as Local Date Time)',
      },
    },
    {
      name: 'stripeConnector_trial_period_days',
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
      inputTip: {
        'en-US': 'Amount of days the trial days will last, or define a date and time in the Trial End Date field.',
      },
    },
    {
      name: 'stripeConnector_trial_end_date',
      label: {
        'en-US': 'Trial End Date',
      },
      isRequired: false,
      type: {
        name: 'datetime',
      },
      attributeConstraint: 'None',
      isSearchable: false,
      inputHint: 'SingleLine',
      inputTip: {
        'en-US':
          'Date and Time when trial should end (Displayed as Local Date Time), or define the amount of days in the Trial Period Days field.',
      },
    },
    {
      name: 'stripeConnector_missing_payment_method_at_trial_end',
      label: {
        'en-US': 'Missing Payment Method Behavior at Trial End',
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
      inputTip: {
        'en-US': 'Defines how the subscription should behave when the user’s free trial ends.',
      },
    },
    {
      name: 'stripeConnector_proration_behavior',
      label: {
        'en-US': 'Proration Behavior',
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
  ],
};
