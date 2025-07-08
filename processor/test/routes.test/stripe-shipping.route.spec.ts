import fastify from 'fastify';
import { describe, beforeAll, afterAll, test, expect, jest, afterEach, beforeEach } from '@jest/globals';
import {
  CommercetoolsCartService,
  ContextProvider,
  RequestContextData,
  SessionHeaderAuthenticationHook,
  SessionHeaderAuthenticationManager,
} from '@commercetools/connect-payments-sdk';
import { IncomingHttpHeaders } from 'node:http';
import { stripeShippingRoute } from '../../src/routes/stripe-shipping.route';
import { StripeShippingService } from '../../src/services/stripe-shipping.service';
import { appLogger } from '../../src/payment-sdk';
import * as Logger from '../../src/libs/logger/index';

jest.mock('../../src/services/stripe-shipping.service');
jest.mock('../../src/libs/logger/index');

describe('Stripe Shipping Routes', () => {
  const fastifyApp = fastify({ logger: false });
  const sessionId = 'session-id';

  const spyAuthenticateSession = jest
    .spyOn(SessionHeaderAuthenticationHook.prototype, 'authenticate')
    .mockImplementation(() => async (request: { headers: IncomingHttpHeaders }) => {
      expect(request.headers['x-session-id']).toContain('session-id');
    });

  const spiedSessionHeaderAuthenticationHook = new SessionHeaderAuthenticationHook({
    logger: appLogger,
    authenticationManager: jest.fn() as unknown as SessionHeaderAuthenticationManager,
    contextProvider: jest.fn() as unknown as ContextProvider<RequestContextData>,
  });

  const spiedShippingMethodsService = new StripeShippingService({
    ctCartService: jest.fn() as unknown as CommercetoolsCartService,
  });

  beforeAll(async () => {
    await fastifyApp.register(stripeShippingRoute, {
      shippingMethodsService: spiedShippingMethodsService,
      sessionHeaderAuthHook: spiedSessionHeaderAuthenticationHook,
    });
  });

  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    spyAuthenticateSession.mockClear();
    await fastifyApp.ready();
  });

  afterAll(async () => {
    await fastifyApp.close();
  });

  describe('POST /shipping-methods', () => {
    test('should fetch shipping methods successfully', async () => {
      // Given
      const requestBody = {
        country: 'US',
        state: 'CA',
      };
      const mockResponse = {
        shippingRates: [
          {
            id: 'shipping-method-1',
            displayName: 'Standard Shipping',
            amount: 500,
          },
        ],
        lineItems: [
          {
            name: 'Test Product',
            amount: 1000,
          },
        ],
      };

      jest.spyOn(spiedShippingMethodsService, 'getShippingMethods').mockResolvedValue(mockResponse);

      // When
      const response = await fastifyApp.inject({
        method: 'POST',
        url: '/shipping-methods',
        headers: {
          'x-session-id': sessionId,
          'content-type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      // Then
      expect(response.statusCode).toEqual(200);
      expect(response.json()).toEqual(mockResponse);
      expect(spiedShippingMethodsService.getShippingMethods).toHaveBeenCalledWith(requestBody);
    });

    test('should return 400 when shipping methods fetch fails', async () => {
      // Given
      const requestBody = {
        country: 'US',
        state: 'CA',
      };
      const errorMessage = 'Failed to fetch shipping methods';
      jest.spyOn(spiedShippingMethodsService, 'getShippingMethods').mockRejectedValue(new Error(errorMessage));

      // When
      const response = await fastifyApp.inject({
        method: 'POST',
        url: '/shipping-methods',
        headers: {
          'x-session-id': sessionId,
          'content-type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      // Then
      expect(response.statusCode).toEqual(400);
      expect(spiedShippingMethodsService.getShippingMethods).toHaveBeenCalledWith(requestBody);
      expect(Logger.log.error).toHaveBeenCalledWith(`Error fetching shipping methods: Error: ${errorMessage}`);
    });
  });

  describe('POST /shipping-methods/update', () => {
    test('should update shipping rate successfully', async () => {
      // Given
      const requestBody = {
        id: 'shipping-method-1',
      };
      const mockResponse = {
        lineItems: [
          {
            name: 'Test Product',
            amount: 1000,
          },
          {
            name: 'Shipping',
            amount: 500,
          },
        ],
      };

      jest.spyOn(spiedShippingMethodsService, 'updateShippingRate').mockResolvedValue(mockResponse);

      // When
      const response = await fastifyApp.inject({
        method: 'POST',
        url: '/shipping-methods/update',
        headers: {
          'x-session-id': sessionId,
          'content-type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      // Then
      expect(response.statusCode).toEqual(200);
      expect(response.json()).toEqual(mockResponse);
      expect(spiedShippingMethodsService.updateShippingRate).toHaveBeenCalledWith(requestBody);
    });

    test('should return 400 when shipping rate update fails', async () => {
      // Given
      const requestBody = {
        id: 'shipping-method-1',
      };
      const errorMessage = 'Failed to update shipping rate';
      jest.spyOn(spiedShippingMethodsService, 'updateShippingRate').mockRejectedValue(new Error(errorMessage));

      // When
      const response = await fastifyApp.inject({
        method: 'POST',
        url: '/shipping-methods/update',
        headers: {
          'x-session-id': sessionId,
          'content-type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      // Then
      expect(response.statusCode).toEqual(400);
      expect(spiedShippingMethodsService.updateShippingRate).toHaveBeenCalledWith(requestBody);
      expect(Logger.log.error).toHaveBeenCalledWith(`Error updating shipping rate: Error: ${errorMessage}`);
    });
  });

  describe('GET /shipping-methods/remove', () => {
    test('should remove shipping rate successfully', async () => {
      // Given
      const mockResponse = {
        lineItems: [
          {
            name: 'Test Product',
            amount: 1000,
          },
        ],
      };

      jest.spyOn(spiedShippingMethodsService, 'removeShippingRate').mockResolvedValue(mockResponse);

      // When
      const response = await fastifyApp.inject({
        method: 'GET',
        url: '/shipping-methods/remove',
        headers: {
          'x-session-id': sessionId,
          'content-type': 'application/json',
        },
      });

      // Then
      expect(response.statusCode).toEqual(200);
      expect(response.json()).toEqual(mockResponse);
      expect(spiedShippingMethodsService.removeShippingRate).toHaveBeenCalled();
    });

    test('should return 400 when shipping rate removal fails', async () => {
      // Given
      const errorMessage = 'Failed to remove shipping rate';
      jest.spyOn(spiedShippingMethodsService, 'removeShippingRate').mockRejectedValue(new Error(errorMessage));

      // When
      const response = await fastifyApp.inject({
        method: 'GET',
        url: '/shipping-methods/remove',
        headers: {
          'x-session-id': sessionId,
          'content-type': 'application/json',
        },
      });

      // Then
      expect(response.statusCode).toEqual(400);
      expect(spiedShippingMethodsService.removeShippingRate).toHaveBeenCalled();
      expect(Logger.log.error).toHaveBeenCalledWith(`Error removing shipping rate: Error: ${errorMessage}`);
    });
  });
});
