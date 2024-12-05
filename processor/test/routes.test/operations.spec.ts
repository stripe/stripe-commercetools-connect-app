import fastify from 'fastify';
import { describe, beforeAll, afterAll, test, expect, jest, afterEach } from '@jest/globals';
import {
  AuthorityAuthorizationHook,
  AuthorityAuthorizationManager,
  CommercetoolsCartService,
  CommercetoolsOrderService,
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
import { mockRoute__paymentIntent_succeed, mockRoute__paymentsComponents_succeed } from '../utils/mock-routes-data';
import { appLogger } from '../../src/payment-sdk';

describe('/operations APIs', () => {
  const app = fastify({ logger: false });
  const token = 'token';
  const jwtToken = 'jwtToken';
  const sessionId = 'session-id';

  const spyAuthenticateJWT = jest
    .spyOn(JWTAuthenticationHook.prototype, 'authenticate')
    .mockImplementation(() => async (request: { headers: IncomingHttpHeaders }) => {
      expect(request.headers['authorization']).toContain(`Bearer ${jwtToken}`);
    });

  const spyAuthenticateOauth2 = jest
    .spyOn(Oauth2AuthenticationHook.prototype, 'authenticate')
    .mockImplementation(() => async (request: { headers: IncomingHttpHeaders }) => {
      expect(request.headers['authorization']).toContain(`Bearer ${token}`);
    });

  const spyAuthenticateSession = jest
    .spyOn(SessionHeaderAuthenticationHook.prototype, 'authenticate')
    .mockImplementationOnce(() => async (request: { headers: IncomingHttpHeaders }) => {
      expect(request.headers['x-session-id']).toContain('session-id');
    });

  const spyAuthenticateAuthority = jest
    .spyOn(AuthorityAuthorizationHook.prototype, 'authorize')
    .mockImplementation(() => async () => {
      expect('manage_project').toEqual('manage_project');
    });

  const spiedJwtAuthenticationHook = new JWTAuthenticationHook({
    logger: appLogger,
    authenticationManager: jest.fn() as unknown as JWTAuthenticationManager,
    contextProvider: jest.fn() as unknown as ContextProvider<RequestContextData>,
  });

  const spiedOauth2AuthenticationHook = new Oauth2AuthenticationHook({
    logger: appLogger,
    authenticationManager: jest.fn() as unknown as Oauth2AuthenticationManager,
    contextProvider: jest.fn() as unknown as ContextProvider<RequestContextData>,
  });

  const spiedSessionHeaderAuthenticationHook = new SessionHeaderAuthenticationHook({
    logger: appLogger,
    authenticationManager: jest.fn() as unknown as SessionHeaderAuthenticationManager,
    contextProvider: jest.fn() as unknown as ContextProvider<RequestContextData>,
  });

  const spiedAuthorityAuthorizationHook = new AuthorityAuthorizationHook({
    logger: appLogger,
    authorizationManager: jest.fn() as unknown as AuthorityAuthorizationManager,
    contextProvider: jest.fn() as unknown as ContextProvider<RequestContextData>,
  });

  const spiedPaymentService = new StripePaymentService({
    ctCartService: jest.fn() as unknown as CommercetoolsCartService,
    ctPaymentService: jest.fn() as unknown as CommercetoolsPaymentService,
    ctOrderService: jest.fn() as unknown as CommercetoolsOrderService,
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
    jest.clearAllMocks();
    spyAuthenticateJWT.mockClear();
    spyAuthenticateOauth2.mockClear();
    spyAuthenticateSession.mockClear();
    spyAuthenticateAuthority.mockClear();
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

      //Then
      expect(responseGetConfig.statusCode).toEqual(200);
      expect(responseGetConfig.json()).toEqual({
        environment: 'TEST',
        publishableKey: '',
      });
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

  describe('GET /payment-components', () => {
    test('it should return the supported payment components ', async () => {
      //Given
      jest
        .spyOn(spiedPaymentService, 'getSupportedPaymentComponents')
        .mockResolvedValue(mockRoute__paymentsComponents_succeed);

      //When
      const responseGetStatus = await app.inject({
        method: 'GET',
        url: `/operations/payment-components`,
        headers: {
          authorization: `Bearer ${jwtToken}`,
          'content-type': 'application/json',
        },
      });

      //Then
      expect(responseGetStatus.statusCode).toEqual(200);
      expect(responseGetStatus.json()).toEqual(mockRoute__paymentsComponents_succeed);
    });
  });

  describe('POST /payment-intents/:id', () => {
    test('it should return the payment intent capturePayment response ', async () => {
      //Given
      const optsMock = {
        actions: [
          {
            action: 'capturePayment',
            amount: {
              centAmount: 1000,
              currencyCode: 'USD',
            },
          },
        ],
      };
      jest.spyOn(spiedPaymentService, 'modifyPayment').mockResolvedValue(mockRoute__paymentIntent_succeed);

      //When
      const responseGetStatus = await app.inject({
        method: 'POST',
        url: `/operations/payment-intents/`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: optsMock,
      });

      //Then
      expect(responseGetStatus.statusCode).toEqual(200);
      expect(responseGetStatus.json()).toEqual(mockRoute__paymentIntent_succeed);
    });
  });
});
