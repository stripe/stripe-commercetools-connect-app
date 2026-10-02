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
  /**
   * Elements initialization strategy — see config.stripePaymentFlow.
   *
   * Declared here because this schema IS the Fastify 200 response schema for
   * GET /config-element/:payment (stripe-payment.route.ts:289), and Fastify strips properties the
   * schema does not declare. Without this line initializeCartPayment would return flowType and the
   * wire would silently drop it — the enabler would see no flowType and fall back to deferred, and
   * the symptom would be "I configured pi_first and the enabler ignores it". Do not delete this line
   * as redundant with the service's return type: the type is not what puts the field on the wire.
   *
   * Optional so existing ConfigElementResponseSchemaDTO literals stay valid; the service always
   * populates it.
   */
  flowType: Type.Optional(Type.Union([Type.Literal('deferred'), Type.Literal('pi_first')])),
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

export const SubscriptionListResponseSchema = Type.Object({
  subscriptions: Type.Array(Type.Any()),
  error: Type.Optional(Type.String()),
});

export enum SubscriptionOutcome {
  UPDATED = 'updated',
  CANCELED = 'canceled',
  ERROR = 'error',
}

export const SubscriptionModifyResponseSchema = Type.Object({
  id: Type.String(),
  status: Type.String(),
  message: Type.Optional(Type.String()),
  outcome: Type.Enum(SubscriptionOutcome),
});

export const SubscriptionUpdateRequestSchema = Type.Object({
  subscriptionId: Type.String(),
  newSubscriptionVariantId: Type.String(),
  newSubscriptionVariantPosition: Type.Optional(Type.Number()),
  newSubscriptionPriceId: Type.String(),
});

export const SubscriptionPatchRequestSchema = Type.Object({
  id: Type.String(),
  params: Type.Optional(Type.Any()),
  // Allowlist the Stripe request options: only `idempotencyKey` may be supplied by the caller.
  // A caller-controlled `host`/`protocol`/`apiKey`/`headers`/`additionalHeaders` would let the
  // outbound Stripe request — which carries STRIPE_SECRET_KEY in its Authorization header — be
  // redirected to an attacker host, exfiltrating the merchant's secret key. `additionalProperties:
  // false` rejects any other option at the request boundary.
  options: Type.Optional(
    Type.Object(
      {
        idempotencyKey: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
  ),
});

export const PaymentMethodOptionsSchema = Type.Object({
  paymentMethodOptions: Type.Optional(Type.Record(Type.String(), Type.Record(Type.String(), Type.Unknown()))),
});

export type PaymentMethodOptionsSchemaDTO = Static<typeof PaymentMethodOptionsSchema>;

export type PaymentRequestSchemaDTO = Static<typeof PaymentRequestSchema>;
export type PaymentResponseSchemaDTO = Static<typeof PaymentResponseSchema>;
export type ConfigElementResponseSchemaDTO = Static<typeof ConfigElementResponseSchema>;
export type CtPaymentSchemaDTO = Static<typeof CtPaymentSchema>;
export type CustomerResponseSchemaDTO = Static<typeof CustomerResponseSchema>;
export type SubscriptionFromSetupIntentResponseSchemaDTO = Static<typeof SubscriptionFromSetupIntentResponseSchema>;
export type SubscriptionResponseSchemaDTO = Static<typeof SubscriptionResponseSchema>;
export type ConfirmSubscriptionRequestSchemaDTO = Static<typeof ConfirmSubscriptionRequestSchema>;
export type SetupIntentResponseSchemaDTO = Static<typeof SetupIntentResponseSchema>;
export type SubscriptionListResponseSchemaDTO = Static<typeof SubscriptionListResponseSchema>;
export type SubscriptionModifyResponseSchemaDTO = Static<typeof SubscriptionModifyResponseSchema>;
export type SubscriptionUpdateRequestSchemaDTO = Static<typeof SubscriptionUpdateRequestSchema>;
export type SubscriptionPatchRequestSchemaDTO = Static<typeof SubscriptionPatchRequestSchema>;
