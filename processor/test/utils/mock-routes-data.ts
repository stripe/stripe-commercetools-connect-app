import Stripe from 'stripe';
import {
  CollectBillingAddressOptions,
  ConfigElementResponseSchemaDTO,
  CustomerResponseSchemaDTO,
  PaymentResponseSchemaDTO,
} from '../../src/dtos/stripe-payment.dto';
import { SupportedPaymentComponentsSchemaDTO } from '../../src/dtos/operations/payment-componets.dto';
import {
  PaymentIntentResponseSchemaDTO,
  PaymentModificationStatus,
} from '../../src/dtos/operations/payment-intents.dto';
import { ModifyPayment } from '../../src/services/types/operation.type';

const commonData = {
  object: {
    id: 'pi_11111',
    object: 'payment_intent',
    amount: 12300,
    amount_capturable: 12300,
    amount_details: {
      tip: {},
    },
    amount_received: 0,
    application: null,
    application_fee_amount: null,
    automatic_payment_methods: null,
    canceled_at: null,
    cancellation_reason: null,
    capture_method: 'manual',
    client_secret: 'pi_22222',
    confirmation_method: 'automatic',
    created: 1717093717,
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
    statement_descriptor: 'Payment',
    statement_descriptor_suffix: null,
    status: 'requires_capture',
    transfer_data: null,
    transfer_group: null,
  },
} as Stripe.PaymentIntentProcessingEvent.Data;

const commonPaymentMethodDetails = {
  card: {
    amount_authorized: 123100,
    brand: 'visa',
    capture_before: 1718911059,
    checks: {
      address_line1_check: null,
      address_postal_code_check: 'pass',
      cvc_check: 'pass',
    },
    country: 'US',
    exp_month: 12,
    exp_year: 2025,
    extended_authorization: {
      status: 'disabled',
    },
    fingerprint: '11111',
    funding: 'credit',
    incremental_authorization: {
      status: 'unavailable',
    },
    installments: null,
    last4: '1111',
    mandate: null,
    multicapture: {
      status: 'unavailable',
    },
    network: 'visa',
    network_token: {
      used: false,
    },
    overcapture: {
      maximum_amount_capturable: 123100,
      status: 'unavailable',
    },
    three_d_secure: null,
    wallet: null,
  },
  type: 'card',
} as Stripe.Charge.PaymentMethodDetails;

const commonBillingDetails = {
  address: {
    city: null,
    country: null,
    line1: null,
    line2: null,
    postal_code: '12312',
    state: null,
  },
  email: null,
  name: null,
  phone: null,
} as Stripe.Charge.BillingDetails;

export const mockEvent__paymentIntent_processing: Stripe.Event = {
  id: 'evt_00000000000',
  object: 'event',
  api_version: '2024-04-10',
  created: 1717093717,
  data: commonData,
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: 'req_11111',
    idempotency_key: '11111',
  },
  type: 'payment_intent.processing',
};

const commonPaymentMethodDetails2 = {
  card: {
    amount_authorized: 34500,
    brand: 'visa',
    checks: {
      address_line1_check: null,
      address_postal_code_check: 'pass',
      cvc_check: 'pass',
    },
    country: 'US',
    exp_month: 12,
    exp_year: 2026,
    extended_authorization: {
      status: 'disabled',
    },
    fingerprint: '12345',
    funding: 'credit',
    incremental_authorization: {
      status: 'unavailable',
    },
    installments: null,
    last4: '1111',
    mandate: null,
    multicapture: {
      status: 'unavailable',
    },
    network: 'visa',
    network_token: {
      used: false,
    },
    overcapture: {
      maximum_amount_capturable: 34500,
      status: 'unavailable',
    },
    three_d_secure: null,
    wallet: null,
  },
  type: 'card',
} as Stripe.Charge.PaymentMethodDetails;

export const mockEvent__paymentIntent_paymentFailed: Stripe.Event = {
  id: 'evt_11111',
  object: 'event',
  api_version: '2024-04-10',
  created: 1717093717,
  data: commonData,
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: 'req_11111',
    idempotency_key: '11111',
  },
  type: 'payment_intent.payment_failed',
};

export const mockEvent__paymentIntent_succeeded_captureMethodManual: Stripe.Event = {
  id: 'evt_11111',
  object: 'event',
  api_version: '2024-04-10',
  created: 1717692258,
  data: {
    object: {
      id: 'pi_11111',
      object: 'payment_intent',
      amount: 13200,
      amount_capturable: 0,
      amount_details: {
        tip: {},
      },
      amount_received: 13200,
      application: null,
      application_fee_amount: null,
      automatic_payment_methods: null,
      canceled_at: null,
      cancellation_reason: null,
      capture_method: 'manual',
      client_secret: 'pi_11111',
      confirmation_method: 'automatic',
      created: 1717452163,
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
      statement_descriptor: 'Payment',
      statement_descriptor_suffix: null,
      status: 'succeeded',
      transfer_data: null,
      transfer_group: null,
    },
  },
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: 'req_11111',
    idempotency_key: '11111-ABCDE',
  },
  type: 'payment_intent.succeeded',
};

export const mockEvent__paymentIntent_succeeded_captureMethodAutomatic: Stripe.Event = {
  id: 'evt_11111',
  object: 'event',
  api_version: '2024-04-10',
  created: 1717692258,
  data: {
    object: {
      id: 'pi_11111',
      object: 'payment_intent',
      amount: 13200,
      amount_capturable: 0,
      amount_details: {
        tip: {},
      },
      amount_received: 13200,
      application: null,
      application_fee_amount: null,
      automatic_payment_methods: null,
      canceled_at: null,
      cancellation_reason: null,
      capture_method: 'automatic',
      client_secret: 'pi_11111',
      confirmation_method: 'automatic',
      created: 1717452163,
      currency: 'mxn',
      customer: null,
      description: 'Sport shoes',
      invoice: null,
      last_payment_error: null,
      latest_charge: 'ch_11111',
      livemode: false,
      metadata: {
        ct_payment_id: 'pi_11111',
      },
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
      statement_descriptor: 'Payment',
      statement_descriptor_suffix: null,
      status: 'succeeded',
      transfer_data: null,
      transfer_group: null,
    },
  },
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: 'req_11111',
    idempotency_key: '11111-ABCDE',
  },
  type: 'payment_intent.succeeded',
};

export const mockEvent__paymentIntent_processing_crypto: Stripe.Event = {
  id: 'evt_11111',
  object: 'event',
  api_version: '2024-04-10',
  created: 1717692258,
  data: {
    object: {
      id: 'pi_11111',
      object: 'payment_intent',
      amount: 13200,
      amount_capturable: 0,
      amount_details: {
        tip: {},
      },
      amount_received: 0,
      application: null,
      application_fee_amount: null,
      automatic_payment_methods: null,
      canceled_at: null,
      cancellation_reason: null,
      capture_method: 'automatic',
      client_secret: 'pi_11111',
      confirmation_method: 'automatic',
      created: 1717452163,
      currency: 'mxn',
      customer: null,
      description: 'Sport shoes',
      invoice: null,
      last_payment_error: null,
      latest_charge: null,
      livemode: false,
      metadata: {
        ct_payment_id: 'pi_11111',
      },
      next_action: null,
      on_behalf_of: null,
      payment_method: 'pm_11111',
      payment_method_configuration_details: null,
      payment_method_options: {},
      payment_method_types: ['card', 'crypto'],
      processing: null,
      receipt_email: null,
      review: null,
      setup_future_usage: null,
      shipping: null,
      source: null,
      statement_descriptor: 'Payment',
      statement_descriptor_suffix: null,
      status: 'processing',
      transfer_data: null,
      transfer_group: null,
    },
  },
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: 'req_11111',
    idempotency_key: '11111-ABCDE',
  },
  type: 'payment_intent.processing',
};

export const mockEvent__charge_refund_captured: Stripe.Event = {
  id: 'evt_11111',
  object: 'event',
  api_version: '2024-04-10',
  created: 1717531265,
  data: {
    object: {
      id: 'ch_11111',
      object: 'charge',
      amount: 34500,
      amount_captured: 34500,
      amount_refunded: 34500,
      application: null,
      application_fee: null,
      application_fee_amount: null,
      balance_transaction: 'txn_11111',
      billing_details: commonBillingDetails,
      calculated_statement_descriptor: 'ABCDE',
      captured: true,
      created: 1717529587,
      currency: 'mxn',
      customer: null,
      description: 'Sport shoes',
      disputed: false,
      failure_balance_transaction: null,
      failure_code: null,
      failure_message: null,
      fraud_details: {},
      invoice: null,
      livemode: false,
      metadata: {
        ct_payment_id: 'pi_11111',
      },
      on_behalf_of: null,
      outcome: {
        network_status: 'approved_by_network',
        reason: null,
        risk_level: 'normal',
        risk_score: 8,
        seller_message: 'Payment complete.',
        type: 'authorized',
        advice_code: 'try_again_later',
        network_advice_code: 'mock_advice_code',
        network_decline_code: 'mock_decline_code',
      },
      paid: true,
      payment_intent: 'pi_11111',
      payment_method: 'pm_11111',
      payment_method_details: commonPaymentMethodDetails2,
      radar_options: {},
      receipt_email: null,
      receipt_number: null,
      receipt_url: 'https://pay.stripe.com/receipts/payment/ABCDE',
      refunded: true,
      review: null,
      shipping: null,
      source: null,
      source_transfer: null,
      statement_descriptor: 'ABCDE',
      statement_descriptor_suffix: null,
      status: 'succeeded',
      transfer_data: null,
      transfer_group: null,
    },
    previous_attributes: {
      amount_refunded: 0,
      receipt_url: 'https://pay.stripe.com/receipts/payment/ABCDE',
      refunded: false,
    },
  },
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: 'req_11111',
    idempotency_key: '12345',
  },
  type: 'charge.refunded',
};

export const mockEvent__charge_refund_notCaptured: Stripe.Event = {
  id: 'evt_11111',
  object: 'event',
  api_version: '2024-04-10',
  created: 1717531265,
  data: {
    object: {
      id: 'ch_11111',
      object: 'charge',
      amount: 34500,
      amount_captured: 34500,
      amount_refunded: 34500,
      application: null,
      application_fee: null,
      application_fee_amount: null,
      balance_transaction: 'txn_11111',
      billing_details: commonBillingDetails,
      calculated_statement_descriptor: 'ABCDE',
      captured: false,
      created: 1717529587,
      currency: 'mxn',
      customer: null,
      description: 'Sport shoes',
      disputed: false,
      failure_balance_transaction: null,
      failure_code: null,
      failure_message: null,
      fraud_details: {},
      invoice: null,
      livemode: false,
      metadata: {
        ct_payment_id: 'pi_11111',
      },
      on_behalf_of: null,
      outcome: {
        network_status: 'approved_by_network',
        reason: null,
        risk_level: 'normal',
        risk_score: 8,
        seller_message: 'Payment complete.',
        type: 'authorized',
        advice_code: 'try_again_later',
        network_advice_code: 'mock_advice_code',
        network_decline_code: 'mock_decline_code',
      },
      paid: true,
      payment_intent: 'pi_11111',
      payment_method: 'pm_11111',
      payment_method_details: commonPaymentMethodDetails2,
      radar_options: {},
      receipt_email: null,
      receipt_number: null,
      receipt_url: 'https://pay.stripe.com/receipts/payment/ABCDE',
      refunded: true,
      review: null,
      shipping: null,
      source: null,
      source_transfer: null,
      statement_descriptor: 'ABCDE',
      statement_descriptor_suffix: null,
      status: 'succeeded',
      transfer_data: null,
      transfer_group: null,
    },
    previous_attributes: {
      amount_refunded: 0,
      receipt_url: 'https://pay.stripe.com/receipts/payment/ABCDE',
      refunded: false,
    },
  },
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: 'req_11111',
    idempotency_key: '12345',
  },
  type: 'charge.refunded',
};

export const mockEvent__paymentIntent_canceled: Stripe.Event = {
  id: 'evt_11111',
  object: 'event',
  api_version: '2024-04-10',
  created: 1717607367,
  data: {
    object: {
      id: 'pi_11111',
      object: 'payment_intent',
      amount: 45600,
      amount_capturable: 0,
      amount_details: {
        tip: {},
      },
      amount_received: 0,
      application: null,
      application_fee_amount: null,
      automatic_payment_methods: null,
      canceled_at: 1717607367,
      cancellation_reason: 'requested_by_customer',
      capture_method: 'manual',
      client_secret: 'pi_11111AAAAA',
      confirmation_method: 'automatic',
      created: 1717452983,
      currency: 'mxn',
      customer: null,
      description: 'Sport shoes',
      invoice: null,
      last_payment_error: null,
      latest_charge: 'ch_11111',
      livemode: false,
      metadata: {
        ct_payment_id: 'pi_11111',
      },
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
      statement_descriptor: 'asdad',
      statement_descriptor_suffix: null,
      status: 'canceled',
      transfer_data: null,
      transfer_group: null,
    },
  },
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: 'req_11111',
    idempotency_key: 'ASDFG-12345',
  },
  type: 'payment_intent.canceled',
};

export const mockRoute__customer_session_succeed: CustomerResponseSchemaDTO = {
  ephemeralKey: 'mockEphemeralKey',
  sessionId: 'mockSessionId',
  stripeCustomerId: 'mockStripeCustomerId',
};

export const mockRoute__payments_succeed: PaymentResponseSchemaDTO = {
  clientSecret: 'mock_paymentReference',
  paymentReference: 'mock_paymentReference',
  merchantReturnUrl: 'mock_merchantReturnUrl',
  cartId: 'mockCartId',
};

export const mockRoute__paymentsComponents_succeed: SupportedPaymentComponentsSchemaDTO = {
  dropins: [
    {
      type: 'embedded',
    },
  ],
  components: [
    {
      type: 'payment',
    },
    {
      type: 'expressCheckout',
    },
  ],
};

export const mockRoute__paymentIntent_succeed: PaymentIntentResponseSchemaDTO = {
  outcome: PaymentModificationStatus.APPROVED,
};

export const mockRoute__get_config_element_succeed: ConfigElementResponseSchemaDTO = {
  cartInfo: {
    currency: 'usd',
    amount: 10000,
  },
  appearance: '',
  captureMethod: 'captureMethod',
  webElements: 'mockWebElement',
  setupFutureUsage: 'on_session',
  layout: '{"type":"accordion","defaultCollapsed":false,"radios":true,"spacedAccordionItems":true}',
  collectBillingAddress: CollectBillingAddressOptions.AUTO,
  paymentMode: 'payment',
  // Present so the round-trip assertion in routes.test/stripe-payment.spec.ts actually proves that
  // flowType survives Fastify response serialization. ConfigElementResponseSchema is the declared 200
  // schema, and Fastify strips undeclared properties — see the comment on the field in
  // dtos/stripe-payment.dto.ts. Without a value here that property is asserted only by prose.
  //
  // 'deferred' and not 'pi_first' deliberately: this fixture must stay a state the service can
  // actually emit, and initializeCartPayment forces setupFutureUsage to undefined whenever flowType
  // is 'pi_first'. Pairing 'pi_first' with the 'on_session' above would teach a reader a combination
  // that cannot occur. Either value proves the serialization point equally well.
  flowType: 'deferred',
};

export const mockEvent__charge_capture_succeeded_notCaptured: Stripe.Event = {
  id: 'evt_11111',
  object: 'event',
  api_version: '2024-04-10',
  created: 1718306259,
  data: {
    object: {
      id: 'ch_11111',
      object: 'charge',
      amount: 123100,
      amount_captured: 0,
      amount_refunded: 0,
      application: null,
      application_fee: null,
      application_fee_amount: null,
      balance_transaction: null,
      billing_details: commonBillingDetails,
      calculated_statement_descriptor: 'AAAAAAA',
      captured: false,
      created: 1718306259,
      currency: 'mxn',
      customer: null,
      description: 'Manual payment',
      disputed: false,
      failure_balance_transaction: null,
      failure_code: null,
      failure_message: null,
      fraud_details: {},
      invoice: null,
      livemode: false,
      metadata: {
        cart_id: '11111-22222',
      },
      on_behalf_of: null,
      outcome: {
        network_status: 'approved_by_network',
        reason: null,
        risk_level: 'normal',
        risk_score: 14,
        seller_message: 'Payment complete.',
        type: 'authorized',
        advice_code: 'try_again_later',
        network_advice_code: 'mock_advice_code',
        network_decline_code: 'mock_decline_code',
      },
      paid: true,
      payment_intent: 'pi_11111',
      payment_method: 'pm_11111',
      payment_method_details: commonPaymentMethodDetails,
      radar_options: {},
      receipt_email: null,
      receipt_number: null,
      receipt_url: 'https://pay.stripe.com/receipts/payment/11111',
      refunded: false,
      review: null,
      shipping: null,
      source: null,
      source_transfer: null,
      statement_descriptor: 'aaaaaaa',
      statement_descriptor_suffix: null,
      status: 'succeeded',
      transfer_data: null,
      transfer_group: null,
    },
  },
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: 'req_11111',
    idempotency_key: '7ae634ca-11111',
  },
  type: 'charge.captured',
};

export const mockEvent__charge_succeeded_notCaptured: Stripe.Event = {
  id: 'evt_11111',
  object: 'event',
  api_version: '2024-04-10',
  created: 1718306259,
  data: {
    object: {
      id: 'ch_11111',
      object: 'charge',
      amount: 123100,
      amount_captured: 0,
      amount_refunded: 0,
      application: null,
      application_fee: null,
      application_fee_amount: null,
      balance_transaction: null,
      billing_details: commonBillingDetails,
      calculated_statement_descriptor: 'AAAAAAA',
      captured: false,
      created: 1718306259,
      currency: 'mxn',
      customer: null,
      description: 'Manual payment',
      disputed: false,
      failure_balance_transaction: null,
      failure_code: null,
      failure_message: null,
      fraud_details: {},
      invoice: null,
      livemode: false,
      metadata: {
        cart_id: '11111-22222',
        ct_payment_id: 'pi_11111',
      },
      on_behalf_of: null,
      outcome: {
        network_status: 'approved_by_network',
        reason: null,
        risk_level: 'normal',
        risk_score: 14,
        seller_message: 'Payment complete.',
        type: 'authorized',
        advice_code: 'try_again_later',
        network_advice_code: 'mock_advice_code',
        network_decline_code: 'mock_decline_code',
      },
      paid: true,
      payment_intent: 'pi_11111',
      payment_method: 'pm_11111',
      payment_method_details: commonPaymentMethodDetails,
      radar_options: {},
      receipt_email: null,
      receipt_number: null,
      receipt_url: 'https://pay.stripe.com/receipts/payment/11111',
      refunded: false,
      review: null,
      shipping: null,
      source: null,
      source_transfer: null,
      statement_descriptor: 'aaaaaaa',
      statement_descriptor_suffix: null,
      status: 'succeeded',
      transfer_data: null,
      transfer_group: null,
    },
  },
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: 'req_11111',
    idempotency_key: '7ae634ca-11111',
  },
  type: 'charge.succeeded',
};

export const mockEvent__charge_succeeded_captured: Stripe.Event = {
  id: 'evt_11111',
  object: 'event',
  api_version: '2024-04-10',
  created: 1718306259,
  data: {
    object: {
      id: 'ch_11111',
      object: 'charge',
      amount: 123100,
      amount_captured: 123100,
      amount_refunded: 0,
      application: null,
      application_fee: null,
      application_fee_amount: null,
      balance_transaction: null,
      billing_details: commonBillingDetails,
      calculated_statement_descriptor: 'AAAAAAA',
      captured: true,
      created: 1718306259,
      currency: 'mxn',
      customer: null,
      description: 'Manual payment',
      disputed: false,
      failure_balance_transaction: null,
      failure_code: null,
      failure_message: null,
      fraud_details: {},
      invoice: null,
      livemode: false,
      metadata: {
        cart_id: '11111-22222',
      },
      on_behalf_of: null,
      outcome: {
        network_status: 'approved_by_network',
        reason: null,
        risk_level: 'normal',
        risk_score: 14,
        seller_message: 'Payment complete.',
        type: 'authorized',
        advice_code: 'try_again_later',
        network_advice_code: 'mock_advice_code',
        network_decline_code: 'mock_decline_code',
      },
      paid: true,
      payment_intent: 'pi_11111',
      payment_method: 'pm_11111',
      payment_method_details: commonPaymentMethodDetails,
      radar_options: {},
      receipt_email: null,
      receipt_number: null,
      receipt_url: 'https://pay.stripe.com/receipts/payment/11111',
      refunded: false,
      review: null,
      shipping: null,
      source: null,
      source_transfer: null,
      statement_descriptor: 'aaaaaaa',
      statement_descriptor_suffix: null,
      status: 'succeeded',
      transfer_data: null,
      transfer_group: null,
    },
  },
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: 'req_11111',
    idempotency_key: '7ae634ca-11111',
  },
  type: 'charge.captured',
};

export const mockEvent__paymentIntent_requiresAction: Stripe.Event = {
  id: 'evt_11111',
  object: 'event',
  api_version: '2024-04-10',
  created: 1717093717,
  data: commonData,
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: 'req_11111',
    idempotency_key: '11111',
  },
  type: 'payment_intent.requires_action',
};

export const mockModifyPayment__payment_intent_succeeded: ModifyPayment = {
  paymentId: 'mockPaymentId',
  data: {
    actions: [
      {
        action: 'capturePayment',
        amount: {
          centAmount: 1500,
          currencyCode: 'USD',
        },
      },
    ],
  },
};

export const mockModifyPayment__charge_refunded: ModifyPayment = {
  paymentId: 'mockPaymentId',
  data: {
    actions: [
      {
        action: 'refundPayment',
        amount: {
          centAmount: 1500,
          currencyCode: 'USD',
        },
      },
    ],
  },
};

export const mockModifyPayment__payment_intent_canceled: ModifyPayment = {
  paymentId: 'mockPaymentId',
  data: {
    actions: [
      {
        action: 'cancelPayment',
      },
    ],
  },
};

export const mockRoute__well_know__succeed: string = 'mockWellKnowString';

// ---------------------------------------------------------------------------
// Bank transfer (customer_balance) fixtures — SB3-207 Etapa 2
//
// The PaymentIntent below is the shape Stripe emits while a bank transfer is
// awaiting funds: status `requires_action`, `amount_received: 0` (the wire has
// not landed yet) and `next_action.display_bank_transfer_instructions` carrying
// the virtual account details. `amount_received: 0` is load-bearing — it is what
// makes the "amount must come from pi.amount, never populateAmount()" test real.
// ---------------------------------------------------------------------------

const bankTransferPaymentIntent = {
  id: 'pi_bt_11111',
  object: 'payment_intent',
  amount: 12300,
  amount_capturable: 0,
  amount_details: { tip: {} },
  amount_received: 0,
  application: null,
  application_fee_amount: null,
  automatic_payment_methods: null,
  canceled_at: null,
  cancellation_reason: null,
  capture_method: 'automatic',
  client_secret: 'pi_bt_11111_secret',
  confirmation_method: 'automatic',
  created: 1717452163,
  currency: 'eur',
  customer: 'cus_11111',
  description: 'Sport shoes',
  invoice: null,
  last_payment_error: null,
  latest_charge: null,
  livemode: false,
  metadata: { ct_payment_id: 'ct_payment_bt_11111' },
  next_action: {
    type: 'display_bank_transfer_instructions',
    display_bank_transfer_instructions: {
      amount_remaining: 12300,
      currency: 'eur',
      financial_addresses: [
        {
          iban: {
            account_holder_name: 'Stripe Payments UK Limited',
            bic: 'BUKBGB22',
            country: 'DE',
            iban: 'DE89370400440532013000',
          },
          supported_networks: ['sepa'],
          type: 'iban',
        },
      ],
      hosted_instructions_url: 'https://payments.stripe.com/bank_transfer_instructions/test_11111',
      reference: 'BT-REF-11111',
      type: 'eu_bank_transfer',
    },
  },
  on_behalf_of: null,
  payment_method: 'pm_bt_11111',
  payment_method_configuration_details: null,
  payment_method_options: {},
  payment_method_types: ['customer_balance'],
  processing: null,
  receipt_email: null,
  review: null,
  setup_future_usage: null,
  shipping: null,
  source: null,
  statement_descriptor: 'Payment',
  statement_descriptor_suffix: null,
  status: 'requires_action',
  transfer_data: null,
  transfer_group: null,
};

export const mockEvent__paymentIntent_requiresAction_bankTransfer: Stripe.Event = {
  id: 'evt_bt_11111',
  object: 'event',
  api_version: '2024-04-10',
  created: 1717692258,
  data: { object: bankTransferPaymentIntent },
  livemode: false,
  pending_webhooks: 1,
  request: { id: 'req_11111', idempotency_key: '11111-BT' },
  type: 'payment_intent.requires_action',
} as unknown as Stripe.Event;

/** Same PaymentIntent after a partial wire: only `amount_remaining` moves. */
export const mockEvent__paymentIntent_partiallyFunded_bankTransfer: Stripe.Event = {
  id: 'evt_bt_22222',
  object: 'event',
  api_version: '2024-04-10',
  created: 1717692300,
  data: {
    object: {
      ...bankTransferPaymentIntent,
      next_action: {
        ...bankTransferPaymentIntent.next_action,
        display_bank_transfer_instructions: {
          ...bankTransferPaymentIntent.next_action.display_bank_transfer_instructions,
          amount_remaining: 4300,
        },
      },
    },
  },
  livemode: false,
  pending_webhooks: 1,
  request: { id: 'req_22222', idempotency_key: '22222-BT' },
  type: 'payment_intent.partially_funded',
} as unknown as Stripe.Event;

/**
 * Card 3DS also emits `payment_intent.requires_action`. This is the regression
 * fixture for the release gate: it must never reach processStripeEvent.
 */
export const mockEvent__paymentIntent_requiresAction_3ds: Stripe.Event = {
  ...mockEvent__paymentIntent_requiresAction_bankTransfer,
  id: 'evt_3ds_11111',
  data: {
    object: {
      ...bankTransferPaymentIntent,
      id: 'pi_3ds_11111',
      currency: 'mxn',
      payment_method_types: ['card'],
      next_action: {
        type: 'use_stripe_sdk',
        use_stripe_sdk: { type: 'three_d_secure_redirect' },
      },
    },
  },
} as unknown as Stripe.Event;

/** Boleto also emits `requires_action`. Must stay log-only, exactly as today. */
export const mockEvent__paymentIntent_requiresAction_boleto: Stripe.Event = {
  ...mockEvent__paymentIntent_requiresAction_bankTransfer,
  id: 'evt_boleto_11111',
  data: {
    object: {
      ...bankTransferPaymentIntent,
      id: 'pi_boleto_11111',
      currency: 'brl',
      payment_method_types: ['boleto'],
      next_action: {
        type: 'boleto_display_details',
        boleto_display_details: {
          expires_at: 1717692999,
          hosted_voucher_url: 'https://payments.stripe.com/boleto/test_11111',
          number: '00000.00000 00000.000000 00000.000000 0 00000000000000',
          pdf: 'https://payments.stripe.com/boleto/test_11111/pdf',
        },
      },
    },
  },
} as unknown as Stripe.Event;

/**
 * ACH micro-deposits (`us_bank_account`) also emits `requires_action`, with a distinct next_action
 * type. Unlike 3DS/Boleto it MUST be routed and freeze the cart, since the debit is in flight for
 * days and the confirm gate never sees it. Carries `cart_id` so freezeCartForBankTransfer can resolve
 * the cart.
 */
export const mockEvent__paymentIntent_requiresAction_microdeposits: Stripe.Event = {
  ...mockEvent__paymentIntent_requiresAction_bankTransfer,
  id: 'evt_md_11111',
  data: {
    object: {
      ...bankTransferPaymentIntent,
      id: 'pi_md_11111',
      currency: 'usd',
      payment_method_types: ['us_bank_account'],
      metadata: { ct_payment_id: 'ct_payment_md_11111', cart_id: 'cart-md-11111' },
      next_action: {
        type: 'verify_with_microdeposits',
        verify_with_microdeposits: {
          arrival_date: 1717692999,
          hosted_verification_url: 'https://payments.stripe.com/microdeposit/test_11111',
          microdeposit_type: 'descriptor_code',
        },
      },
    },
  },
} as unknown as Stripe.Event;

const cashBalanceTransaction = {
  id: 'ccsbtxn_11111',
  object: 'customer_cash_balance_transaction',
  created: 1717692400,
  currency: 'eur',
  customer: 'cus_11111',
  ending_balance: 0,
  livemode: false,
  net_amount: 12300,
  type: 'funded',
  funded: {
    bank_transfer: {
      eu_bank_transfer: {
        bic: 'BUKBGB22',
        iban_last4: '3000',
        sender_name: 'Jane Shopper',
      },
      reference: 'BT-REF-11111',
      type: 'eu_bank_transfer',
    },
  },
};

export const mockEvent__customerCashBalanceTransaction_funded: Stripe.Event = {
  id: 'evt_ccb_11111',
  object: 'event',
  api_version: '2024-04-10',
  created: 1717692400,
  data: { object: cashBalanceTransaction },
  livemode: false,
  pending_webhooks: 1,
  request: { id: 'req_ccb_11111', idempotency_key: null },
  type: 'customer_cash_balance_transaction.created',
} as unknown as Stripe.Event;

/**
 * The money-was-clawed-back signal. Alertable, but never written to commercetools in v1.
 *
 * Deliberately carries NO `applied_to_payment`: per the Stripe SDK a `funding_reversed`
 * transaction has no sub-object at all, so there is no PaymentIntent to correlate against.
 * An earlier draft of this fixture invented that field, which made the route assertion pass
 * against a payload Stripe never emits.
 */
export const mockEvent__customerCashBalanceTransaction_fundingReversed: Stripe.Event = {
  ...mockEvent__customerCashBalanceTransaction_funded,
  id: 'evt_ccb_22222',
  data: {
    object: {
      ...cashBalanceTransaction,
      id: 'ccsbtxn_22222',
      type: 'funding_reversed',
      net_amount: -12300,
      funded: undefined,
    },
  },
} as unknown as Stripe.Event;

/** The other alertable type. Carries linked_transaction, never a PaymentIntent. */
export const mockEvent__customerCashBalanceTransaction_adjustedForOverdraft: Stripe.Event = {
  ...mockEvent__customerCashBalanceTransaction_funded,
  id: 'evt_ccb_33333',
  data: {
    object: {
      ...cashBalanceTransaction,
      id: 'ccsbtxn_33333',
      type: 'adjusted_for_overdraft',
      net_amount: -12300,
      funded: undefined,
      adjusted_for_overdraft: {
        balance_transaction: 'txn_11111',
        linked_transaction: 'ccsbtxn_22222',
      },
    },
  },
} as unknown as Stripe.Event;
