import { Static, Type } from '@sinclair/typebox';

export const CreatePaymentMethodSchema = Type.Object({
  type: Type.String(),
  confirmationToken: Type.Optional(Type.String()),
});

export const PaymentRequestSchema = Type.Object({
  paymentMethod: Type.Composite([CreatePaymentMethodSchema]),
  cart: Type.Object({
    id: Type.String(),
  }),
  paymentIntent: Type.Object({
    id: Type.String(),
  }),
});

export enum PaymentOutcome {
  AUTHORIZED = 'Authorized',
  REJECTED = 'Rejected',
  INITIAL = 'Initial',
}

export const PaymentOutcomeSchema = Type.Enum(PaymentOutcome);

export const PaymentResponseSchema = Type.Object({
  sClientSecret: Type.String(),
});

export const ConfigElementResponseSchema = Type.Object({
  cartInfo: Type.Object({
    amount: Type.Number(),
    currency: Type.String(),
  }),
  appearance: Type.Optional(Type.String()),
  captureMethod: Type.String(),
});

export const CtPaymentSchema = Type.Object({
  ctPaymentReference: Type.String(),
});

export type PaymentRequestSchemaDTO = Static<typeof PaymentRequestSchema>;
export type PaymentResponseSchemaDTO = Static<typeof PaymentResponseSchema>;
export type ConfigElementResponseSchemaDTO = Static<typeof ConfigElementResponseSchema>;
export type CtPaymentSchemaDTO = Static<typeof CtPaymentSchema>;
