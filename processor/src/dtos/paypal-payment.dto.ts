import { Static, Type } from '@sinclair/typebox';

export const PayPalOrderResponseSchema = Type.Object({
  orderId: Type.String(),
  status: Type.String(),
});

export const PayPalCaptureResponseSchema = Type.Object({
  orderId: Type.String(),
  status: Type.String(),
  captureId: Type.Optional(Type.String()),
  paymentReference: Type.Optional(Type.String()),
});

export const PayPalConfigResponseSchema = Type.Object({
  clientId: Type.String(),
  environment: Type.Union([Type.Literal('sandbox'), Type.Literal('live')]),
  currency: Type.String(),
  amount: Type.Number(),
});

export const PayPalCaptureRequestSchema = Type.Object({
  orderId: Type.String(),
});

export type PayPalOrderResponseSchemaDTO = Static<typeof PayPalOrderResponseSchema>;
export type PayPalCaptureResponseSchemaDTO = Static<typeof PayPalCaptureResponseSchema>;
export type PayPalConfigResponseSchemaDTO = Static<typeof PayPalConfigResponseSchema>;
export type PayPalCaptureRequestSchemaDTO = Static<typeof PayPalCaptureRequestSchema>;
