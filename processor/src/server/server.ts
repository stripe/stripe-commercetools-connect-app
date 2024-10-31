import autoLoad from '@fastify/autoload';
import cors from '@fastify/cors';
import fastifyFormBody from '@fastify/formbody';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { join } from 'path';
import { config } from '../config/config';
import { requestContextPlugin } from '../libs/fastify/context/context';
import { errorHandler } from '../libs/fastify/error-handler';
const rawBody = import('fastify-raw-body');

/**
 * Setup Fastify server instance
 * @returns
 */
export const setupFastify = async () => {
  // Create fastify server instance
  const server = Fastify({
    logger: {
      level: config.loggerLevel,
    },
    genReqId: () => randomUUID().toString(),
    requestIdLogLabel: 'requestId',
    requestIdHeader: 'x-request-id',
  });

  // Config raw body for webhooks routes
  await server.register(rawBody, {
    field: 'rawBody', // change the default request.rawBody property name
    global: false, // add the rawBody to every request. **Default true**
    encoding: false, // set it to false to set rawBody as a Buffer **Default utf8**
    runFirst: true, // get the body before any preParsing hook change/uncompress it. **Default false**
    routes: ['/stripe/webhooks'], // array of routes, **`global`** will be ignored, wildcard routes not supported
  });

  // Setup error handler
  server.setErrorHandler(errorHandler);

  // Enable CORS
  await server.register(cors, {
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'X-Request-ID', 'X-Session-ID'],
    origin: '*',
  });

  // Add content type parser for the content type application/x-www-form-urlencoded
  await server.register(fastifyFormBody);

  // Register context plugin
  await server.register(requestContextPlugin);

  await server.register(autoLoad, {
    dir: join(__dirname, 'plugins'),
  });

  return server;
};
