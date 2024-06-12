import Stripe from 'stripe';
import { describe, test, expect, jest, afterEach, beforeEach } from '@jest/globals';
import * as Actions from '../../src/connectors/actions';
import * as Logger from '../../src/libs/logger';
import {
  mock__Stripe_createWebhookEndpoints_response,
  mock__Stripe_deleteWebhookEndpoints_response,
} from '../utils/mock-actions-data';

jest.mock('../../src/libs/logger');
jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    webhookEndpoints: {
      create: jest
        .fn<() => Promise<Stripe.Response<Stripe.WebhookEndpoint>>>()
        .mockResolvedValue(mock__Stripe_createWebhookEndpoints_response),
      del: jest
        .fn<() => Promise<Stripe.Response<Stripe.DeletedWebhookEndpoint>>>()
        .mockResolvedValue(mock__Stripe_deleteWebhookEndpoints_response),
    }
  })),
}));

describe('actions', () => {
  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('createStripeWebhook succeded', async () => {
    Stripe.prototype.webhookEndpoints = {
      create: jest.fn(),
    } as unknown as Stripe.WebhookEndpointsResource;
    jest
      .spyOn(Stripe.prototype.webhookEndpoints, 'create')
      .mockReturnValue(Promise.resolve(mock__Stripe_createWebhookEndpoints_response));

    await Actions.createStripeWebhook('https://host.com/');

    expect(Stripe.prototype.webhookEndpoints.create).toHaveBeenCalled();
  });

  test('createStripeWebhook failed, create webhook function throws error and a log is recorded', async () => {
    Stripe.prototype.webhookEndpoints = {
      create: jest.fn(),
    } as unknown as Stripe.WebhookEndpointsResource;
    jest.spyOn(Stripe.prototype.webhookEndpoints, 'create').mockImplementation(() => {
      throw new Error('error');
    });

    await Actions.createStripeWebhook('https://host.com/');

    expect(Logger.log.error).toHaveBeenCalled();
  });

  test('deleteStripeWebhook succeded', async () => {
    Stripe.prototype.webhookEndpoints = {
      del: jest.fn(),
    } as unknown as Stripe.WebhookEndpointsResource;
    jest
      .spyOn(Stripe.prototype.webhookEndpoints, 'del')
      .mockReturnValue(Promise.resolve(mock__Stripe_deleteWebhookEndpoints_response));

    await Actions.deleteStripeWebhook();

    expect(Stripe.prototype.webhookEndpoints.del).toHaveBeenCalled();
  });

  test('deleteStripeWebhook failed, delete webhook function throws error and a log is recorded', async () => {
    Stripe.prototype.webhookEndpoints = {
      del: jest.fn(),
    } as unknown as Stripe.WebhookEndpointsResource;
    jest.spyOn(Stripe.prototype.webhookEndpoints, 'del').mockImplementation(() => {
      throw new Error('error');
    });

    await Actions.deleteStripeWebhook();

    expect(Logger.log.error).toHaveBeenCalled();
  });
});