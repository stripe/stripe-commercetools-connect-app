import { Static, Type } from '@sinclair/typebox';

const DropinType = Type.Enum({
  EMBEDDED: 'embedded',
  HPP: 'hpp',
});

export const SupportedPaymentDropinsData = Type.Object({
  type: DropinType,
});

export const SupportedPaymentComponentsData = Type.Object({
  type: Type.String(),
  subtypes: Type.Optional(Type.Array(Type.String())),
});

/**
 * Supported payment components schema.
 *
 * Example:
 * {
 *   "dropins": [
 *     {
 *       "type": "embedded"
 *     }
 *   ],
 *   "components": [
 *     {
 *       "type": "card"
 *     },
 *     {
 *       "type": "applepay"
 *     }
 *   ]
 * }
 */
export const SupportedPaymentComponentsSchema = Type.Object({
  dropins: Type.Array(SupportedPaymentDropinsData),
  components: Type.Array(SupportedPaymentComponentsData),
});

export enum PaymentComponentsSupported {
  PAYMENT_ELEMENT = 'payment',
  EMBEDDED = 'embedded',
}

export type SupportedPaymentComponentsSchemaDTO = Static<typeof SupportedPaymentComponentsSchema>;
