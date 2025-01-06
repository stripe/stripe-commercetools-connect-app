import { Static, Type } from '@sinclair/typebox';
import { PaymentMethodType, PaymentOutcomeSchema } from './mock-payment.dto';

export const CreatePaymentMethodSchema = Type.Object({
  type: Type.Union([Type.Enum(PaymentMethodType), Type.String()]),
  poNumber: Type.Optional(Type.String()),
  invoiceMemo: Type.Optional(Type.String()),
  confirmationToken: Type.Optional(Type.String()),
});

export const PaymentRequestSchema = Type.Object({
  paymentMethod: Type.Composite([CreatePaymentMethodSchema]),
  cart: Type.Optional(
    Type.Object({
      id: Type.String(),
    }),
  ),
  paymentIntent: Type.Optional(
    Type.Object({
      id: Type.String(),
    }),
  ),
  paymentOutcome: Type.Optional(PaymentOutcomeSchema),
});

export enum PaymentOutcome {
  AUTHORIZED = 'Authorized',
  REJECTED = 'Rejected',
  INITIAL = 'Initial',
}

export const PaymentResponseSchema = Type.Object({
  sClientSecret: Type.String(),
  paymentReference: Type.String(),
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
