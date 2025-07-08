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

export const ConfigElementResponseSchema = Type.Object({
  cartInfo: Type.Object({
    amount: Type.Number(),
    currency: Type.String(),
  }),
  appearance: Type.Optional(Type.String()),
  captureMethod: Type.Union([Type.Literal('manual'), Type.Literal('automatic')]),
  webElements: Type.Optional(Type.Union([Type.Literal('paymentElement'), Type.Literal('expressCheckout')]) ),
  setupFutureUsage: Type.Optional(Type.Union([Type.Literal('off_session'), Type.Literal('on_session')]) ),
  layout: Type.String(),
  collectBillingAddress: Type.Union([Type.Literal('auto'), Type.Literal('never'), Type.Literal('if_required')]),
  paymentMode: Type.Union([Type.Literal('payment'), Type.Literal('subscription'), Type.Literal('setup')]),
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

export const ConfirmPaymentRequestSchema = Type.Object({
  paymentIntentId: Type.String(),
  paymentReference: Type.String(),
});

export const SubscriptionFromSetupIntentResponseSchema = Type.Object({
  subscriptionId: Type.String(),
  paymentReference: Type.String(),
});

export const ShippingMethodsResponseSchema = Type.Object({
  shippingRates: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.String(),
        displayName: Type.String(),
        amount: Type.Number(),
      }),
    ),
  ),
  lineItems: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String(),
        amount: Type.Number(),
      }),
    ),
  ),
});


export type PaymentRequestSchemaDTO = Static<typeof PaymentRequestSchema>;
export type PaymentResponseSchemaDTO = Static<typeof PaymentResponseSchema>;
export type ConfigElementResponseSchemaDTO = Static<typeof ConfigElementResponseSchema>;
export type ConfigResponseSchemaDTO = Static<typeof ConfigResponseSchema>;
export type CustomerResponseSchemaDTO = Static<typeof CustomerResponseSchema>;
export type ConfirmPaymentRequestSchemaDTO = Static<typeof ConfirmPaymentRequestSchema>;
export type SubscriptionFromSetupIntentResponseSchemaDTO = Static<typeof SubscriptionFromSetupIntentResponseSchema>;
export type SubscriptionResponseSchemaDTO = Static<typeof SubscriptionResponseSchema>;
export type SetupIntentResponseSchemaDTO = Static<typeof SetupIntentResponseSchema>;
export type ShippingMethodsResponseSchemaDTO = Static<typeof ShippingMethodsResponseSchema>;
