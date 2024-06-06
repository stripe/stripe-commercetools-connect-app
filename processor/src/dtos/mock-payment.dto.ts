import { Static, Type } from '@sinclair/typebox';

export const CreatePaymentMethodSchema = Type.Object({
  type: Type.String(),
  confirmationToken: Type.String(),
});

export const PaymentRequestSchema = Type.Object({
  paymentMethod: Type.Composite([CreatePaymentMethodSchema]),
});

export enum PaymentOutcome {
  AUTHORIZED = 'Authorized',
  REJECTED = 'Rejected',
  INITIAL = 'Initial',
}

export const PaymentOutcomeSchema = Type.Enum(PaymentOutcome);

export const PaymentResponseSchema = Type.Object({
  outcome: PaymentOutcomeSchema,
  ctPaymentReference: Type.String(),
  sClientSecret: Type.String(),
});

export type PaymentRequestSchemaDTO = Static<typeof PaymentRequestSchema>;
export type PaymentResponseSchemaDTO = Static<typeof PaymentResponseSchema>;
