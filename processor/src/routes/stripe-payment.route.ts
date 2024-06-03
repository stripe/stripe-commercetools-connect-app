import Stripe from 'stripe';
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
import { log } from '../libs/logger/index';
import { stripeApi } from '../clients/stripe.client';
import { getConfig } from '../config/config';
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

export const stripeWebhooksRoutes = async (fastify: FastifyInstance, opts: PaymentRoutesOptions) => {
  fastify.post<{ Body: string; Reply: any }>(
    '/stripe/webhooks',
    { config: { rawBody: true } },
    async (request, reply) => {
      const signature = request.headers['stripe-signature'] as string;
      let event: Stripe.Event;

      try {
        event = await stripeApi().webhooks.constructEvent(
          request.rawBody as string,
          signature,
          getConfig().stripeWebhookSecret,
        );
      } catch (err: any) {
        log.error(JSON.stringify(err));
        return reply.status(400).send(`Webhook Error: ${err.message}`);
      }

      switch (event.type) {
        case 'payment_intent.payment_failed':
          // Payment intent has failed
          log.info('--->>> payment_intent.payment_failed');
          break;
        case 'payment_intent.succeeded':
          // The payment has been captured
          log.info('--->>> payment_intent.succeeded');
          break;
        case 'payment_intent.amount_capturable_updated':
          // The payment is ready for capture
          log.info(`Handle ${event.type} event of payment_intent[${event.data.object.id}]`);

          opts.paymentService.setAuthorizationSuccessPayment(event);
          break;
        default:
          // This event is not supported
          log.info(`--->>> This Stripe event is not supported: ${event.type}`);
          break;
      }

      return reply.status(200).send();
    },
  );
};
