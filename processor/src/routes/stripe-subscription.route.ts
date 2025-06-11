import {
  Oauth2AuthenticationHook,
  SessionHeaderAuthenticationHook,
  AuthorityAuthorizationHook,
} from '@commercetools/connect-payments-sdk';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { Type } from '@sinclair/typebox';
import { StripeSubscriptionService } from '../services/stripe-subscription.service';
import {
  ConfirmSubscriptionRequestSchema,
  ConfirmSubscriptionRequestSchemaDTO,
  SetupIntentResponseSchemaDTO,
  SubscriptionFromSetupIntentResponseSchemaDTO,
  SubscriptionResponseSchemaDTO,
  SubscriptionListResponseSchema,
  SubscriptionListResponseSchemaDTO,
  SubscriptionModifyResponseSchemaDTO,
  SubscriptionModifyResponseSchema,
  SubscriptionOutcome,
  SubscriptionUpdateRequestSchemaDTO,
  SubscriptionUpdateRequestSchema,
} from '../dtos/stripe-payment.dto';
import { PaymentModificationStatus } from '../dtos/operations/payment-intents.dto';

type SubscriptionRoutesOptions = {
  subscriptionService: StripeSubscriptionService;
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
  oauth2AuthHook: Oauth2AuthenticationHook;
  authorizationHook: AuthorityAuthorizationHook;
};

export const subscriptionRoutes = async (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & SubscriptionRoutesOptions,
) => {
  fastify.post<{ Reply: SetupIntentResponseSchemaDTO }>(
    '/setupIntent',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
    },
    async (_, reply) => {
      const res = await opts.subscriptionService.createSetupIntent();
      return reply.status(200).send(res);
    },
  );
  fastify.post<{ Reply: SubscriptionResponseSchemaDTO }>(
    '/subscription',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
    },
    async (_, reply) => {
      const res = await opts.subscriptionService.createSubscription();
      return reply.status(200).send(res);
    },
  );
  fastify.post<{ Reply: SubscriptionFromSetupIntentResponseSchemaDTO; Body: { setupIntentId: string } }>(
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
      try {
        await opts.subscriptionService.confirmSubscriptionPayment(req.body);
        return reply.status(200).send({ outcome: PaymentModificationStatus.APPROVED });
      } catch (error) {
        return reply.status(400).send({ outcome: PaymentModificationStatus.REJECTED, error: JSON.stringify(error) });
      }
    },
  );

  fastify.get<{ Reply: SubscriptionListResponseSchemaDTO; Params: { customerId: string } }>(
    '/subscription-api/:customerId',
    {
      preHandler: [opts.oauth2AuthHook.authenticate()],
      schema: {
        params: {
          $id: 'paramsSchema',
          type: 'object',
          properties: {
            customerId: Type.String(),
          },
          required: ['customerId'],
        },
        response: {
          200: SubscriptionListResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { customerId: commerceToolsCustomerId } = request.params;

        if (!commerceToolsCustomerId) {
          return reply.status(401).send({
            subscriptions: [],
            error: 'No customer ID found in request parameters',
          });
        }

        const subscriptions = await opts.subscriptionService.getCustomerSubscriptions(commerceToolsCustomerId);
        return reply.status(200).send({ subscriptions });
      } catch (error) {
        return reply.status(400).send({
          subscriptions: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  fastify.delete<{
    Reply: SubscriptionModifyResponseSchemaDTO;
    Params: { customerId: string; subscriptionId: string };
  }>(
    '/subscription-api/:customerId/:subscriptionId',
    {
      preHandler: [
        opts.oauth2AuthHook.authenticate(),
        opts.authorizationHook.authorize('manage_project', 'manage_subscriptions'),
      ],
      schema: {
        params: {
          $id: 'paramsSchema',
          type: 'object',
          properties: {
            customerId: Type.String(),
            subscriptionId: Type.String(),
          },
          required: ['customerId', 'subscriptionId'],
        },
        response: {
          200: SubscriptionModifyResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { customerId, subscriptionId } = request.params;
      try {
        const result = await opts.subscriptionService.cancelSubscription({ customerId, subscriptionId });
        return reply.status(200).send({
          id: result.id,
          status: result.status,
          outcome: result.outcome,
          message: result.message,
        });
      } catch (error) {
        return reply.status(400).send({
          id: subscriptionId,
          status: 'failed',
          message: error instanceof Error ? error.message : 'Unknown error',
          outcome: SubscriptionOutcome.ERROR,
        });
      }
    },
  );

  fastify.post<{
    Reply: SubscriptionModifyResponseSchemaDTO;
    Params: { customerId: string };
    Body: SubscriptionUpdateRequestSchemaDTO;
  }>(
    '/subscription-api/:customerId',
    {
      preHandler: [
        opts.oauth2AuthHook.authenticate(),
        opts.authorizationHook.authorize('manage_project', 'manage_subscriptions'),
      ],
      schema: {
        params: {
          type: 'object',
          properties: {
            customerId: Type.String(),
          },
          required: ['customerId'],
        },
        body: SubscriptionUpdateRequestSchema,
        response: {
          200: SubscriptionModifyResponseSchema, // Reuse existing response schema
        },
      },
    },
    async (request, reply) => {
      const { customerId } = request.params;
      try {
        const result = await opts.subscriptionService.updateSubscription({
          customerId,
          subscriptionId: request.body.id,
          params: request.body.params,
          options: request.body.options,
        });

        return reply.status(200).send({
          id: result.id,
          status: result.status,
          outcome: SubscriptionOutcome.UPDATED,
          message: `Subscription ${request.body.id} has been successfully updated.`,
        });
      } catch (error) {
        return reply.status(400).send({
          id: request.body.id,
          status: 'failed',
          message: error instanceof Error ? error.message : 'Unknown error',
          outcome: SubscriptionOutcome.ERROR,
        });
      }
    },
  );
};
