import Stripe from 'stripe';
import fastify from 'fastify';
import { describe, beforeAll, afterAll, test, expect, jest, afterEach, beforeEach } from '@jest/globals';
import {
  CommercetoolsCartService,
  CommercetoolsPaymentService,
  ContextProvider,
  JWTAuthenticationHook,
  Oauth2AuthenticationHook,
  RequestContextData,
  SessionHeaderAuthenticationHook,
  SessionHeaderAuthenticationManager,
} from '@commercetools/connect-payments-sdk';
import { IncomingHttpHeaders } from 'node:http';
import { stripeWebhooksRoutes } from '../../src/routes/stripe-payment.route';
import { StripePaymentService } from '../../src/services/stripe-payment.service';
import {
  mockEvent__paymentIntent_amountCapturableUpdated,
  mockEvent__paymentIntent_processing,
  mockEvent__paymentIntent_paymentFailed,
  mockEvent__paymentIntent_succeeded
} from '../utils/mock-routes-data';
import * as Config from '../../src/config/config';
import * as Logger from '../../src/libs/logger/index';

jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: jest.fn<() => Stripe.Event>().mockReturnValue(mockEvent__paymentIntent_amountCapturableUpdated),
    }
  }))
}));
jest.mock('../../src/services/stripe-payment.service');
jest.mock('../../src/libs/logger/index');

interface FlexibleConfig {
  [key: string]: string; // Adjust the type according to your config values
}
function setupMockConfig(keysAndValues: Record<string, string>) {
  const mockConfig: FlexibleConfig = {};
  Object.keys(keysAndValues).forEach((key) => {
    mockConfig[key] = keysAndValues[key];
  });

  jest.spyOn(Config, 'getConfig').mockReturnValue(mockConfig as any);
}

describe('Stripe Payment APIs', () => {
  const fastifyApp = fastify({ logger: false });
  const token = 'token';
  const jwtToken = 'jwtToken';

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

  const spiedSessionHeaderAuthenticationHook = new SessionHeaderAuthenticationHook({
    authenticationManager: jest.fn() as unknown as SessionHeaderAuthenticationManager,
    contextProvider: jest.fn() as unknown as ContextProvider<RequestContextData>,
  });

  const spiedPaymentService = new StripePaymentService({
    ctCartService: jest.fn() as unknown as CommercetoolsCartService,
    ctPaymentService: jest.fn() as unknown as CommercetoolsPaymentService,
  });

  beforeAll(async () => {
    await fastifyApp.register(stripeWebhooksRoutes, {
      sessionHeaderAuthHook: spiedSessionHeaderAuthenticationHook,
      paymentService: spiedPaymentService,
    });
  });

  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    spyAuthenticateJWT.mockClear();
    spyAuthenticateOauth2.mockClear();
    spyAuthenticateSession.mockClear();
    await fastifyApp.ready();
  });

  afterAll(async () => {
    await fastifyApp.close();
  });

  describe('POST /stripe/webhooks', () => {
    test('it should handle a payment_intent.amount_capturable_updated event gracefully.', async () => {
      setupMockConfig({
        stripeSecretKey: 'stripeSecretKey',
        authUrl: 'https://auth.europe-west1.gcp.commercetools.com',
      });

      // Set mocked functions to Stripe and spyOn to set the result expected
      Stripe.prototype.webhooks = { constructEvent: jest.fn() } as unknown as Stripe.Webhooks;
      jest
        .spyOn(Stripe.prototype.webhooks, 'constructEvent')
        .mockReturnValue(mockEvent__paymentIntent_amountCapturableUpdated);

      //When
      const response = await fastifyApp.inject({
        method: 'POST',
        url: `/stripe/webhooks`,
        headers: {
          'stripe-signature': 't=123123123,v1=gk2j34gk2j34g2k3j4'
        },
      });

      //Then
      expect(response.statusCode).toEqual(200);
      expect(spiedPaymentService.setAuthorizationSuccessPayment).toHaveBeenCalled();
    });

    test('it should handle a payment_intent.payment_failed event gracefully.', async () => {
      setupMockConfig({
        stripeSecretKey: 'stripeSecretKey',
        authUrl: 'https://auth.europe-west1.gcp.commercetools.com',
      });

      // Set mocked functions to Stripe and spyOn to set the result expected
      Stripe.prototype.webhooks = { constructEvent: jest.fn() } as unknown as Stripe.Webhooks;
      jest.spyOn(Stripe.prototype.webhooks, 'constructEvent').mockReturnValue(mockEvent__paymentIntent_paymentFailed);

      //When
      const response = await fastifyApp.inject({
        method: 'POST',
        url: `/stripe/webhooks`,
        headers: {
          'stripe-signature': 't=123123123,v1=gk2j34gk2j34g2k3j4'
        },
      });

      //Then
      expect(response.statusCode).toEqual(200);
      // TODO Validate that the corresponding service has been called
    });

    test('it should handle a payment_intent.succeeded event gracefully.', async () => {
      setupMockConfig({
        stripeSecretKey: 'stripeSecretKey',
        authUrl: 'https://auth.europe-west1.gcp.commercetools.com',
      });

      // Set mocked functions to Stripe and spyOn to set the result expected
      Stripe.prototype.webhooks = { constructEvent: jest.fn() } as unknown as Stripe.Webhooks;
      jest.spyOn(Stripe.prototype.webhooks, 'constructEvent').mockReturnValue(mockEvent__paymentIntent_succeeded);

      //When
      const response = await fastifyApp.inject({
        method: 'POST',
        url: `/stripe/webhooks`,
        headers: {
          'stripe-signature': 't=123123123,v1=gk2j34gk2j34g2k3j4'
        },
      });

      //Then
      expect(response.statusCode).toEqual(200);
      // TODO Validate that the corresponding service has been called
    });

    test('it should return a 400 status error when the request body is not a valid Stripe event.', async () => {
      setupMockConfig({
        stripeSecretKey: 'stripeSecretKey',
        authUrl: 'https://auth.europe-west1.gcp.commercetools.com',
      });

      // Set mocked functions to Stripe and spyOn to set the result expected
      Stripe.prototype.webhooks = { constructEvent: jest.fn() } as unknown as Stripe.Webhooks;
      jest.spyOn(Stripe.prototype.webhooks, 'constructEvent').mockImplementation(() => {
        throw new Error('Error creating Stripe Event from webhook payload');
      });

      //When
      const response = await fastifyApp.inject({
        method: 'POST',
        url: `/stripe/webhooks`,
        headers: {
          'stripe-signature': 't=123123123,v1=gk2j34gk2j34g2k3j4'
        },
      });

      //Then
      expect(response.statusCode).toEqual(400);
      expect(Logger.log.error).toHaveBeenCalled();
    });

    test('it should print a log when the Stripe event received is not supported.', async () => {
      setupMockConfig({
        stripeSecretKey: 'stripeSecretKey',
        authUrl: 'https://auth.europe-west1.gcp.commercetools.com',
      });

      // Set mocked functions to Stripe and spyOn to set the result expected
      Stripe.prototype.webhooks = { constructEvent: jest.fn() } as unknown as Stripe.Webhooks;
      jest.spyOn(Stripe.prototype.webhooks, 'constructEvent').mockReturnValue(mockEvent__paymentIntent_processing);

      //When
      const response = await fastifyApp.inject({
        method: 'POST',
        url: `/stripe/webhooks`,
        headers: {
          'stripe-signature': 't=123123123,v1=gk2j34gk2j34g2k3j4'
        },
      });

      //Then
      expect(response.statusCode).toEqual(200);
      expect(Logger.log.info).toHaveBeenCalled();
    });
  });
});