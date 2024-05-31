import { SessionHeaderAuthenticationHook } from '@commercetools/connect-payments-sdk';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  PaymentIntentResponseSchema,
  PaymentIntentResponseSchemaDTO,
  PaymentRequestSchema,
  PaymentRequestSchemaDTO,
  PaymentResponseSchema,
  PaymentResponseSchemaDTO,
} from '../dtos/mock-payment.dto';
import { StripePaymentService } from '../services/stripe-payment.service';

type PaymentRoutesOptions = {
  paymentService: StripePaymentService;
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
};

export const paymentRoutes = async (fastify: FastifyInstance, opts: FastifyPluginOptions & PaymentRoutesOptions) => {
  fastify.post<{ Body: PaymentRequestSchemaDTO; Reply: PaymentResponseSchemaDTO }>(
    '/payments',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        body: PaymentRequestSchema,
        response: {
          200: PaymentResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const resp = await opts.paymentService.createPayment({
        data: request.body,
      });

      return reply.status(200).send(resp);
    },
  );
  fastify.get<{ Reply: PaymentIntentResponseSchemaDTO }>(
    '/getPaymentIntent',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        response: {
          200: PaymentIntentResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const resp = await opts.paymentService.getPaymentIntent();

      return reply.status(200).send(resp);
    },
  );
};
