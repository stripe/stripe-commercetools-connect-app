import { Static, Type } from '@sinclair/typebox';

/**
 * Status response schema.
 *
 * Example:
 * {
 *    "status": "OK",
 *    "timestamp": "2024-07-15T14:00:43.068Z",
 *    "version": "3.0.2",
 *    "metadata": {
 *        "name": "payment-integration-template",
 *        "description": "Payment provider integration template",
 *        "@commercetools/connect-payments-sdk": "<version>"
 *    },
 *    "checks": [
 *        {
 *            "name": "CoCo Permissions",
 *            "status": "UP"
 *        },
 *        {
 *            "name": "Mock Payment API",
 *            "status": "UP"
 *        }
 *    ]
 *  }
 *
 *
 */
export const StatusResponseSchema = Type.Object({
  status: Type.String(),
  timestamp: Type.String(),
  version: Type.String(),
  metadata: Type.Optional(Type.Any()),
  checks: Type.Array(
    Type.Object({
      name: Type.String(),
      status: Type.String(),
      details: Type.Optional(Type.Any()),
      message: Type.Optional(Type.String()),
    }),
  ),
});

export type StatusResponseSchemaDTO = Static<typeof StatusResponseSchema>;
