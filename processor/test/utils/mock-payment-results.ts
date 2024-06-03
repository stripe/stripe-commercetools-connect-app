import Stripe from 'stripe';
import { Payment, Transaction } from '@commercetools/connect-payments-sdk';
import { PaymentPagedQueryResponse } from '@commercetools/platform-sdk';

export const mockGetPaymentResult: Payment = {
  id: '123456',
  version: 1,
  amountPlanned: {
    type: 'centPrecision',
    currencyCode: 'GBP',
    centAmount: 120000,
    fractionDigits: 2,
  },
  interfaceId: '92C12661DS923781G',
  paymentMethodInfo: {
    method: 'Debit Card',
    name: { 'en-US': 'Debit Card', 'en-GB': 'Debit Card' },
  },
  paymentStatus: { interfaceText: 'Paid' },
  transactions: [],
  interfaceInteractions: [],
  createdAt: '2024-02-13T00:00:00.000Z',
  lastModifiedAt: '2024-02-13T00:00:00.000Z',
};

const mockCancelPaymentTransaction: Transaction = {
  id: 'dummy-transaction-id',
  timestamp: '2024-02-13T00:00:00.000Z',
  type: 'CancelAuthorization',
  amount: {
    type: 'centPrecision',
    centAmount: 120000,
    currencyCode: 'GBP',
    fractionDigits: 2,
  },
  state: 'Initial',
};

export const mockUpdatePaymentResult: Payment = {
  id: '123456',
  version: 1,
  amountPlanned: {
    type: 'centPrecision',
    currencyCode: 'GBP',
    centAmount: 120000,
    fractionDigits: 2,
  },
  interfaceId: '92C12661DS923781G',
  paymentMethodInfo: {
    method: 'Debit Card',
    name: { 'en-US': 'Debit Card', 'en-GB': 'Debit Card' },
  },
  paymentStatus: { interfaceText: 'Paid' },
  transactions: [mockCancelPaymentTransaction],
  interfaceInteractions: [],
  createdAt: '2024-02-13T00:00:00.000Z',
  lastModifiedAt: '2024-02-13T00:00:00.000Z',
};

export const mockStripeCreateRefundResult: Stripe.Response<Stripe.Refund> = {
  lastResponse: {
    headers: {},
    requestId: '11111',
    statusCode: 200,
    apiVersion: '',
    idempotencyKey: '',
    stripeAccount: '',
  },
  id: 're_11111',
  object: 'refund',
  amount: 1000,
  balance_transaction: 'txn_11111',
  charge: 'ch_11111',
  created: 1692942318,
  currency: 'usd',
  destination_details: {
    card: {
      reference: '123456789012',
      reference_status: 'available',
      reference_type: 'acquirer_reference_number',
      type: 'refund'
    },
    type: 'card'
  },
  metadata: {},
  payment_intent: 'pi_11111',
  reason: null,
  receipt_number: null,
  source_transfer_reversal: null,
  status: 'succeeded',
  transfer_reversal: null
};

export const mockStripeCancelPaymentResult: Stripe.Response<Stripe.PaymentIntent> = {
  lastResponse: {
    headers: {},
    requestId: '11111',
    statusCode: 200,
    apiVersion: '',
    idempotencyKey: '',
    stripeAccount: '',
  },
  id: 'pi_3MtwBwLkdIwHu7ix28a3tqPa',
  object: 'payment_intent',
  amount: 2000,
  amount_capturable: 0,
  amount_details: {
    tip: {}
  },
  amount_received: 0,
  application: null,
  application_fee_amount: null,
  automatic_payment_methods: {
    enabled: true
  },
  canceled_at: 1680801569,
  cancellation_reason: null,
  capture_method: 'automatic',
  client_secret: 'pi_3MtwBwLkdIwHu7ix28a3tqPa_secret_YrKJUKribcBjcG8HVhfZluoGH',
  confirmation_method: 'automatic',
  created: 1680800504,
  currency: 'usd',
  customer: null,
  description: null,
  invoice: null,
  last_payment_error: null,
  latest_charge: null,
  livemode: false,
  metadata: {},
  next_action: null,
  on_behalf_of: null,
  payment_method: null,
  payment_method_configuration_details: null,
  payment_method_options: {
    card: {
      installments: null,
      mandate_options: null,
      network: null,
      request_three_d_secure: 'automatic'
    },
    link: {
      persistent_token: null
    }
  },
  payment_method_types: [
    'card',
    'link'
  ],
  processing: null,
  receipt_email: null,
  review: null,
  setup_future_usage: null,
  shipping: null,
  source: null,
  statement_descriptor: null,
  statement_descriptor_suffix: null,
  status: 'canceled',
  transfer_data: null,
  transfer_group: null
}

export const mockCancelPaymentErrorResult = {
  type: 'StripeInvalidRequestError',
  raw: {
    code: 'resource_missing',
    doc_url: 'https://stripe.com/docs/error-codes/resource-missing',
    message: 'No such payment_intent: 07bd2613-8daf-4760-a5c4-21d6cca91276',
    param: 'intent',
    request_log_url: 'https://dashboard.stripe.com/test/logs/req_nW73HRiJPPfkok?t=1716572513',
    type: 'invalid_request_error',
    headers: {
      server: 'nginx'
    },
    statusCode: 404,
    requestId: 'req_11111'
  },
  rawType: 'invalid_request_error',
  code: 'resource_missing',
  doc_url: 'https://stripe.com/docs/error-codes/resource-missing',
  param: 'intent',
  headers: {
    server: 'nginx'
  },
  requestId: 'req_11111',
  statusCode: 404
}

export const mockCtPaymentByInterfaceId: PaymentPagedQueryResponse = {
  limit: 20,
  offset: 0,
  count: 1,
  total: 1,
  results: [
    {
      id: '11111',
      version: 5,
      createdAt: '2024-05-14T18:22:42.391Z',
      lastModifiedAt: '2024-05-30T15:45:26.746Z',
      lastModifiedBy: {
        clientId: 'aaaaa'
      },
      createdBy: {
        clientId: 'aaaaa'
      },
      interfaceId: '22222',
      amountPlanned: {
        type: 'centPrecision',
        currencyCode: 'USD',
        centAmount: 20000,
        fractionDigits: 2
      },
      paymentMethodInfo: {
        paymentInterface: 'mock',
        method: 'card'
      },
      paymentStatus: {},
      transactions: [
        {
          id: '11111',
          timestamp: '2024-05-14T18:22:42.748Z',
          type: 'Authorization',
          amount: {
            type: 'centPrecision',
            currencyCode: 'USD',
            centAmount: 20000,
            fractionDigits: 2
          },
          interactionId: '22222',
          state: 'Initial'
        }
      ],
      interfaceInteractions: []
    }
  ]
}

export const mockCtPaymentByInterfaceId_paymentNotFound: PaymentPagedQueryResponse = {
  limit: 20,
  offset: 0,
  count: 0,
  total: 0,
  results: []
}