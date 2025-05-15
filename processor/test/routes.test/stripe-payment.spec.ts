import Stripe from 'stripe';
import fastify from 'fastify';
import { describe, beforeAll, afterAll, test, expect, jest, afterEach, beforeEach } from '@jest/globals';
import {
  CommercetoolsCartService,
  CommercetoolsOrderService,
  CommercetoolsPaymentService,
  ContextProvider,
  JWTAuthenticationHook,
  Oauth2AuthenticationHook,
  RequestContextData,
  SessionHeaderAuthenticationHook,
  SessionHeaderAuthenticationManager,
} from '@commercetools/connect-payments-sdk';
import { IncomingHttpHeaders } from 'node:http';
import {
  configElementRoutes,
  customerRoutes,
  paymentRoutes,
  stripeWebhooksRoutes,
} from '../../src/routes/stripe-payment.route';
import { StripePaymentService } from '../../src/services/stripe-payment.service';
import {
  mockEvent__paymentIntent_processing,
  mockEvent__paymentIntent_paymentFailed,
  mockEvent__paymentIntent_succeeded_captureMethodManual,
  mockEvent__charge_refund_captured,
  mockEvent__paymentIntent_canceled,
  mockRoute__payments_succeed,
  mockRoute__get_config_element_succeed,
  mockEvent__paymentIntent_requiresAction,
  mockRoute__well_know__succeed,
  mockEvent__charge_succeeded_captured,
  mockEvent__charge_capture_succeeded_notCaptured,
  mockRoute__customer_session_succeed,
} from '../utils/mock-routes-data';
import * as Config from '../../src/config/config';
import * as Logger from '../../src/libs/logger/index';
import { StripeHeaderAuthHook } from '../../src/libs/fastify/hooks/stripe-header-auth.hook';
import { appLogger } from '../../src/payment-sdk';
import { StripeCustomerService } from '../../src/services/stripe-customer.service';
import { mockEvent__invoice_paid__Expanded_noPaymnet_intent__amount_paid } from '../utils/mock-subscription-data';

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
jest.mock('../../src/services/stripe-payment.service');
jest.mock('../../src/libs/logger/index');

interface FlexibleConfig {
  [key: string]: string | number | Config.PaymentFeatures;
}
function setupMockConfig(keysAndValues: Record<string, string>) {
  const mockConfig: FlexibleConfig = {};
  Object.keys(keysAndValues).forEach((key) => {
    mockConfig[key] = keysAndValues[key];
  });

  jest.spyOn(Config, 'getConfig').mockReturnValue(mockConfig as ReturnType<typeof Config.getConfig>);
}

describe('Stripe Payment APIs', () => {
  const fastifyApp = fastify({ logger: false });
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
    .mockImplementation(() => async (request: { headers: IncomingHttpHeaders }) => {
      expect(request.headers['x-session-id']).toContain('session-id');
    });

  const spyStripeHeaderAuthHook = jest
    .spyOn(SessionHeaderAuthenticationHook.prototype, 'authenticate')
    .mockImplementation(() => async () => {
      expect('stripe-signature').toEqual('stripe-signature');
    });

  const spiedSessionHeaderAuthenticationHook = new SessionHeaderAuthenticationHook({
    logger: appLogger,
    authenticationManager: jest.fn() as unknown as SessionHeaderAuthenticationManager,
    contextProvider: jest.fn() as unknown as ContextProvider<RequestContextData>,
  });

  const spiedPaymentService = new StripePaymentService({
    ctCartService: jest.fn() as unknown as CommercetoolsCartService,
    ctPaymentService: jest.fn() as unknown as CommercetoolsPaymentService,
    ctOrderService: jest.fn() as unknown as CommercetoolsOrderService,
  });

  const spiedCustomerService = new StripeCustomerService(jest.fn() as unknown as CommercetoolsCartService);

  const spiedStripeHeaderAuthHook = new StripeHeaderAuthHook();

  const originalEnv = process.env;

  beforeAll(async () => {
    await fastifyApp.register(stripeWebhooksRoutes, {
      stripeHeaderAuthHook: spiedStripeHeaderAuthHook,
      paymentService: spiedPaymentService,
    });

    await fastifyApp.register(paymentRoutes, {
      prefix: '/',
      sessionHeaderAuthHook: spiedSessionHeaderAuthenticationHook,
      paymentService: spiedPaymentService,
    });

    await fastifyApp.register(configElementRoutes, {
      prefix: '/',
      sessionHeaderAuthHook: spiedSessionHeaderAuthenticationHook,
      paymentService: spiedPaymentService,
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
    spyAuthenticateJWT.mockClear();
    spyAuthenticateOauth2.mockClear();
    spyAuthenticateSession.mockClear();
    spyStripeHeaderAuthHook.mockClear();
    await fastifyApp.ready();
    process.env = originalEnv;
  });

  afterAll(async () => {
    await fastifyApp.close();
  });

  describe('POST /stripe/webhooks', () => {
    test('it should handle a payment_intent.succeeded event gracefully.', async () => {
      setupMockConfig({
        stripeSecretKey: 'stripeSecretKey',
        stripeWebhookSigningSecret: 'stripeWebhookSigningSecret',
        authUrl: 'https://auth.europe-west1.gcp.commercetools.com',
      });

      // Set mocked functions to Stripe and spyOn to set the result expected
      Stripe.prototype.webhooks = { constructEvent: jest.fn() } as unknown as Stripe.Webhooks;
      jest
        .spyOn(Stripe.prototype.webhooks, 'constructEvent')
        .mockReturnValue(mockEvent__paymentIntent_succeeded_captureMethodManual);

      jest.spyOn(StripePaymentService.prototype, 'processStripeEvent').mockReturnValue(Promise.resolve());
      //When
      const response = await fastifyApp.inject({
        method: 'POST',
        url: `/stripe/webhooks`,
        headers: {
          'stripe-signature': 't=123123123,v1=gk2j34gk2j34g2k3j4',
        },
      });

      //Then
      expect(response.statusCode).toEqual(200);
      expect(spiedPaymentService.processStripeEvent).toHaveBeenCalled();
      expect(spiedPaymentService.processStripeEvent).toHaveBeenCalledTimes(1);
    });

    test('it should handle a charge.refunded event gracefully.', async () => {
      setupMockConfig({
        stripeSecretKey: 'stripeSecretKey',
        stripeWebhookSigningSecret: 'stripeWebhookSigningSecret',
        authUrl: 'https://auth.europe-west1.gcp.commercetools.com',
      });

      // Set mocked functions to Stripe and spyOn to set the result expected
      Stripe.prototype.webhooks = { constructEvent: jest.fn() } as unknown as Stripe.Webhooks;
      jest.spyOn(Stripe.prototype.webhooks, 'constructEvent').mockReturnValue(mockEvent__charge_refund_captured);
      jest.spyOn(StripePaymentService.prototype, 'processStripeEvent').mockReturnValue(Promise.resolve());

      //When
      const response = await fastifyApp.inject({
        method: 'POST',
        url: `/stripe/webhooks`,
        headers: {
          'stripe-signature': 't=123123123,v1=gk2j34gk2j34g2k3j4',
        },
      });

      //Then
      expect(response.statusCode).toEqual(200);
      expect(spiedPaymentService.processStripeEvent).toHaveBeenCalled();
    });

    test('it should handle a payment_intent.canceled event gracefully.', async () => {
      setupMockConfig({
        stripeSecretKey: 'stripeSecretKey',
        stripeWebhookSigningSecret: 'stripeWebhookSigningSecret',
        authUrl: 'https://auth.europe-west1.gcp.commercetools.com',
      });

      // Set mocked functions to Stripe and spyOn to set the result expected
      Stripe.prototype.webhooks = { constructEvent: jest.fn() } as unknown as Stripe.Webhooks;
      jest.spyOn(Stripe.prototype.webhooks, 'constructEvent').mockReturnValue(mockEvent__paymentIntent_canceled);
      jest.spyOn(StripePaymentService.prototype, 'processStripeEvent').mockReturnValue(Promise.resolve());

      //When
      const response = await fastifyApp.inject({
        method: 'POST',
        url: `/stripe/webhooks`,
        headers: {
          'stripe-signature': 't=123123123,v1=gk2j34gk2j34g2k3j4',
        },
      });

      //Then
      expect(response.statusCode).toEqual(200);
      expect(spiedPaymentService.processStripeEvent).toHaveBeenCalled();
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
          'stripe-signature': 't=123123123,v1=gk2j34gk2j34g2k3j4',
        },
      });

      //Then
      expect(response.statusCode).toEqual(200);
      expect(Logger.log.info).toHaveBeenCalled();
    });

    test('it should handle a payment_intent.requires_action event gracefully.', async () => {
      setupMockConfig({
        stripeSecretKey: 'stripeSecretKey',
        authUrl: 'https://auth.europe-west1.gcp.commercetools.com',
      });

      // Set mocked functions to Stripe and spyOn to set the result expected
      Stripe.prototype.webhooks = { constructEvent: jest.fn() } as unknown as Stripe.Webhooks;
      jest.spyOn(Stripe.prototype.webhooks, 'constructEvent').mockReturnValue(mockEvent__paymentIntent_requiresAction);

      //When
      const response = await fastifyApp.inject({
        method: 'POST',
        url: `/stripe/webhooks`,
        headers: {
          'stripe-signature': 't=123123123,v1=gk2j34gk2j34g2k3j4',
        },
      });

      //Then
      expect(response.statusCode).toEqual(200);
      expect(Logger.log.info).toHaveBeenCalled();
    });

    test('it should handle a charge.captured event gracefully.', async () => {
      setupMockConfig({
        stripeSecretKey: 'stripeSecretKey',
        authUrl: 'https://auth.europe-west1.gcp.commercetools.com',
      });

      Stripe.prototype.webhooks = { constructEvent: jest.fn() } as unknown as Stripe.Webhooks;
      jest.spyOn(Stripe.prototype.webhooks, 'constructEvent').mockReturnValue(mockEvent__charge_succeeded_captured);

      const response = await fastifyApp.inject({
        method: 'POST',
        url: `/stripe/webhooks`,
        headers: {
          'stripe-signature': 't=123123123,v1=gk2j34gk2j34g2k3j4',
        },
      });

      expect(response.statusCode).toEqual(200);
      expect(Logger.log.info).toHaveBeenCalled();
    });

    test('it should return a 400 status error when the request body is not a valid Stripe event.', async () => {
      setupMockConfig({
        stripeSecretKey: 'stripeSecretKey',
        stripeWebhookSigningSecret: 'stripeWebhookSigningSecret',
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
          'stripe-signature': 't=123123123,v1=gk2j34gk2j34g2k3j4',
        },
      });

      //Then
      expect(response.statusCode).toEqual(400);
      expect(Logger.log.error).toHaveBeenCalled();
    });

    test('it should print a log when the Stripe event received is not supported.', async () => {
      setupMockConfig({
        stripeSecretKey: 'stripeSecretKey',
        stripeWebhookSigningSecret: 'stripeWebhookSigningSecret',
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
          'stripe-signature': 't=123123123,v1=gk2j34gk2j34g2k3j4',
        },
      });

      //Then
      expect(response.statusCode).toEqual(200);
      expect(Logger.log.info).toHaveBeenCalled();
    });

    test('it should handle a invoice.paid event gracefully.', async () => {
      setupMockConfig({
        stripeSecretKey: 'stripeSecretKey',
        stripeWebhookSigningSecret: 'stripeWebhookSigningSecret',
        authUrl: 'https://auth.europe-west1.gcp.commercetools.com',
      });

      // Set mocked functions to Stripe and spyOn to set the result expected
      Stripe.prototype.webhooks = { constructEvent: jest.fn() } as unknown as Stripe.Webhooks;
      jest
        .spyOn(Stripe.prototype.webhooks, 'constructEvent')
        .mockReturnValue(mockEvent__invoice_paid__Expanded_noPaymnet_intent__amount_paid);
      jest.spyOn(StripePaymentService.prototype, 'processSubscriptionEvent').mockReturnValue(Promise.resolve());

      //When
      const response = await fastifyApp.inject({
        method: 'POST',
        url: `/stripe/webhooks`,
        headers: {
          'stripe-signature': 't=123123123,v1=gk2j34gk2j34g2k3j4',
        },
      });

      //Then
      expect(response.statusCode).toEqual(200);
      expect(spiedPaymentService.processSubscriptionEvent).toHaveBeenCalled();
    });

    test('it should handle a invoice.payment_failed event gracefully.', async () => {
      setupMockConfig({
        stripeSecretKey: 'stripeSecretKey',
        stripeWebhookSigningSecret: 'stripeWebhookSigningSecret',
        authUrl: 'https://auth.europe-west1.gcp.commercetools.com',
      });

      // Set mocked functions to Stripe and spyOn to set the result expected
      Stripe.prototype.webhooks = { constructEvent: jest.fn() } as unknown as Stripe.Webhooks;
      jest
        .spyOn(Stripe.prototype.webhooks, 'constructEvent')
        .mockReturnValue(mockEvent__invoice_paid__Expanded_noPaymnet_intent__amount_paid);
      jest.spyOn(StripePaymentService.prototype, 'processSubscriptionEvent').mockReturnValue(Promise.resolve());

      //When
      const response = await fastifyApp.inject({
        method: 'POST',
        url: `/stripe/webhooks`,
        headers: {
          'stripe-signature': 't=123123123,v1=gk2j34gk2j34g2k3j4',
        },
      });

      //Then
      expect(response.statusCode).toEqual(200);
      expect(spiedPaymentService.processSubscriptionEvent).toHaveBeenCalled();
    });
  });

  describe('GET /payment', () => {
    test('should call /payment and return valid information', async () => {
      //Given
      jest.spyOn(spiedPaymentService, 'handlePaymentCreation').mockResolvedValue(mockRoute__payments_succeed);

      //When
      const responseGetConfig = await fastifyApp.inject({
        method: 'GET',
        url: `/payments`,
        headers: {
          'x-session-id': sessionId,
          'content-type': 'application/json',
        },
      });

      //Then
      expect(responseGetConfig.statusCode).toEqual(200);
      expect(responseGetConfig.json()).toEqual(mockRoute__payments_succeed);
      expect(spiedPaymentService.handlePaymentCreation).toHaveBeenCalled();
    });
  });

  describe('POST /confirmPayments/:id', () => {
    test('should call /confirmPayments/:id and return valid information', async () => {
      //Given
      jest.spyOn(spiedPaymentService, 'updatePaymentIntentStripeSuccessful').mockResolvedValue();

      //When
      const responseGetConfig = await fastifyApp.inject({
        method: 'POST',
        url: `/confirmPayments/id`,
        headers: {
          'x-session-id': sessionId,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ paymentIntent: 'paymentId' }),
      });

      //Then
      expect(responseGetConfig.statusCode).toEqual(200);
      expect(responseGetConfig.body).toEqual(JSON.stringify({ outcome: 'approved' }));
      expect(spiedPaymentService.updatePaymentIntentStripeSuccessful).toHaveBeenCalled();
    });

    test('should call /confirmPayments/:id and return error information', async () => {
      //Given
      jest.spyOn(spiedPaymentService, 'updatePaymentIntentStripeSuccessful').mockImplementation(() => {
        throw new Error('error');
      });

      //When
      const responseGetConfig = await fastifyApp.inject({
        method: 'POST',
        url: `/confirmPayments/id`,
        headers: {
          'x-session-id': sessionId,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ paymentIntent: 'paymentId' }),
      });

      //Then
      expect(responseGetConfig.statusCode).toEqual(400);
      expect(responseGetConfig.body).toEqual(JSON.stringify({ outcome: 'rejected', error: JSON.stringify({}) }));
      expect(spiedPaymentService.updatePaymentIntentStripeSuccessful).toHaveBeenCalled();
    });
  });

  describe('GET /config-element', () => {
    test('should call /config-element', async () => {
      //Given
      jest.spyOn(spiedPaymentService, 'initializeCartPayment').mockResolvedValue(mockRoute__get_config_element_succeed);

      //When
      const responseGetConfig = await fastifyApp.inject({
        method: 'GET',
        url: `/config-element/paymentElement`,
        headers: {
          'x-session-id': sessionId,
          'content-type': 'application/json',
        },
      });

      //Then
      expect(responseGetConfig.statusCode).toEqual(200);
      expect(responseGetConfig.json()).toEqual(mockRoute__get_config_element_succeed);
      expect(spiedPaymentService.initializeCartPayment).toHaveBeenCalled();
    });
  });

  describe('GET /applePayConfig', () => {
    test('should call /applePayConfig', async () => {
      //Given
      jest.spyOn(spiedPaymentService, 'applePayConfig').mockReturnValue(mockRoute__well_know__succeed);

      //When
      const responseGetConfig = await fastifyApp.inject({
        method: 'GET',
        url: `/applePayConfig`,
      });

      //Then
      expect(responseGetConfig.statusCode).toEqual(200);
      expect(responseGetConfig.body).toEqual(mockRoute__well_know__succeed);
      expect(spiedPaymentService.applePayConfig).toHaveBeenCalled();
    });
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
