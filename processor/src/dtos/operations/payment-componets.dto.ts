import { Static, Type } from '@sinclair/typebox';

export const SupportedPaymentComponentsData = Type.Object({
  type: Type.String(),
});

export const SupportedPaymentComponentsSchema = Type.Object({
  components: Type.Array(SupportedPaymentComponentsData),
});

export enum PaymentComponentsSupported {
  PAYMENT_ELEMENT = 'payment',
  EXPRESS_CHECKOUT = 'expressCheckout',
}

export type SupportedPaymentComponentsSchemaDTO = Static<typeof SupportedPaymentComponentsSchema>;
