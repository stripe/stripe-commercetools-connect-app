import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  ShippingMethodsRequestSchema,
  ShippingMethodsRequestSchemaDTO,
  ShippingMethodsResponseSchema,
  ShippingMethodsResponseSchemaDTO,
  ShippingUpdateRequestSchema,
  ShippingUpdateRequestSchemaDTO,
} from '../dtos/operations/shipping.dto';
import { Type } from '@sinclair/typebox';
import { log } from '../libs/logger';
import { StripeShippingService } from '../services/stripe-shipping.service';
import { SessionHeaderAuthenticationHook } from '@commercetools/connect-payments-sdk';

type StripeShippingRouteOptions = {
  shippingMethodsService: StripeShippingService;
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
};

/** The `400: Type.Object({})` response these routes declare. Named so the handlers can send it
 *  without casting, which is what the `as any` was standing in for. */
type EmptyErrorBody = Record<string, never>;

export const stripeShippingRoute = async (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & StripeShippingRouteOptions,
) => {
  fastify.post<{
    Body: ShippingMethodsRequestSchemaDTO;
    Reply: ShippingMethodsResponseSchemaDTO | EmptyErrorBody;
  }>(
    '/shipping-methods',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        body: ShippingMethodsRequestSchema,
        response: {
          200: ShippingMethodsResponseSchema,
          400: Type.Object({}),
        },
      },
    },
    async (request, reply) => {
      try {
        const response = await opts.shippingMethodsService.getShippingMethods(request.body);
        return reply.status(200).send(response);
      } catch (error) {
        log.error(`Error fetching shipping methods: ${error}`);
        return reply.status(400).send({});
      }
    },
  );
  fastify.post<{
    Body: ShippingUpdateRequestSchemaDTO;
    Reply: ShippingMethodsResponseSchemaDTO | EmptyErrorBody;
  }>(
    '/shipping-methods/update',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        body: ShippingUpdateRequestSchema,
        response: {
          200: ShippingMethodsResponseSchema,
          400: Type.Object({}),
        },
      },
    },
    async (request, reply) => {
      try {
        const response = await opts.shippingMethodsService.updateShippingRate(request.body);
        return reply.status(200).send(response);
      } catch (error) {
        log.error(`Error updating shipping rate: ${error}`);
        return reply.status(400).send({});
      }
    },
  );
  fastify.get<{
    Reply: ShippingMethodsResponseSchemaDTO | EmptyErrorBody;
  }>(
    '/shipping-methods/remove',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        response: {
          200: ShippingMethodsResponseSchema,
          400: Type.Object({}),
        },
      },
    },
    async (_, reply) => {
      try {
        const response = await opts.shippingMethodsService.removeShippingRate();
        return reply.status(200).send(response);
      } catch (error) {
        log.error(`Error removing shipping rate: ${error}`);
        return reply.status(400).send({});
      }
    },
  );
};
