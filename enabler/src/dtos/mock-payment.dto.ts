import { Static, Type } from '@sinclair/typebox';

export enum PaymentOutcome {
  AUTHORIZED = 'Authorized',
  REJECTED = 'Rejected',
}

export const PaymentOutcomeSchema = Type.Enum(PaymentOutcome);

export const PaymentRequestSchema = Type.Object({
  paymentMethod: Type.Object({
    type: Type.String(),
    poNumber: Type.Optional(Type.String()),
    invoiceMemo: Type.Optional(Type.String()),
  }),
  paymentOutcome: PaymentOutcomeSchema,
});

export const PaymentResponseSchema = Type.Object({
  sClientSecret: Type.String(),
  paymentReference: Type.String(),
  merchantReturnUrl: Type.String(),
  cartId: Type.String(),
});

export const ConfigElementResponseSchema = Type.Object({
  cartInfo: Type.Object({
    amount: Type.Number(),
    currency: Type.String(),
  }),
  appearance: Type.Optional(Type.String()),
  captureMethod: Type.Union([Type.Literal('manual'), Type.Literal('automatic')]),
  webElements: Type.Optional(Type.Union([Type.Literal('paymentElement'), Type.Literal('expressCheckout')]) ),
  setupFutureUsage: Type.Optional(Type.Union([Type.Literal('off_session'), Type.Literal('on_session')]) ),
});

export const ConfigResponseSchema = Type.Object({
  environment: Type.String(),
  publishableKey: Type.String(),
});

export const CustomerResponseSchema = Type.Object({
  stripeCustomerId: Type.String(),
  ephemeralKey: Type.String(),
  sessionId: Type.String(),
});


export type PaymentRequestSchemaDTO = Static<typeof PaymentRequestSchema>;
export type PaymentResponseSchemaDTO = Static<typeof PaymentResponseSchema>;
export type ConfigElementResponseSchemaDTO = Static<typeof ConfigElementResponseSchema>;
export type ConfigResponseSchemaDTO = Static<typeof ConfigResponseSchema>;
export type CustomerResponseSchemaDTO = Static<typeof CustomerResponseSchema>;
