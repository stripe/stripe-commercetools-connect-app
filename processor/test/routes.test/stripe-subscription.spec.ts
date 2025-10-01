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
import { SubscriptionOutcome } from '../../src/dtos/stripe-payment.dto';

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

  jest.spyOn(spiedAuthorityAuthorizationHook, 'authorize').mockImplementation(() => async () => {});

  jest.spyOn(spiedOauth2AuthenticationHook, 'authenticate').mockImplementation(() => async () => {});

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

  describe('Stripe Subscription Routes', () => {
    describe('POST /setupIntent', () => {
      test('it should create a setup intent successfully', async () => {
        // Given
        const mockSetupIntentResponse = {
          clientSecret: 'setup_intent_client_secret',
          merchantReturnUrl: 'https://example.com/return',
          billingAddress: JSON.stringify({ name: 'John Doe' }),
        };

        jest.spyOn(spiedSubscriptionService, 'createSetupIntent').mockResolvedValue(mockSetupIntentResponse);

        // When
        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/setupIntent`,
          headers: {
            'x-session-id': sessionId,
            'content-type': 'application/json',
          },
          body: {},
        });

        // Then
        expect(response.statusCode).toEqual(200);
        expect(response.json()).toEqual(mockSetupIntentResponse);
        expect(spiedSubscriptionService.createSetupIntent).toHaveBeenCalled();
      });

      test('it should handle setup intent creation failure', async () => {
        jest
          .spyOn(spiedSubscriptionService, 'createSetupIntent')
          .mockRejectedValue(new Error('Setup intent creation failed'));

        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/setupIntent`,
          headers: {
            'x-session-id': sessionId,
            'content-type': 'application/json',
          },
          body: {},
        });

        expect(response.statusCode).toEqual(500);
      });
    });

    describe('POST /subscription', () => {
      test('it should create a subscription successfully', async () => {
        // Given
        const mockSubscriptionResponse = {
          clientSecret: 'pi_client_secret',
          cartId: 'cart_123',
          paymentReference: 'payment_123',
          subscriptionId: 'sub_123',
          billingAddress: JSON.stringify({ name: 'John Doe' }),
          merchantReturnUrl: 'https://example.com/return',
        };

        jest.spyOn(spiedSubscriptionService, 'createSubscription').mockResolvedValue(mockSubscriptionResponse);

        // When
        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription`,
          headers: {
            'x-session-id': sessionId,
            'content-type': 'application/json',
          },
          body: {},
        });

        // Then
        expect(response.statusCode).toEqual(200);
        expect(response.json()).toEqual(mockSubscriptionResponse);
        expect(spiedSubscriptionService.createSubscription).toHaveBeenCalled();
      });

      test('it should handle subscription creation failure', async () => {
        jest
          .spyOn(spiedSubscriptionService, 'createSubscription')
          .mockRejectedValue(new Error('Subscription creation failed'));

        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription`,
          headers: {
            'x-session-id': sessionId,
            'content-type': 'application/json',
          },
          body: {},
        });

        expect(response.statusCode).toEqual(500);
      });
    });

    describe('POST /subscription/withSetupIntent', () => {
      test('it should create a subscription from setup intent successfully', async () => {
        // Given
        const setupIntentId = 'setup_intent_123';
        const mockSubscriptionResponse = {
          subscriptionId: 'sub_123',
          paymentReference: 'payment_123',
        };

        jest
          .spyOn(spiedSubscriptionService, 'createSubscriptionFromSetupIntent')
          .mockResolvedValue(mockSubscriptionResponse);

        // When
        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription/withSetupIntent`,
          headers: {
            'x-session-id': sessionId,
            'content-type': 'application/json',
          },
          payload: {
            setupIntentId,
          },
        });

        // Then
        expect(response.statusCode).toEqual(200);
        expect(response.json()).toEqual(mockSubscriptionResponse);
        expect(spiedSubscriptionService.createSubscriptionFromSetupIntent).toHaveBeenCalledWith(setupIntentId);
      });

      test('it should return 400 when setupIntentId is missing', async () => {
        // When
        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription/withSetupIntent`,
          headers: {
            'x-session-id': sessionId,
            'content-type': 'application/json',
          },
          payload: {},
        });

        // Then
        expect(response.statusCode).toEqual(400);
      });

      test('it should handle setup intent subscription creation failure', async () => {
        const setupIntentId = 'setup_intent_123';
        jest
          .spyOn(spiedSubscriptionService, 'createSubscriptionFromSetupIntent')
          .mockRejectedValue(new Error('Setup intent subscription creation failed'));

        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription/withSetupIntent`,
          headers: {
            'x-session-id': sessionId,
            'content-type': 'application/json',
          },
          payload: {
            setupIntentId,
          },
        });

        expect(response.statusCode).toEqual(500);
      });
    });

    describe('POST /subscription/confirm', () => {
      test('it should confirm subscription payment successfully', async () => {
        // Given
        const payload = {
          subscriptionId: 'sub_123',
          paymentReference: 'payment_123',
          paymentIntentId: 'pi_123',
        };

        jest.spyOn(spiedSubscriptionService, 'confirmSubscriptionPayment').mockResolvedValue(undefined);

        // When
        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription/confirm`,
          headers: {
            'x-session-id': sessionId,
            'content-type': 'application/json',
          },
          payload,
        });

        // Then
        expect(response.statusCode).toEqual(200);
        expect(response.json().outcome).toEqual('approved');
        expect(spiedSubscriptionService.confirmSubscriptionPayment).toHaveBeenCalledWith(payload);
      });

      test('it should return 400 when confirmation fails', async () => {
        // Given
        const payload = {
          subscriptionId: 'sub_123',
          paymentReference: 'payment_123',
        };

        jest
          .spyOn(spiedSubscriptionService, 'confirmSubscriptionPayment')
          .mockRejectedValue(new Error('Confirmation failed'));

        // When
        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription/confirm`,
          headers: {
            'x-session-id': sessionId,
            'content-type': 'application/json',
          },
          payload,
        });

        // Then
        expect(response.statusCode).toEqual(400);
        expect(response.json().outcome).toEqual('rejected');
      });

      test('it should return 400 when required fields are missing', async () => {
        const payload = {
          subscriptionId: 'sub_123',
        };

        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription/confirm`,
          headers: {
            'x-session-id': sessionId,
            'content-type': 'application/json',
          },
          payload,
        });

        expect(response.statusCode).toEqual(400);
      });

      test('it should handle non-Error exceptions gracefully', async () => {
        const payload = {
          subscriptionId: 'sub_123',
          paymentReference: 'payment_123',
        };

        jest
          .spyOn(spiedSubscriptionService, 'confirmSubscriptionPayment')
          .mockRejectedValue('String error instead of Error object');

        // When
        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription/confirm`,
          headers: {
            'x-session-id': sessionId,
            'content-type': 'application/json',
          },
          payload,
        });

        // Then
        expect(response.statusCode).toEqual(400);
        expect(response.json().outcome).toEqual('rejected');
        expect(response.json().error).toContain('String error instead of Error object');
      });
    });

    describe('GET /subscription-api/:customerId', () => {
      test('it should get customer subscriptions successfully', async () => {
        // Given
        const customerId = 'customer_123';
        const mockSubscriptions = [
          {
            id: 'sub_123',
            status: 'active',
            object: 'subscription',
            application: null,
            application_fee_percent: null,
            automatic_tax: {
              disabled_reason: null,
              liability: null,
              enabled: false,
            },
            billing_cycle_anchor: 123456789,
            cancel_at: null,
            cancel_at_period_end: false,
            canceled_at: null,
            collection_method: 'charge_automatically',
            created: 123456789,
            current_period_end: 123456789,
            current_period_start: 123456789,
            customer: 'cus_123',
            days_until_due: null,
            default_payment_method: null,
            default_source: null,
            default_tax_rates: [],
            description: null,
            discount: null,
            ended_at: null,
            items: { object: 'list', data: [], has_more: false, url: '' },
            latest_invoice: null,
            livemode: false,
            metadata: {},
            next_pending_invoice_item_invoice: null,
            pause_collection: null,
            pending_invoice_item_interval: null,
            pending_setup_intent: null,
            pending_update: null,
            plan: null,
            quantity: null,
            schedule: null,
            start_date: 123456789,
            test_clock: null,
            trial_end: null,
            trial_start: null,
          },
          {
            id: 'sub_456',
            status: 'canceled',
            object: 'subscription',
            application: null,
            application_fee_percent: null,
            automatic_tax: { enabled: false },
            billing_cycle_anchor: 123456789,
            cancel_at: null,
            cancel_at_period_end: false,
            canceled_at: 123456789,
            collection_method: 'charge_automatically',
            created: 123456789,
            current_period_end: 123456789,
            current_period_start: 123456789,
            customer: 'cus_123',
            days_until_due: null,
            default_payment_method: null,
            default_source: null,
            default_tax_rates: [],
            description: null,
            discount: null,
            ended_at: null,
            items: { object: 'list', data: [], has_more: false, url: '' },
            latest_invoice: null,
            livemode: false,
            metadata: {},
            next_pending_invoice_item_invoice: null,
            pause_collection: null,
            pending_invoice_item_interval: null,
            pending_setup_intent: null,
            pending_update: null,
            schedule: null,
            start_date: 123456789,
            test_clock: null,
            trial_end: null,
            trial_start: null,
          },
        ] as unknown as Stripe.Subscription[];

        jest.spyOn(spiedSubscriptionService, 'getCustomerSubscriptions').mockResolvedValue(mockSubscriptions);

        // When
        const response = await fastifyApp.inject({
          method: 'GET',
          url: `/subscription-api/${customerId}`,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
        });

        // Then
        expect(response.statusCode).toEqual(200);
        expect(response.json()).toEqual({ subscriptions: mockSubscriptions });
        expect(spiedSubscriptionService.getCustomerSubscriptions).toHaveBeenCalledWith(customerId);
      });

      test('it should return empty array and error on failure', async () => {
        // Given
        const customerId = 'customer_123';

        jest
          .spyOn(spiedSubscriptionService, 'getCustomerSubscriptions')
          .mockRejectedValue(new Error('Failed to get subscriptions'));

        // When
        const response = await fastifyApp.inject({
          method: 'GET',
          url: `/subscription-api/${customerId}`,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
        });

        // Then
        expect(response.statusCode).toEqual(400);
        expect(response.json().subscriptions).toEqual([]);
        expect(response.json().error).toBe('Failed to get subscriptions');
      });

      test('it should return 401 when customerId is undefined', async () => {
        // Given
        const customerId = '';

        // When
        const response = await fastifyApp.inject({
          method: 'GET',
          url: `/subscription-api/${customerId}`,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
        });

        // Then
        expect(response.statusCode).toEqual(401);
        expect(response.json().subscriptions).toEqual([]);
        expect(response.json().error).toBe('No customer ID found in request parameters');
      });

      test('it should handle non-Error exceptions gracefully', async () => {
        const customerId = 'customer_123';

        jest
          .spyOn(spiedSubscriptionService, 'getCustomerSubscriptions')
          .mockRejectedValue('String error instead of Error object');

        const response = await fastifyApp.inject({
          method: 'GET',
          url: `/subscription-api/${customerId}`,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
        });

        expect(response.statusCode).toEqual(400);
        expect(response.json().subscriptions).toEqual([]);
        expect(response.json().error).toBe('String error instead of Error object');
      });
    });

    describe('DELETE /subscription-api/:customerId/:subscriptionId', () => {
      test('it should cancel subscription successfully', async () => {
        const customerId = 'customer_123';
        const subscriptionId = 'sub_123';
        const mockCancelResponse = {
          id: subscriptionId,
          status: 'canceled',
          outcome: SubscriptionOutcome.CANCELED,
          message: 'Subscription canceled successfully',
        };

        jest.spyOn(spiedSubscriptionService, 'cancelSubscription').mockResolvedValue(mockCancelResponse);

        const response = await fastifyApp.inject({
          method: 'DELETE',
          url: `/subscription-api/${customerId}/${subscriptionId}`,
          headers: {
            authorization: `Bearer ${token}`,
          },
        });

        expect(response.statusCode).toEqual(200);
        expect(response.json()).toEqual({
          id: subscriptionId,
          status: 'canceled',
          outcome: 'canceled',
          message: 'Subscription canceled successfully',
        });
        expect(spiedSubscriptionService.cancelSubscription).toHaveBeenCalledWith({ customerId, subscriptionId });
      });

      test('it should handle subscription cancellation failure', async () => {
        const customerId = 'customer_123';
        const subscriptionId = 'sub_123';

        jest.spyOn(spiedSubscriptionService, 'cancelSubscription').mockRejectedValue(new Error('Cancellation failed'));

        const response = await fastifyApp.inject({
          method: 'DELETE',
          url: `/subscription-api/${customerId}/${subscriptionId}`,
          headers: {
            authorization: `Bearer ${token}`,
          },
        });

        expect(response.statusCode).toEqual(400);
        expect(response.json()).toEqual({
          id: subscriptionId,
          status: 'failed',
          message: 'Cancellation failed',
          outcome: 'error',
        });
      });

      test('it should handle non-Error exceptions gracefully', async () => {
        const customerId = 'customer_123';
        const subscriptionId = 'sub_123';

        jest
          .spyOn(spiedSubscriptionService, 'cancelSubscription')
          .mockRejectedValue('String error instead of Error object');

        const response = await fastifyApp.inject({
          method: 'DELETE',
          url: `/subscription-api/${customerId}/${subscriptionId}`,
          headers: {
            authorization: `Bearer ${token}`,
          },
        });

        expect(response.statusCode).toEqual(400);
        expect(response.json()).toEqual({
          id: subscriptionId,
          status: 'failed',
          message: 'Unknown error',
          outcome: 'error',
        });
      });
    });

    describe('POST /subscription-api/:customerId (Update Subscription)', () => {
      test('it should update subscription successfully', async () => {
        const customerId = 'customer_123';
        const payload = {
          subscriptionId: 'sub_123',
          newSubscriptionVariantId: 'variant_456',
          newSubscriptionVariantPosition: 1,
          newSubscriptionPriceId: 'price_789',
        };

        const mockUpdateResponse = {
          id: 'sub_123',
          status: 'active',
          object: 'subscription',
          application: null,
          application_fee_percent: null,
          automatic_tax: { enabled: false },
          billing_cycle_anchor: 123456789,
          cancel_at: null,
          cancel_at_period_end: false,
          canceled_at: null,
          collection_method: 'charge_automatically',
          created: 123456789,
          current_period_end: 123456789,
          current_period_start: 123456789,
          customer: 'cus_123',
          days_until_due: null,
          default_payment_method: null,
          default_source: null,
          default_tax_rates: [],
          description: null,
          discount: null,
          ended_at: null,
          items: { object: 'list', data: [], has_more: false, url: '' },
          latest_invoice: null,
          livemode: false,
          metadata: {},
          next_pending_invoice_item_invoice: null,
          pause_collection: null,
          pending_invoice_item_interval: null,
          pending_setup_intent: null,
          pending_update: null,
          schedule: null,
          start_date: 123456789,
          test_clock: null,
          trial_end: null,
          trial_start: null,
        } as unknown as Stripe.Subscription;

        jest.spyOn(spiedSubscriptionService, 'updateSubscription').mockResolvedValue(mockUpdateResponse);

        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription-api/${customerId}`,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          payload,
        });

        expect(response.statusCode).toEqual(200);
        expect(response.json()).toEqual({
          id: 'sub_123',
          status: 'active',
          outcome: 'updated',
          message: 'Subscription sub_123 has been successfully updated.',
        });
        expect(spiedSubscriptionService.updateSubscription).toHaveBeenCalledWith({
          customerId,
          subscriptionId: payload.subscriptionId,
          newSubscriptionVariantId: payload.newSubscriptionVariantId,
          newSubscriptionPriceId: payload.newSubscriptionPriceId,
          newSubscriptionVariantPosition: Number(payload.newSubscriptionVariantPosition),
        });
      });

      test('it should handle subscription update failure', async () => {
        const customerId = 'customer_123';
        const payload = {
          subscriptionId: 'sub_123',
          newSubscriptionVariantId: 'variant_456',
          newSubscriptionVariantPosition: 1,
          newSubscriptionPriceId: 'price_789',
        };

        jest.spyOn(spiedSubscriptionService, 'updateSubscription').mockRejectedValue(new Error('Update failed'));

        // When
        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription-api/${customerId}`,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          payload,
        });

        expect(response.statusCode).toEqual(400);
        expect(response.json()).toEqual({
          id: payload.subscriptionId,
          status: 'failed',
          message: 'Update failed',
          outcome: 'error',
        });
      });

      test('it should handle non-Error exceptions gracefully', async () => {
        const customerId = 'customer_123';
        const payload = {
          subscriptionId: 'sub_123',
          newSubscriptionVariantId: 'variant_456',
          newSubscriptionVariantPosition: 1,
          newSubscriptionPriceId: 'price_789',
        };

        jest
          .spyOn(spiedSubscriptionService, 'updateSubscription')
          .mockRejectedValue('String error instead of Error object');

        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription-api/${customerId}`,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          payload,
        });

        expect(response.statusCode).toEqual(400);
        expect(response.json()).toEqual({
          id: payload.subscriptionId,
          status: 'failed',
          message: 'Unknown error',
          outcome: 'error',
        });
      });

      test('it should handle missing required fields in update payload', async () => {
        const customerId = 'customer_123';
        const payload = {
          subscriptionId: 'sub_123',
          newSubscriptionVariantPosition: 1,
          newSubscriptionPriceId: 'price_789',
        };

        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription-api/${customerId}`,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          payload,
        });

        expect(response.statusCode).toEqual(400);
      });
    });

    describe('POST /subscription-api/advanced/:customerId (Patch Subscription)', () => {
      test('it should patch a subscription successfully', async () => {
        const customerId = 'customer_123';
        const payload = {
          id: 'sub_123',
          params: {
            metadata: { updated: 'true' },
            description: 'Updated subscription',
          },
          options: { prorate: true },
        };

        const mockPatchResponse = {
          id: 'sub_123',
          status: 'active',
          object: 'subscription',
          metadata: { updated: 'true' },
          description: 'Updated subscription',
        } as unknown as Stripe.Subscription;

        jest.spyOn(spiedSubscriptionService, 'patchSubscription').mockResolvedValue(mockPatchResponse);

        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription-api/advanced/${customerId}`,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          payload,
        });

        expect(response.statusCode).toEqual(200);
        expect(response.json()).toEqual({
          id: 'sub_123',
          status: 'active',
          outcome: 'updated',
          message: 'Subscription sub_123 has been successfully updated.',
        });
        expect(spiedSubscriptionService.patchSubscription).toHaveBeenCalledWith({
          customerId,
          subscriptionId: payload.id,
          params: payload.params,
          options: payload.options as Stripe.RequestOptions,
        });
      });

      test('it should handle subscription patch failure', async () => {
        const customerId = 'customer_123';
        const payload = {
          id: 'sub_123',
          params: {
            metadata: { updated: 'true' },
          },
        };

        jest.spyOn(spiedSubscriptionService, 'patchSubscription').mockRejectedValue(new Error('Patch update failed'));

        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription-api/advanced/${customerId}`,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          payload,
        });

        expect(response.statusCode).toEqual(400);
        expect(response.json()).toEqual({
          id: payload.id,
          status: 'failed',
          message: 'Patch update failed',
          outcome: 'error',
        });
      });

      test('it should handle missing required fields in patch payload', async () => {
        const customerId = 'customer_123';
        const payload = {
          params: {
            metadata: { updated: 'true' },
          },
        };

        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription-api/advanced/${customerId}`,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          payload,
        });

        expect(response.statusCode).toEqual(400);
      });

      test('it should handle non-Error exceptions gracefully', async () => {
        const customerId = 'customer_123';
        const payload = {
          id: 'sub_123',
          params: {
            metadata: { updated: 'true' },
          },
        };

        jest
          .spyOn(spiedSubscriptionService, 'patchSubscription')
          .mockRejectedValue('String error instead of Error object');

        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription-api/advanced/${customerId}`,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          payload,
        });

        expect(response.statusCode).toEqual(400);
        expect(response.json()).toEqual({
          id: payload.id,
          status: 'failed',
          message: 'Unknown error',
          outcome: 'error',
        });
      });
    });
  });
});
