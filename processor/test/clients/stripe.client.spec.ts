import { describe, test, expect, afterEach, jest, beforeEach } from '@jest/globals';
import * as StripeClient from '../../src/clients/stripe.client';
import { mockCancelPaymentErrorResult } from '../utils/mock-payment-results';
import { StripeApiError } from '../../src/errors/stripe-api.error';
import * as Logger from '../../src/libs/logger';

jest.mock('../../src/libs/logger');

describe('wrapStripeError', () => {
  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should return the original error due to a general error', async () => {
    const error = new Error('Error');

    const result = StripeClient.wrapStripeError(error);

    expect(result.message).toBe('Error');
    expect(Logger.log.error).toHaveBeenCalledTimes(1);
  });

  test('should return a StripeApiError', async () => {
    const result = StripeClient.wrapStripeError(JSON.parse(JSON.stringify(mockCancelPaymentErrorResult)));

    const resultStripeApiError = result as StripeApiError;

    expect(result).toBeInstanceOf(StripeApiError);
    expect(resultStripeApiError.message).toBe('No such payment_intent: 07bd2613-8daf-4760-a5c4-21d6cca91276');
    expect(resultStripeApiError.code).toBe('resource_missing');
  });
});
