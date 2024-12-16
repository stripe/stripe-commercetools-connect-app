import Stripe from 'stripe';
import { SessionHeaderAuthenticationHook } from '@commercetools/connect-payments-sdk';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  ConfigElementResponseSchema,
  ConfigElementResponseSchemaDTO,
  PaymentResponseSchema,
  PaymentResponseSchemaDTO,
} from '../dtos/stripe-payment.dto';
import { log } from '../libs/logger';
import { stripeApi } from '../clients/stripe.client';
import { StripePaymentService } from '../services/stripe-payment.service';
import { StripeHeaderAuthHook } from '../libs/fastify/hooks/stripe-header-auth.hook';
import { Type } from '@sinclair/typebox';
import { getConfig } from '../config/config';
import {
  PaymentIntenConfirmRequestSchemaDTO,
  PaymentIntentConfirmRequestSchema,
  PaymentIntentConfirmResponseSchemaDTO,
  PaymentIntentResponseSchema,
  PaymentModificationStatus,
} from '../dtos/operations/payment-intents.dto';

type PaymentRoutesOptions = {
  paymentService: StripePaymentService;
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
};

type StripeRoutesOptions = {
  paymentService: StripePaymentService;
  stripeHeaderAuthHook: StripeHeaderAuthHook;
};

/**
 * MVP if additional information needs to be included in the payment intent, this method should be supplied with the necessary data.
 *
 */
export const paymentRoutes = async (fastify: FastifyInstance, opts: FastifyPluginOptions & PaymentRoutesOptions) => {
  fastify.get<{ Reply: PaymentResponseSchemaDTO }>(
    '/payments',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        response: {
          200: PaymentResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const resp = await opts.paymentService.createPaymentIntentStripe();

      return reply.status(200).send(resp);
    },
  );
  fastify.post<{
    Body: PaymentIntenConfirmRequestSchemaDTO;
    Reply: PaymentIntentConfirmResponseSchemaDTO;
    Params: { id: string };
  }>(
    '/confirmPayments/:id',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        params: {
          $id: 'paramsSchema',
          type: 'object',
          properties: {
            id: Type.String(),
          },
          required: ['id'],
        },
        body: PaymentIntentConfirmRequestSchema,
        response: {
          200: PaymentIntentResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params; // paymentReference
      try {
        await opts.paymentService.updatePaymentIntentStripeSuccessful(request.body.paymentIntent, id);

        return reply.status(200).send({ outcome: PaymentModificationStatus.APPROVED });
      } catch (error) {
        return reply.status(400).send({ outcome: PaymentModificationStatus.REJECTED, error: JSON.stringify(error) });
      }
    },
  );
};

export const stripeWebhooksRoutes = async (fastify: FastifyInstance, opts: StripeRoutesOptions) => {
  fastify.post<{ Body: string; Reply: any }>(
    '/stripe/webhooks',
    {
      preHandler: [opts.stripeHeaderAuthHook.authenticate()],
      config: { rawBody: true },
    },
    async (request, reply) => {
      const signature = request.headers['stripe-signature'] as string;

      let event: Stripe.Event;

      try {
        event = await stripeApi().webhooks.constructEvent(
          request.rawBody as string,
          signature,
          getConfig().stripeWebhookSigningSecret,
        );
      } catch (err: any) {
        log.error(JSON.stringify(err));
        return reply.status(400).send(`Webhook Error: ${err.message}`);
      }

      switch (event.type) {
        case 'charge.succeeded':
        case 'charge.captured':
          log.info(`Received: ${event.type} event of ${event.data.object.id}`);
          break;
        default:
          log.info(`--->>> This Stripe event is not supported: ${event.type}`);
          break;
      }

      await opts.paymentService.processStripeEvent(event);

      return reply.status(200).send();
    },
  );
};

export const configElementRoutes = async (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & PaymentRoutesOptions,
) => {
  fastify.get<{ Reply: ConfigElementResponseSchemaDTO; Params: { paymentComponent: string } }>(
    '/config-element/:paymentComponent',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        params: {
          $id: 'paramsSchema',
          type: 'object',
          properties: {
            paymentComponent: Type.String(),
          },
          required: ['paymentComponent'],
        },
        response: {
          200: ConfigElementResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { paymentComponent } = request.params;
      const resp = await opts.paymentService.initializeCartPayment(paymentComponent);

      return reply.status(200).send(resp);
    },
  );
};
