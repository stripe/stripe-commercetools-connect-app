import { Static, Type } from '@sinclair/typebox';

export const TransactionDraft = Type.Object({
  cartId: Type.String({ format: 'uuid' }),
  paymentInterface: Type.String({ format: 'uuid' }),
  amount: Type.Optional(
    Type.Object({
      centAmount: Type.Number(),
      currencyCode: Type.String(),
    }),
  ),
});

const TransactionStatePending = Type.Literal('Pending', {
  description: 'The authorization/capture has not happened yet. Most likely because we need to receive notification.',
});

const TransactionStateFailed = Type.Literal('Failed', {
  description: "Any error that occured for which the system can't recover automatically from.",
});

const TransactionStateComplete = Type.Literal('Completed', {
  description: 'If there is a successful authorization/capture on the payment-transaction.',
});

export const TransactionStatusState = Type.Union([
  TransactionStateComplete,
  TransactionStateFailed,
  TransactionStatePending,
]);

export const TransactionResponse = Type.Object({
  transactionStatus: Type.Object({
    state: TransactionStatusState,
    errors: Type.Array(
      Type.Object({
        code: Type.Literal('PaymentRejected'),
        message: Type.String(),
      }),
    ),
  }),
});

export type TransactionDraftDTO = Static<typeof TransactionDraft>;
export type TransactionResponseDTO = Static<typeof TransactionResponse>;
