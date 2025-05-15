import { SessionHeaderAuthenticationHook } from '@commercetools/connect-payments-sdk';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { Type } from '@sinclair/typebox';
import { StripeSubscriptionService } from '../services/stripe-subscription.service';
import { ConfirmSubscriptionRequestSchema, ConfirmSubscriptionRequestSchemaDTO } from '../dtos/stripe-payment.dto';

type SubscriptionRoutesOptions = {
  subscriptionService: StripeSubscriptionService;
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
};

export const subscriptionRoutes = async (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & SubscriptionRoutesOptions,
) => {
  fastify.post<{ Reply: void }>(
    '/subscription',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
    },
    async (_, reply) => {
      const res = await opts.subscriptionService.createSubscription();
      return reply.status(200).send(res);
    },
  );
  fastify.post<{ Reply: void; Body: { setupIntentId: string } }>(
    '/subscription/withSetupIntent',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        body: {
          type: 'object',
          properties: {
            setupIntentId: Type.String(),
          },
          required: ['setupIntentId'],
        },
      },
    },
    async (req, reply) => {
      const { setupIntentId } = req.body;
      const res = await opts.subscriptionService.createSubscriptionFromSetupIntent(setupIntentId);
      return reply.status(200).send(res);
    },
  );
  fastify.post<{
    Reply: void;
    Body: ConfirmSubscriptionRequestSchemaDTO;
  }>(
    '/subscription/confirm',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        body: {
          type: 'object',
          properties: ConfirmSubscriptionRequestSchema.properties,
          required: ['subscriptionId', 'paymentReference'],
        },
      },
    },
    async (req, reply) => {
      const res = await opts.subscriptionService.confirmSubscriptionPayment(req.body);
      return reply.status(200).send(res);
    },
  );
};
