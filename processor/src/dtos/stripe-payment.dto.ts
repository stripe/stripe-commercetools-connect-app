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
  PENDING = 'Pending',
}

export const PaymentResponseSchema = Type.Object({
  clientSecret: Type.String(),
  paymentReference: Type.Optional(Type.String()),
  merchantReturnUrl: Type.String(),
  cartId: Type.String(),
  billingAddress: Type.Optional(Type.String()),
});

export const SetupIntentResponseSchema = Type.Object({
  clientSecret: Type.String(),
  merchantReturnUrl: Type.String(),
  billingAddress: Type.Optional(Type.String()),
});

export const SubscriptionResponseSchema = Type.Object({
  subscriptionId: Type.String(),
  clientSecret: Type.String(),
  paymentReference: Type.String(),
  merchantReturnUrl: Type.String(),
  cartId: Type.String(),
  billingAddress: Type.Optional(Type.String()),
});

export enum CollectBillingAddressOptions {
  AUTO = 'auto',
  NEVER = 'never',
  IF_REQUIRED = 'if_required',
}

export const ConfigElementResponseSchema = Type.Object({
  cartInfo: Type.Object({
    amount: Type.Number(),
    currency: Type.String(),
  }),
  appearance: Type.Optional(Type.String()),
  captureMethod: Type.String(),
  webElements: Type.String(),
  setupFutureUsage: Type.Optional(Type.String()),
  layout: Type.String(),
  collectBillingAddress: Type.Enum(CollectBillingAddressOptions),
  paymentMode: Type.Union([Type.Literal('subscription'), Type.Literal('setup'), Type.Literal('payment')]),
});

export const CtPaymentSchema = Type.Object({
  ctPaymentReference: Type.String(),
});

export const CustomerResponseSchema = Type.Optional(
  Type.Object({
    stripeCustomerId: Type.String(),
    ephemeralKey: Type.String(),
    sessionId: Type.String(),
  }),
);

export const SubscriptionFromSetupIntentResponseSchema = Type.Object({
  subscriptionId: Type.String(),
  paymentReference: Type.String(),
});

export const ConfirmSubscriptionRequestSchema = Type.Object({
  subscriptionId: Type.String(),
  paymentReference: Type.String(),
  paymentIntentId: Type.Optional(Type.String()),
});

export type PaymentRequestSchemaDTO = Static<typeof PaymentRequestSchema>;
export type PaymentResponseSchemaDTO = Static<typeof PaymentResponseSchema>;
export type ConfigElementResponseSchemaDTO = Static<typeof ConfigElementResponseSchema>;
export type CtPaymentSchemaDTO = Static<typeof CtPaymentSchema>;
export type CustomerResponseSchemaDTO = Static<typeof CustomerResponseSchema>;
export type SubscriptionFromSetupIntentResponseSchemaDTO = Static<typeof SubscriptionFromSetupIntentResponseSchema>;
export type SubscriptionResponseSchemaDTO = Static<typeof SubscriptionResponseSchema>;
export type ConfirmSubscriptionRequestSchemaDTO = Static<typeof ConfirmSubscriptionRequestSchema>;
export type SetupIntentResponseSchemaDTO = Static<typeof SetupIntentResponseSchema>;
