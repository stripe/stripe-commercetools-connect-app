import { Static, Type } from '@sinclair/typebox';

export const AmountSchema = Type.Object({
  centAmount: Type.Integer(),
  currencyCode: Type.String(),
});

export const ActionCapturePaymentSchema = Type.Composite([
  Type.Object({
    action: Type.Literal('capturePayment'),
  }),
  Type.Object({
    amount: AmountSchema,
  }),
]);

export const ActionRefundPaymentSchema = Type.Composite([
  Type.Object({
    action: Type.Literal('refundPayment'),
  }),
  Type.Object({
    amount: AmountSchema,
  }),
]);

export const ActionCancelPaymentSchema = Type.Composite([
  Type.Object({
    action: Type.Literal('cancelPayment'),
  }),
]);

/**
 * Payment intent request schema.
 *
 * Example:
 * {
 *  "actions": [
 *   {
 *    "action": "capturePayment",
 *    "amount": {
 *      "centAmount": 100,
 *      "currencyCode": "EUR"
 *    }
 *  ]
 * }
 */
export const PaymentIntentRequestSchema = Type.Object({
  actions: Type.Array(Type.Union([ActionCapturePaymentSchema, ActionRefundPaymentSchema, ActionCancelPaymentSchema]), {
    maxItems: 1,
  }),
});

export const PaymentIntentConfirmRequestSchema = Type.Object({
  paymentIntent: Type.String(),
  confirmationToken: Type.Optional(Type.String()),
});

export enum PaymentModificationStatus {
  APPROVED = 'approved',
  REJECTED = 'rejected',
  RECEIVED = 'received',
}
const PaymentModificationSchema = Type.Enum(PaymentModificationStatus);

export const PaymentIntentResponseSchema = Type.Object({
  outcome: PaymentModificationSchema,
  error: Type.Optional(Type.String()),
});

export enum PaymentTransactions {
  AUTHORIZATION = 'Authorization',
  CANCEL_AUTHORIZATION = 'CancelAuthorization',
  CHARGE = 'Charge',
  CHARGE_BACK = 'Chargeback',
  REFUND = 'Refund',
}

export type PaymentIntentRequestSchemaDTO = Static<typeof PaymentIntentRequestSchema>;
export type PaymentIntentResponseSchemaDTO = Static<typeof PaymentIntentResponseSchema>;
export type AmountSchemaDTO = Static<typeof AmountSchema>;
export type PaymentIntenConfirmRequestSchemaDTO = Static<typeof PaymentIntentConfirmRequestSchema>;
export type PaymentIntentConfirmResponseSchemaDTO = Static<typeof PaymentIntentResponseSchema>;
