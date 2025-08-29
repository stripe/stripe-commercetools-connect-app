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
import { StripeEvent, StripeSubscriptionEvent } from '../services/types/stripe-payment.type';
import { isFromSubscriptionInvoice, isEventRefund } from '../utils';
import { StripeSubscriptionService } from '../services/stripe-subscription.service';

type PaymentRoutesOptions = {
  paymentService: StripePaymentService;
  subscriptionService: StripeSubscriptionService;
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
};

type StripeRoutesOptions = {
  paymentService: StripePaymentService;
  subscriptionService: StripeSubscriptionService;
  stripeHeaderAuthHook: StripeHeaderAuthHook;
};

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
    async (_, reply) => {
      const resp = await opts.paymentService.createPaymentIntent();
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
  fastify.post<{ Body: string }>(
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
      } catch (error) {
        const err = error as Error;
        log.error(JSON.stringify(err));
        return reply.status(400).send(`Webhook Error: ${err.message}`);
      }

      switch (event.type) {
        case StripeEvent.PAYMENT_INTENT__REQUIRED_ACTION:
        case StripeEvent.CHARGE__CAPTURED:
          log.info(`Received: ${event.type} event of ${event.data.object.id}`);
          break;
        case StripeEvent.PAYMENT_INTENT__SUCCEEDED:
        case StripeEvent.PAYMENT_INTENT__CANCELED:
        case StripeEvent.PAYMENT_INTENT__PAYMENT_FAILED:
        case StripeEvent.CHARGE__REFUNDED:
        case StripeEvent.CHARGE__SUCCEEDED:
          if (!isFromSubscriptionInvoice(event)) {
            log.info(`Processing Stripe payment event: ${event.type}`);
            await opts.paymentService.processStripeEvent(event);
          } else if (isEventRefund(event)) {
            log.info(`--->>> This Stripe event is from a subscription invoice refund or charge: ${event.type}`);
            await opts.subscriptionService.processSubscriptionEventChargedRefund(event);
          } else {
            log.info(`--->>> This Stripe event is from a subscription invoice: ${event.type}`);
          }
          break;
        case StripeSubscriptionEvent.INVOICE_PAID:
          log.info(`Processing Stripe Subscription event: ${event.type}`);
          await opts.subscriptionService.processSubscriptionEventPaid(event);
          break;
        case StripeSubscriptionEvent.INVOICE_PAYMENT_FAILED:
          log.info(`Processing Stripe Subscription event: ${event.type}`);
          await opts.subscriptionService.processSubscriptionEventFailed(event);
          break;
        case StripeSubscriptionEvent.INVOICE_UPCOMING:
          log.info(`Processing Stripe Subscription event: ${event.type}`);
          await opts.subscriptionService.processSubscriptionEventUpcoming(event);
          break;
        default:
          log.info(`--->>> This Stripe event is not supported: ${event.type}`);
          break;
      }

      return reply.status(200).send();
    },
  );
};

export const configElementRoutes = async (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & PaymentRoutesOptions,
) => {
  fastify.get<{ Reply: ConfigElementResponseSchemaDTO; Params: { payment: string } }>(
    '/config-element/:payment',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        params: {
          $id: 'paramsSchema',
          type: 'object',
          properties: {
            payment: Type.String(),
          },
          required: ['payment'],
        },
        response: {
          200: ConfigElementResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { payment } = request.params; // paymentReference
      const resp = await opts.paymentService.initializeCartPayment(payment);

      return reply.status(200).send(resp);
    },
  );
  fastify.get<{ Reply: string }>('/applePayConfig', async (request, reply) => {
    const resp = opts.paymentService.applePayConfig();
    return reply.status(200).send(resp);
  });
};
