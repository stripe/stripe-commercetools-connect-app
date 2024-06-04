import fastify from 'fastify';
import { describe, beforeAll, afterAll, test, expect, jest, afterEach } from '@jest/globals';
import {
  AuthorityAuthorizationHook,
  AuthorityAuthorizationManager,
  CommercetoolsCartService,
  CommercetoolsPaymentService,
  ContextProvider,
  JWTAuthenticationHook,
  JWTAuthenticationManager,
  Oauth2AuthenticationHook,
  Oauth2AuthenticationManager,
  RequestContextData,
  SessionHeaderAuthenticationHook,
  SessionHeaderAuthenticationManager,
} from '@commercetools/connect-payments-sdk';
import { IncomingHttpHeaders } from 'node:http';
import { operationsRoute } from '../../src/routes/operation.route';
import { StripePaymentService } from '../../src/services/stripe-payment.service';

describe('/operations APIs', () => {
  const app = fastify({ logger: false });
  const token = 'token';
  const jwtToken = 'jwtToken';
  const sessionId = 'session-id';

  const spyAuthenticateJWT = jest
    .spyOn(JWTAuthenticationHook.prototype, 'authenticate')
    .mockImplementationOnce(() => async (request: { headers: IncomingHttpHeaders }) => {
      expect(request.headers['authorization']).toContain(`Bearer ${jwtToken}`);
    });

  const spyAuthenticateOauth2 = jest
    .spyOn(Oauth2AuthenticationHook.prototype, 'authenticate')
    .mockImplementationOnce(() => async (request: { headers: IncomingHttpHeaders }) => {
      expect(request.headers['authorization']).toContain(`Bearer ${token}`);
    });

  const spyAuthenticateSession = jest
    .spyOn(SessionHeaderAuthenticationHook.prototype, 'authenticate')
    .mockImplementationOnce(() => async (request: { headers: IncomingHttpHeaders }) => {
      expect(request.headers['x-session-id']).toContain('session-id');
    });

  const spiedJwtAuthenticationHook = new JWTAuthenticationHook({
    authenticationManager: jest.fn() as unknown as JWTAuthenticationManager,
    contextProvider: jest.fn() as unknown as ContextProvider<RequestContextData>,
  });

  const spiedOauth2AuthenticationHook = new Oauth2AuthenticationHook({
    authenticationManager: jest.fn() as unknown as Oauth2AuthenticationManager,
    contextProvider: jest.fn() as unknown as ContextProvider<RequestContextData>,
  });

  const spiedSessionHeaderAuthenticationHook = new SessionHeaderAuthenticationHook({
    authenticationManager: jest.fn() as unknown as SessionHeaderAuthenticationManager,
    contextProvider: jest.fn() as unknown as ContextProvider<RequestContextData>,
  });

  const spiedAuthorityAuthorizationHook = new AuthorityAuthorizationHook({
    authorizationManager: jest.fn() as unknown as AuthorityAuthorizationManager,
    contextProvider: jest.fn() as unknown as ContextProvider<RequestContextData>,
  });

  const spiedPaymentService = new StripePaymentService({
    ctCartService: jest.fn() as unknown as CommercetoolsCartService,
    ctPaymentService: jest.fn() as unknown as CommercetoolsPaymentService,
  });

  beforeAll(async () => {
    await app.register(operationsRoute, {
      prefix: '/operations',
      oauth2AuthHook: spiedOauth2AuthenticationHook,
      jwtAuthHook: spiedJwtAuthenticationHook,
      sessionHeaderAuthHook: spiedSessionHeaderAuthenticationHook,
      authorizationHook: spiedAuthorityAuthorizationHook,
      paymentService: spiedPaymentService,
    });
  });

  afterEach(async () => {
    spyAuthenticateJWT.mockClear();
    spyAuthenticateOauth2.mockClear();
    spyAuthenticateSession.mockClear();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /operations/config', () => {
    test('it should return the Stripe client config', async () => {
      //When
      const responseGetConfig = await app.inject({
        method: 'GET',
        url: `/operations/config`,
        headers: {
          'x-session-id': sessionId,
          'content-type': 'application/json',
        },
      });

      // eslint-disable-next-line
      console.log(await responseGetConfig.json());
      //Then
      expect(responseGetConfig.statusCode).toEqual(200);
      expect(responseGetConfig.json()).toEqual({
        clientKey: 'stripeSecretKey',
        environment: 'TEST',
      });
    });

    describe('GET /operations/status', () => {
      test('it should return the status of the connector', async () => {
        //Given
        jest.spyOn(spiedPaymentService, 'status').mockResolvedValue({
          metadata: {
            name: 'payment-integration-stripe',
            description: 'Payment integration with Stripe',
          },
          version: '1.0.0',
          timestamp: '2024-01-01T00:00:00Z',
          status: 'UP',
          checks: [
            {
              name: 'CoCo Permissions',
              status: 'UP',
            },
            {
              name: 'Stripe Status check',
              status: 'UP',
            },
          ],
        });

        //When
        const responseGetStatus = await app.inject({
          method: 'GET',
          url: `/operations/status`,
          headers: {
            authorization: `Bearer ${jwtToken}`,
            'content-type': 'application/json',
          },
        });

        //Then
        expect(responseGetStatus.statusCode).toEqual(200);
        expect(responseGetStatus.json()).toEqual(
          expect.objectContaining({
            metadata: expect.any(Object),
            status: 'UP',
            timestamp: expect.any(String),
            version: '1.0.0',
            checks: expect.arrayContaining([
              expect.objectContaining({
                name: 'CoCo Permissions',
                status: 'UP',
              }),
              expect.objectContaining({
                name: 'Stripe Status check',
                status: 'UP',
              }),
            ]),
          }),
        );
      });
    });
  });
});
