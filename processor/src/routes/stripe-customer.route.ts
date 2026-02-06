import { SessionHeaderAuthenticationHook } from '@commercetools/connect-payments-sdk';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { CustomerResponseSchema, CustomerResponseSchemaDTO } from '../dtos/stripe-payment.dto';
import { Type } from '@sinclair/typebox';
import { StripeCustomerService } from '../services/stripe-customer.service';

type CustomerRoutesOptions = {
  customerService: StripeCustomerService;
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
};

export const customerRoutes = async (fastify: FastifyInstance, opts: FastifyPluginOptions & CustomerRoutesOptions) => {
  fastify.get<{ Querystring: { stripeCustomerId?: string }; Reply: CustomerResponseSchemaDTO | null }>(
    '/customer/session',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            stripeCustomerId: Type.Optional(Type.String()),
          },
        },
        response: {
          200: CustomerResponseSchema,
          204: Type.Null(),
        },
      },
    },
    async (request, reply) => {
      const { stripeCustomerId } = request.query;
      const resp = await opts.customerService.getCustomerSession(stripeCustomerId);
      if (!resp) {
        return reply.status(204).send(null as any);
      }
      return reply.status(200).send(resp);
    },
  );
};
