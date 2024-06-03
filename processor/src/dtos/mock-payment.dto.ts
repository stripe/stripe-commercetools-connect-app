import { Static, Type } from '@sinclair/typebox';

export const CardPaymentMethodSchema = Type.Object({
  type: Type.String(),
  paymentIntent: Type.String(),
});

export const PaymentRequestSchema = Type.Object({
  paymentMethod: Type.Composite([CardPaymentMethodSchema]),
});

export const AmountDetailsSchema = Type.Object({
  tip: Type.Object({}),
});
export const AutomaticPaymentMethodsSchema = Type.Object({
  enabled: Type.Boolean(),
});
export const PaymentMethodOptionsSchema = Type.Object({
  card: Type.Object({
    installments: Type.Null(),
    mandate_options: Type.Null(),
    network: Type.Null(),
    request_three_d_secure: Type.String(),
  }),
  link: Type.Object({
    persistent_token: Type.Null(),
  }),
});

export const PaymentIntentResponseSchema = Type.Object({
  id: Type.String(),
  object: Type.String(),
  amount: Type.Number(),
  amount_capturable: Type.Number(),
  amount_details: AmountDetailsSchema,
  amount_received: Type.Number(),
  application: Type.Null(),
  application_fee_amount: Type.Null(),
  automatic_payment_methods: AutomaticPaymentMethodsSchema,
  canceled_at: Type.Null(),
  cancellation_reason: Type.Null(),
  capture_method: Type.String(),
  client_secret: Type.String(),
  confirmation_method: Type.String(),
  created: Type.Number(),
  currency: Type.String(),
  customer: Type.Null(),
  description: Type.Null(),
  invoice: Type.Null(),
  last_payment_error: Type.Null(),
  latest_charge: Type.Null(),
  livemode: Type.Boolean(),
  metadata: Type.Object({}),
  next_action: Type.Null(),
  on_behalf_of: Type.Null(),
  payment_method: Type.Null(),
  payment_method_options: PaymentMethodOptionsSchema,
  payment_method_types: Type.Array(Type.String()),
  processing: Type.Null(),
  receipt_email: Type.Null(),
  review: Type.Null(),
  setup_future_usage: Type.Null(),
  shipping: Type.Null(),
  source: Type.Null(),
  statement_descriptor: Type.Null(),
  statement_descriptor_suffix: Type.Null(),
  status: Type.String(),
  transfer_data: Type.Null(),
  transfer_group: Type.Null(),
});

export enum PaymentOutcome {
  AUTHORIZED = 'Authorized',
  REJECTED = 'Rejected',
  INITIAL = 'Initial',
}

export const PaymentOutcomeSchema = Type.Enum(PaymentOutcome);

export const PaymentResponseSchema = Type.Object({
  outcome: PaymentOutcomeSchema,
  paymentReference: Type.String(),
});

export type PaymentRequestSchemaDTO = Static<typeof PaymentRequestSchema>;
export type PaymentResponseSchemaDTO = Static<typeof PaymentResponseSchema>;
export type PaymentIntentResponseSchemaDTO = Static<typeof PaymentIntentResponseSchema>;
