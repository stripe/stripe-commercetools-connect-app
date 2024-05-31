import { Static, Type } from '@sinclair/typebox';

export const CardPaymentMethodSchema = Type.Object({
  type: Type.String(),
  paymentIntent: Type.String(),
});

export const PaymentRequestSchema = Type.Object({
  paymentMethod: Type.Composite([CardPaymentMethodSchema]),
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
