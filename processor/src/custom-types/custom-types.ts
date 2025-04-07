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
