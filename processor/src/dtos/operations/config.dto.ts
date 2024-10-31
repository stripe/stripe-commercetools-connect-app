import { Static, Type } from '@sinclair/typebox';

/**
 * Public shareable payment provider configuration. Do not include any sensitive data.
 */
export const ConfigResponseSchema = Type.Any();
export const ConfigResponseSchemaStripe = Type.Object({
  clientKey: Type.String(),
  environment: Type.String(),
});

export type ConfigResponseSchemaDTO = Static<typeof ConfigResponseSchema>;
