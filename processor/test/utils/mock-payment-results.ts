import Stripe from 'stripe';
import { Payment, Transaction } from '@commercetools/connect-payments-sdk';
import { PaymentAmount } from '@commercetools/connect-payments-sdk/dist/commercetools/types/payment.type';
import { PaymentProviderModificationResponse } from '../../src/services/types/operation.type';
import { PaymentModificationStatus } from '../../src/dtos/operations/payment-intents.dto';

const commonLastResponse = {
  headers: {},
  requestId: '11111',
  statusCode: 200,
  apiVersion: '',
  idempotencyKey: '',
  stripeAccount: '',
};

const commonMethodOptions = {
  card: {
    installments: null,
    mandate_options: null,
    network: null,
    request_three_d_secure: 'automatic',
  },
  link: {
    persistent_token: null,
  },
} as Stripe.PaymentIntent.PaymentMethodOptions;

const commonPaymentResult = {
  lastResponse: commonLastResponse,
  id: 'pi_create_3MtwBwLkdIwHu7ix28a3tqPa',
  object: 'payment_intent',
  amount: 2000,
  amount_capturable: 0,
  amount_details: {
    tip: {},
  },
  amount_received: 0,
  application: null,
  application_fee_amount: null,
  automatic_payment_methods: {
    enabled: true,
  },
  canceled_at: null,
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
  payment_method: 'mock_payment_method',
  payment_method_options: commonMethodOptions,
  payment_method_types: ['card', 'link'],
  processing: null,
  receipt_email: null,
  review: null,
  setup_future_usage: null,
  shipping: null,
  source: null,
  statement_descriptor: null,
  statement_descriptor_suffix: null,
  status: 'requires_payment_method',
  transfer_data: null,
  transfer_group: null,
  payment_method_configuration_details: null,
} as Stripe.Response<Stripe.PaymentIntent>;

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
  lastResponse: commonLastResponse,
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
      type: 'refund',
    },
    type: 'card',
  },
  metadata: {},
  payment_intent: 'pi_11111',
  reason: null,
  receipt_number: null,
  source_transfer_reversal: null,
  status: 'succeeded',
  transfer_reversal: null,
};

export const mockStripeCancelPaymentResult: Stripe.Response<Stripe.PaymentIntent> = {
  lastResponse: commonLastResponse,
  id: 'pi_3MtwBwLkdIwHu7ix28a3tqPa',
  object: 'payment_intent',
  amount: 2000,
  amount_capturable: 0,
  amount_details: {
    tip: {},
  },
  amount_received: 0,
  application: null,
  application_fee_amount: null,
  automatic_payment_methods: {
    enabled: true,
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
  payment_method_options: commonMethodOptions,
  payment_method_types: ['card', 'link'],
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
  transfer_group: null,
};

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
      server: 'nginx',
    },
    statusCode: 404,
    requestId: 'req_11111',
  },
  rawType: 'invalid_request_error',
  code: 'resource_missing',
  doc_url: 'https://stripe.com/docs/error-codes/resource-missing',
  param: 'intent',
  headers: {
    server: 'nginx',
  },
  requestId: 'req_11111',
  statusCode: 404,
};

export const mockStripeRetrievePaymentResult: Stripe.Response<Stripe.PaymentIntent> = {
  lastResponse: commonLastResponse,
  id: 'pi_retrieve_3MtwBwLkdIwHu7ix28a3tqPa',
  object: 'payment_intent',
  amount: 2000,
  amount_capturable: 0,
  amount_details: {
    tip: {},
  },
  amount_received: 0,
  application: null,
  application_fee_amount: null,
  automatic_payment_methods: {
    enabled: true,
  },
  canceled_at: null,
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
  metadata: {
    paymentId: 'asdf-1234',
  },
  next_action: null,
  on_behalf_of: null,
  payment_method: null,
  payment_method_options: commonMethodOptions,
  payment_method_types: ['card', 'link'],
  processing: null,
  receipt_email: null,
  review: null,
  setup_future_usage: null,
  shipping: null,
  source: null,
  statement_descriptor: null,
  statement_descriptor_suffix: null,
  status: 'requires_payment_method',
  transfer_data: null,
  transfer_group: null,
  payment_method_configuration_details: null,
};

export const mockStripeCreatePaymentResult: Stripe.Response<Stripe.PaymentIntent> = commonPaymentResult;

export const mockStripeUpdatePaymentResult: Stripe.Response<Stripe.PaymentIntent> = commonPaymentResult;

export const mockGetPaymentAmount: PaymentAmount = {
  centAmount: 150000,
  currencyCode: 'USD',
};

export const mockStripePaymentMethodsList: Stripe.ApiList<Stripe.PaymentMethod> = {
  object: 'list',
  url: '/v1/payment_methods',
  has_more: false,
  data: [
    {
      id: 'pm_1NO6mA2eZvKYlo2CEydeHsKT',
      object: 'payment_method',
      billing_details: {
        address: {
          city: null,
          country: null,
          line1: null,
          line2: null,
          postal_code: null,
          state: null,
        },
        email: null,
        name: null,
        phone: null,
      },
      card: {
        brand: 'visa',
        checks: {
          address_line1_check: null,
          address_postal_code_check: null,
          cvc_check: 'unchecked',
        },
        country: 'US',
        exp_month: 8,
        exp_year: 2024,
        fingerprint: 'Xt5EWLLDS7FJjR1c',
        funding: 'credit',
        generated_from: null,
        last4: '4242',
        networks: {
          available: ['visa'],
          preferred: null,
        },
        three_d_secure_usage: {
          supported: true,
        },
        wallet: null,
      } as Stripe.PaymentMethod.Card,
      created: 1687991030,
      customer: 'cus_9s6XKzkNRiz8i3',
      livemode: false,
      metadata: {},
      type: 'card',
    },
  ],
};

export const mockStripeCapturePaymentResult: Stripe.Response<Stripe.PaymentIntent> = {
  lastResponse: commonLastResponse,
  id: 'pi_11111',
  object: 'payment_intent',
  amount: 112300,
  amount_capturable: 0,
  amount_details: {
    tip: {},
  },
  amount_received: 112300,
  application: null,
  application_fee_amount: null,
  automatic_payment_methods: null,
  canceled_at: null,
  cancellation_reason: null,
  capture_method: 'manual',
  client_secret: 'pi_11111_secret_11111',
  confirmation_method: 'automatic',
  created: 1719342275,
  currency: 'mxn',
  customer: null,
  description: 'Sport shoes',
  invoice: null,
  last_payment_error: null,
  latest_charge: 'ch_11111',
  livemode: false,
  metadata: {},
  next_action: null,
  on_behalf_of: null,
  payment_method: 'pm_11111',
  payment_method_configuration_details: null,
  payment_method_options: {
    card: {
      installments: null,
      mandate_options: null,
      network: null,
      request_three_d_secure: 'automatic',
    },
  },
  payment_method_types: ['card'],
  processing: null,
  receipt_email: null,
  review: null,
  setup_future_usage: null,
  shipping: null,
  source: null,
  statement_descriptor: 'aaaaaaa',
  statement_descriptor_suffix: null,
  status: 'succeeded',
  transfer_data: null,
  transfer_group: null,
};

export const mockCapturePaymentResult: PaymentProviderModificationResponse = {
  outcome: PaymentModificationStatus.APPROVED,
  pspReference: 'mockPspReference',
};
