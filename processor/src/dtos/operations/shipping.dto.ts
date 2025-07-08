import { Static, Type } from '@sinclair/typebox';

export const ShippingMethodsRequestSchema = Type.Object({
  country: Type.String(),
  state: Type.Optional(Type.String()),
  city: Type.Optional(Type.String()),
  postalCode: Type.Optional(Type.String()),
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

export const ShippingUpdateRequestSchema = Type.Object({
  id: Type.String(),
  amount: Type.Optional(Type.Number()),
  displayName: Type.Optional(Type.String()),
});

export type ShippingMethodsRequestSchemaDTO = Static<typeof ShippingMethodsRequestSchema>;
export type ShippingMethodsResponseSchemaDTO = Static<typeof ShippingMethodsResponseSchema>;
export type ShippingUpdateRequestSchemaDTO = Static<typeof ShippingUpdateRequestSchema>;
