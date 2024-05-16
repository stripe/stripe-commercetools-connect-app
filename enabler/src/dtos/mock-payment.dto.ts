import { Static, Type } from '@sinclair/typebox';

export const PaymentRequestSchema = Type.Object({
  paymentMethod: Type.String(),
});

export enum PaymentOutcome {
  AUTHORIZED = 'Authorized',
  REJECTED = 'Rejected',
}

export type PaymentRequestSchemaDTO = Static<typeof PaymentRequestSchema>;
