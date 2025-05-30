import Stripe from 'stripe';
import fastify from 'fastify';
import { describe, beforeAll, afterAll, test, expect, jest, afterEach, beforeEach } from '@jest/globals';
import {
  AuthorityAuthorizationHook,
  AuthorityAuthorizationManager,
  CommercetoolsCartService,
  CommercetoolsOrderService,
  CommercetoolsPaymentService,
  ContextProvider,
  Oauth2AuthenticationHook,
  Oauth2AuthenticationManager,
  RequestContextData,
  SessionHeaderAuthenticationHook,
  SessionHeaderAuthenticationManager,
} from '@commercetools/connect-payments-sdk';
import { IncomingHttpHeaders } from 'node:http';
import { customerRoutes } from '../../src/routes/stripe-customer.route';
import {
  mockEvent__charge_capture_succeeded_notCaptured,
  mockRoute__customer_session_succeed,
  // mockRoute__customer_session_succeed,
} from '../utils/mock-routes-data';

import { appLogger } from '../../src/payment-sdk';
import { subscriptionRoutes } from '../../src/routes/stripe-subscription.route';
import { StripeCustomerService } from '../../src/services/stripe-customer.service';
import { StripeSubscriptionService } from '../../src/services/stripe-subscription.service';

jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: jest
        .fn<() => Stripe.Event>()
        .mockImplementation(() => mockEvent__charge_capture_succeeded_notCaptured),
    },
  })),
}));
jest.mock('../../src/services/stripe-subscription.service');
jest.mock('../../src/libs/logger/index');

describe('Stripe Subscription and Customer route APIs', () => {
  const fastifyApp = fastify({ logger: false });
  const token = 'token';
  const sessionId = 'session-id';

  const spyAuthenticateOauth2 = jest
    .spyOn(Oauth2AuthenticationHook.prototype, 'authenticate')
    .mockImplementationOnce(() => async (request: { headers: IncomingHttpHeaders }) => {
      expect(request.headers['authorization']).toContain(`Bearer ${token}`);
    });

  const spyAuthenticateSession = jest
    .spyOn(SessionHeaderAuthenticationHook.prototype, 'authenticate')
    .mockImplementation(() => async (request: { headers: IncomingHttpHeaders }) => {
      expect(request.headers['x-session-id']).toContain('session-id');
    });

  const spyAuthenticateAuthority = jest
    .spyOn(AuthorityAuthorizationHook.prototype, 'authorize')
    .mockImplementation(() => async () => {
      expect('manage_project').toEqual('manage_project');
    });

  const spiedAuthorityAuthorizationHook = new AuthorityAuthorizationHook({
    logger: appLogger,
    authorizationManager: jest.fn() as unknown as AuthorityAuthorizationManager,
    contextProvider: jest.fn() as unknown as ContextProvider<RequestContextData>,
  });

  const spiedSessionHeaderAuthenticationHook = new SessionHeaderAuthenticationHook({
    logger: appLogger,
    authenticationManager: jest.fn() as unknown as SessionHeaderAuthenticationManager,
    contextProvider: jest.fn() as unknown as ContextProvider<RequestContextData>,
  });

  const spiedOauth2AuthenticationHook = new Oauth2AuthenticationHook({
    logger: appLogger,
    authenticationManager: jest.fn() as unknown as Oauth2AuthenticationManager,
    contextProvider: jest.fn() as unknown as ContextProvider<RequestContextData>,
  });

  const spiedSubscriptionService = new StripeSubscriptionService({
    ctCartService: jest.fn() as unknown as CommercetoolsCartService,
    ctPaymentService: jest.fn() as unknown as CommercetoolsPaymentService,
    ctOrderService: jest.fn() as unknown as CommercetoolsOrderService,
  });

  const spiedCustomerService = new StripeCustomerService(jest.fn() as unknown as CommercetoolsCartService);

  const originalEnv = process.env;

  beforeAll(async () => {
    await fastifyApp.register(subscriptionRoutes, {
      prefix: '/',
      authorizationHook: spiedAuthorityAuthorizationHook,
      oauth2AuthHook: spiedOauth2AuthenticationHook,
      sessionHeaderAuthHook: spiedSessionHeaderAuthenticationHook,
      subscriptionService: spiedSubscriptionService,
    });

    await fastifyApp.register(customerRoutes, {
      prefix: '/',
      sessionHeaderAuthHook: spiedSessionHeaderAuthenticationHook,
      customerService: spiedCustomerService,
    });
  });

  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
    process.env = { ...originalEnv };
    process.env.STRIPE_WEBHOOK_SIGNING_SECRET = 'STRIPE_WEBHOOK_SIGNING_SECRET';
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    spyAuthenticateOauth2.mockClear();
    spyAuthenticateSession.mockClear();
    spyAuthenticateAuthority.mockClear();
    await fastifyApp.ready();
    process.env = originalEnv;
  });

  afterAll(async () => {
    await fastifyApp.close();
  });

  describe('GET /customer/session', () => {
    test('should call /customer/session and return valid information', async () => {
      //Given
      jest.spyOn(spiedCustomerService, 'getCustomerSession').mockResolvedValue(mockRoute__customer_session_succeed);

      //When
      const responseGetConfig = await fastifyApp.inject({
        method: 'GET',
        url: `/customer/session?customerId=customerId`,
        headers: {
          'x-session-id': sessionId,
          'content-type': 'application/json',
        },
      });

      //Then
      expect(responseGetConfig.statusCode).toEqual(200);
      expect(responseGetConfig.json()).toEqual(mockRoute__customer_session_succeed);
      expect(spiedCustomerService.getCustomerSession).toHaveBeenCalled();
    });

    test('should call /customer/session and return undefined', async () => {
      //Given
      jest.spyOn(spiedCustomerService, 'getCustomerSession').mockResolvedValue(undefined);

      //When
      const responseGetConfig = await fastifyApp.inject({
        method: 'GET',
        url: `/customer/session`,
        headers: {
          'x-session-id': sessionId,
          'content-type': 'application/json',
        },
      });

      //Then
      expect(responseGetConfig.statusCode).toEqual(204);
      expect(spiedCustomerService.getCustomerSession).toHaveBeenCalled();
    });
  });
});
