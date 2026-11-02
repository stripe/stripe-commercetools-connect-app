import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import Fastify, { type FastifyInstance, FastifyError } from 'fastify';
import { errorHandler } from '../../../src/libs/fastify/error-handler';
import { ErrorAuthErrorResponse, Errorx, ErrorxAdditionalOpts } from '@commercetools/connect-payments-sdk';
import { requestContextPlugin } from '../../../src/libs/fastify/context/context';
import { FastifySchemaValidationError } from 'fastify/types/schema';
import * as Logger from '../../../src/libs/logger/index';
import { StripeApiError } from '../../../src/errors/stripe-api.error';

jest.mock('../../../src/libs/logger/index', () => ({
  log: { error: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

describe('error-handler', () => {
  let fastify: FastifyInstance;
  beforeEach(async () => {
    fastify = Fastify();
    fastify.setErrorHandler(errorHandler);
    await fastify.register(requestContextPlugin);
  });

  afterEach(async () => {
    await fastify.close();
  });

  test('errox error', async () => {
    fastify.get('/', () => {
      throw new Errorx({
        code: 'ErrorCode',
        message: 'someMessage',
        httpErrorStatus: 404,
      });
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.json()).toStrictEqual({
      message: 'someMessage',
      statusCode: 404,
      errors: [
        {
          code: 'ErrorCode',
          message: 'someMessage',
        },
      ],
    });
  });

  test('errox with fields', async () => {
    fastify.get('/', () => {
      throw new Errorx({
        code: 'ErrorCode',
        message: 'someMessage',
        httpErrorStatus: 404,
        fields: {
          test: 'field1',
        },
      });
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.json()).toStrictEqual({
      message: 'someMessage',
      statusCode: 404,
      errors: [
        {
          code: 'ErrorCode',
          message: 'someMessage',
          test: 'field1',
        },
      ],
    });
  });

  test('general error', async () => {
    fastify.get('/', () => {
      throw new Error('some message goes here');
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.json()).toStrictEqual({
      message: 'Internal server error.',
      statusCode: 500,
      errors: [
        {
          code: 'General',
          message: 'Internal server error.',
        },
      ],
    });
  });

  test('Fastify error with missing required field', async () => {
    const validationError: FastifySchemaValidationError = {
      keyword: 'required',
      instancePath: 'instancePath/domain/value',
      schemaPath: 'schemaPath/domain/value',
      params: {
        missingProperty: 'dummy-field',
      },
      message: 'fastify-error-message',
    };
    const fastifyError: FastifyError = {
      code: 'ErrorCode',
      name: 'fastify-error',
      message: 'fastify-error-message',
      validation: [validationError],
    };
    fastify.get('/', () => {
      throw fastifyError;
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
    });
    expect(response.json()).toStrictEqual({
      message: 'A value is required for field dummy-field.',
      statusCode: 400,
      errors: [
        {
          code: 'RequiredField',
          field: 'dummy-field',
          message: 'A value is required for field dummy-field.',
        },
      ],
    });
  });

  test('redacts a Stripe cause client_secret from the handler log without changing the HTTP response (SB3-237)', async () => {
    // A StripeApiError (Errorx) whose `.cause` is the raw stripe-node error reaches
    // transformErrorxToHTTPModel. The raw cause carries `client_secret` as an own-enumerable prop, so the
    // pre-fix `log.error(err.message, err)` serialized it (ErrorGeneral/Errorx expose `.cause` enumerably).
    const SENTINEL_SECRET = 'pi_SENTINEL_secret_DO_NOT_LOG';
    const stripeCause = Object.assign(new Error('Your card was declined.'), {
      type: 'StripeCardError',
      code: 'card_declined',
      statusCode: 402,
      payment_intent: { id: 'pi_123', client_secret: SENTINEL_SECRET },
      raw: { payment_intent: { id: 'pi_123', client_secret: SENTINEL_SECRET } },
    });
    const apiError = new StripeApiError(
      {
        code: 'card_declined',
        statusCode: 402,
        message: 'Your card was declined.',
        type: 'card_error',
        doc_url: 'https://stripe.com/docs/error-codes/card-declined',
        param: 'payment_method',
        requestId: 'req_abc123',
        request_log_url: '',
      },
      { cause: stripeCause, skipLog: false },
    );

    (Logger.log.error as jest.Mock).mockClear();

    fastify.get('/', () => {
      throw apiError;
    });

    const response = await fastify.inject({ method: 'GET', url: '/' });

    // The HTTP response is byte-for-byte what it was before the fix (code/httpErrorStatus path untouched).
    expect(response.statusCode).toEqual(402);
    expect(response.json()).toStrictEqual({
      message: 'Your card was declined.',
      statusCode: 402,
      errors: [
        {
          code: 'card_declined',
          message: 'Your card was declined.',
        },
      ],
    });

    // The failure is still logged...
    expect(Logger.log.error).toHaveBeenCalled();
    // ...but no log call serializes the client_secret carried by the cause.
    const loggedBlob = (Logger.log.error as jest.Mock).mock.calls.map((args) => JSON.stringify(args)).join('\n');
    expect(loggedBlob).not.toContain(SENTINEL_SECRET);

    // ...and the safe cause classification is still surfaced for diagnosis.
    const sinkCall = (Logger.log.error as jest.Mock).mock.calls[0] as [string, Record<string, unknown>];
    expect(sinkCall[0]).toBe('Your card was declined.');
    const cause = sinkCall[1].cause as Record<string, unknown>;
    expect(cause.code).toBe('card_declined');
    expect(cause).not.toHaveProperty('payment_intent');
    expect(cause).not.toHaveProperty('raw');

    // The live error / cause is NOT mutated.
    expect(stripeCause.payment_intent.client_secret).toBe(SENTINEL_SECRET);
  });

  test('ErrorAuthErrorResponse', async () => {
    const opts: ErrorxAdditionalOpts = {
      privateFields: {},
      privateMessage: '',
      fields: {},
      skipLog: true,
      cause: undefined,
    };
    const authErrorResponse: ErrorAuthErrorResponse = new ErrorAuthErrorResponse('someMessage', opts, '401');

    fastify.get('/', () => {
      throw authErrorResponse;
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
    });
    expect(response.json()).toStrictEqual({
      message: 'someMessage',
      statusCode: 401,
      errors: [
        {
          code: '401',
          message: 'someMessage',
        },
      ],
      error: '401',
      error_description: 'someMessage',
    });
  });
});
