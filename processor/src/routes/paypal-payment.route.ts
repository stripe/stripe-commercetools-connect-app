import { SessionHeaderAuthenticationHook } from '@commercetools/connect-payments-sdk';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  PayPalCaptureResponseSchema,
  PayPalCaptureResponseSchemaDTO,
  PayPalConfigResponseSchema,
  PayPalConfigResponseSchemaDTO,
} from '../dtos/paypal-payment.dto';
import { PayPalPaymentService } from '../services/paypal-payment.service';

type PayPalRoutesOptions = {
  paypalService: PayPalPaymentService;
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
};

export const paypalPaymentRoutes = async (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & PayPalRoutesOptions,
) => {
  // GET /paypal/config - Get PayPal configuration for frontend
  fastify.get<{ Reply: PayPalConfigResponseSchemaDTO }>(
    '/paypal/config',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        response: {
          200: PayPalConfigResponseSchema,
        },
      },
    },
    async (_, reply) => {
      const config = await opts.paypalService.config();
      return reply.status(200).send(config);
    },
  );

  // POST /paypal/orders/:orderId/capture - Record a captured PayPal order in commercetools
  // Note: PayPal order creation and capture happens client-side via PayPal SDK actions
  fastify.post<{
    Params: { orderId: string };
    Reply: PayPalCaptureResponseSchemaDTO;
  }>(
    '/paypal/orders/:orderId/capture',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        params: {
          $id: 'paypalCaptureParams',
          type: 'object',
          properties: {
            orderId: Type.String(),
          },
          required: ['orderId'],
        },
        response: {
          200: PayPalCaptureResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { orderId } = request.params;
      const result = await opts.paypalService.capturePayPalOrder(orderId);
      return reply.status(200).send(result);
    },
  );
};
