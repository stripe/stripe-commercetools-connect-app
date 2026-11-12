import Stripe from 'stripe';
import { describe, test, expect, jest } from '@jest/globals';
import {
  convertDateToUnixTimestamp,
  convertPaymentResultCode,
  getLocalizedString,
  isBankTransferNextAction,
  isConcurrentModificationError,
  isMicrodepositNextAction,
  isFromSubscriptionInvoice,
  isRetryableCtError,
  isTransientStripeError,
  isValidUUID,
  paidAmountMatchesTotal,
  parseJSON,
  parseTimeString,
  redactError,
  transformVariantAttributes,
} from '../../src/utils';
import { PaymentOutcome } from '../../src/dtos/mock-payment.dto';

describe('parseJSON', () => {
  test('should parse valid JSON string', () => {
    const jsonString = '{"key": "test value"}';
    const result = parseJSON<{ key: string }>(jsonString);
    expect(result).toEqual({ key: 'test value' });
  });

  test('should return empty object for invalid string and log error', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const jsonString = 'invalid json';
    const result = parseJSON<{ key: string }>(jsonString);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error parsing JSON', expect.any(SyntaxError));
    expect(result).toEqual({});
    consoleErrorSpy.mockRestore();
  });

  test('should return empty object for empty string', () => {
    const jsonString = '';
    const result = parseJSON<{ key: string }>(jsonString);
    expect(result).toEqual({});
  });

  test('should return empty object for null', () => {
    const jsonString = null as unknown as string;
    const result = parseJSON<{ key: string }>(jsonString);
    expect(result).toEqual({});
  });

  test('should return empty object for undefined', () => {
    const jsonString = undefined as unknown as string;
    const result = parseJSON<{ key: string }>(jsonString);
    expect(result).toEqual({});
  });
});

describe('convertPaymentResultCode', () => {
  test('should convert AUTHORIZED to Success', () => {
    const result = convertPaymentResultCode(PaymentOutcome.AUTHORIZED);
    expect(result).toBe('Success');
  });

  test('should convert REJECTED to Failure', () => {
    const result = convertPaymentResultCode(PaymentOutcome.REJECTED);
    expect(result).toBe('Failure');
  });

  test('should convert other values to Initial', () => {
    const result = convertPaymentResultCode('test' as PaymentOutcome);
    expect(result).toBe('Initial');
  });
});

describe('isValidUUID', () => {
  test('should return true for a valid UUID', () => {
    const validUUID = '123e4567-e89b-12d3-a456-426614174000';
    expect(isValidUUID(validUUID)).toBe(true);
  });

  test('should return false for an invalid UUID', () => {
    const invalidUUID = 'invalid-uuid';
    expect(isValidUUID(invalidUUID)).toBe(false);
  });

  test('should return false for an empty string', () => {
    expect(isValidUUID('')).toBe(false);
  });
});

describe('isFromSubscriptionInvoice', () => {
  /**
   * EVERY TEST HERE USED TO FABRICATE `invoice` ON THE EVENT OBJECT, and that is precisely why they
   * stayed green while production was broken. Stripe removed `invoice` from PaymentIntent in the
   * Basil API version (2025-03-31), and it is absent from Charge on current versions too — measured
   * 2026-08-05 on API version 2026-06-24.dahlia against a real subscription charge, where both came
   * back null even though the invoice genuinely owned the PaymentIntent.
   *
   * The payloads below marked "real shape" are copied from that measurement. The `invoice` cases are
   * kept, relabelled as the pre-Basil path they actually test.
   */
  const SUBSCRIPTION_METADATA = {
    cart_id: 'b2e74d9a-cd28-40b8-a29c-8e4e30f6b491',
    ct_payment_id: '7ac90d5e-1a6d-4f34-b405-4908ef5dca3a',
    subscription_id: 'sub_1U1F83L2sIzjTVbdqn1rZSSz',
  };

  test('real shape: a subscription PaymentIntent with NO invoice field is recognised by metadata', () => {
    // The exact regression. This event previously returned false and its money was booked twice in
    // commercetools: once from the invoice, once again from payment_intent.succeeded.
    const event = {
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_3U1F84L2sIzjTVbd1fbAG8pl', metadata: SUBSCRIPTION_METADATA } },
    } as unknown as Stripe.Event;
    expect(isFromSubscriptionInvoice(event)).toBe(true);
  });

  test('real shape: a subscription Charge with NO invoice field is recognised by metadata', () => {
    const event = {
      type: 'charge.succeeded',
      data: { object: { id: 'py_3U1F84L2sIzjTVbd1X0Yx60R', metadata: SUBSCRIPTION_METADATA } },
    } as unknown as Stripe.Event;
    expect(isFromSubscriptionInvoice(event)).toBe(true);
  });

  test('real shape: an ordinary card Charge is NOT treated as a subscription', () => {
    // Negative control, measured alongside the two above: a standalone payment carries connector
    // metadata but no subscription_id. If this ever returns true, every normal payment stops being
    // booked in commercetools.
    const event = {
      type: 'charge.succeeded',
      data: {
        object: {
          id: 'ch_3U1F6cL2sIzjTVbd0hdXYeoW',
          metadata: { cart_id: 'f9943c77-83dd-4abc-9a4e-77d3c272d713', ct_payment_id: 'abc' },
        },
      },
    } as unknown as Stripe.Event;
    expect(isFromSubscriptionInvoice(event)).toBe(false);
  });

  test('an empty subscription_id is not a subscription', () => {
    // Stripe metadata values are strings; an empty one must not read as present.
    const event = {
      type: 'payment_intent.succeeded',
      data: { object: { metadata: { subscription_id: '' } } },
    } as unknown as Stripe.Event;
    expect(isFromSubscriptionInvoice(event)).toBe(false);
  });

  test('pre-Basil: a payment event still carrying invoice is recognised', () => {
    // Retained for accounts pinned to an older API version, where invoice is the authoritative link.
    const event = {
      type: 'payment_intent.succeeded',
      data: { object: { invoice: 'in_123' } },
    } as Stripe.Event;
    expect(isFromSubscriptionInvoice(event)).toBe(true);
  });

  test('pre-Basil: a charge event still carrying invoice is recognised', () => {
    const event = {
      type: 'charge.succeeded',
      data: { object: { invoice: 'in_123' } },
    } as Stripe.Event;
    expect(isFromSubscriptionInvoice(event)).toBe(true);
  });

  test('a payment event with neither signal is not a subscription', () => {
    const event = {
      type: 'payment_intent.succeeded',
      data: { object: {} },
    } as Stripe.Event;
    expect(isFromSubscriptionInvoice(event)).toBe(false);
  });

  test('an event that is neither payment nor charge is never a subscription invoice', () => {
    // Guards the early return: invoice.paid carries subscription metadata of its own and must not
    // be short-circuited by this helper.
    const event = {
      type: 'invoice.paid',
      data: { object: { metadata: SUBSCRIPTION_METADATA } },
    } as unknown as Stripe.Event;
    expect(isFromSubscriptionInvoice(event)).toBe(false);
  });

  test('should return true for a Clover-shaped PI failure with subscription_id metadata and no invoice', () => {
    const event = {
      type: 'payment_intent.payment_failed',
      data: { object: { metadata: { subscription_id: 'sub_123' } } },
    } as unknown as Stripe.Event;
    expect(isFromSubscriptionInvoice(event)).toBe(true);
  });

  test('should return false for an ordinary charge with unrelated metadata and no invoice', () => {
    const event = {
      type: 'charge.succeeded',
      data: { object: { metadata: { order_id: '1042' } } },
    } as unknown as Stripe.Event;
    expect(isFromSubscriptionInvoice(event)).toBe(false);
  });
});

describe('transformVariantAttributes', () => {
  test('should transform attributes into a key-value object', () => {
    const attributes = [
      { name: 'color', value: 'red' },
      { name: 'size', value: { key: 'large' } },
    ];
    const result = transformVariantAttributes(attributes);
    expect(result).toEqual({ color: 'red', size: 'large' });
  });

  test('should strip stripeConnector_ prefix from attribute names', () => {
    const attributes = [
      { name: 'stripeConnector_description', value: 'Test subscription' },
      { name: 'stripeConnector_recurring_interval', value: { key: 'month' } },
      { name: 'stripeConnector_off_session', value: true },
    ];
    const result = transformVariantAttributes(attributes);
    expect(result).toEqual({
      description: 'Test subscription',
      recurring_interval: 'month',
      off_session: true,
    });
  });

  test('should return an empty object for undefined attributes', () => {
    const result = transformVariantAttributes(undefined);
    expect(result).toEqual({});
  });
});

describe('convertDateToUnixTimestamp', () => {
  test('should convert a date string to a Unix timestamp', () => {
    const date = '2025-05-20T12:00:00Z';
    const result = convertDateToUnixTimestamp(date);
    expect(result).toBe(1747742400);
  });

  test('should convert a number to a Unix timestamp', () => {
    const date = 1742740800000;
    const result = convertDateToUnixTimestamp(date);
    expect(result).toBe(1742740800);
  });
});

describe('parseTimeString', () => {
  test('should parse a valid time string', () => {
    const timeString = '12:34:56.789';
    const result = parseTimeString(timeString);
    expect(result).toEqual({ hour: 12, minute: 34, second: 56 });
  });

  test('should handle missing milliseconds', () => {
    const timeString = '12:34:56';
    const result = parseTimeString(timeString);
    expect(result).toEqual({ hour: 12, minute: 34, second: 56 });
  });
});

describe('getLocalizedString', () => {
  test('should return an empty string if no localized value is available', () => {
    expect(getLocalizedString(undefined)).toBe('');
  });

  test('should return the first English-like key if multiple are available', () => {
    const localizedString = { 'en-US': 'Hello', 'en-GB': 'Hi' };
    expect(getLocalizedString(localizedString)).toBe('Hello');
  });

  test('should return empty string if english is not available', () => {
    const localizedString = { 'es-MX': 'Hola' };
    expect(getLocalizedString(localizedString)).toBe('');
  });
});

describe('isBankTransferNextAction', () => {
  const withNextAction = (nextAction: unknown): Stripe.PaymentIntent =>
    ({ next_action: nextAction }) as Stripe.PaymentIntent;

  test('returns true for a PaymentIntent awaiting a bank transfer', () => {
    const paymentIntent = withNextAction({
      type: 'display_bank_transfer_instructions',
      display_bank_transfer_instructions: { reference: 'BT-REF-11111', amount_remaining: 12300 },
    });
    expect(isBankTransferNextAction(paymentIntent)).toBe(true);
  });

  // RELEASE GATE: card 3DS emits the same payment_intent.requires_action event.
  test('returns false for a card 3DS PaymentIntent (use_stripe_sdk)', () => {
    const paymentIntent = withNextAction({ type: 'use_stripe_sdk', use_stripe_sdk: {} });
    expect(isBankTransferNextAction(paymentIntent)).toBe(false);
  });

  test('returns false for a Boleto PaymentIntent (boleto_display_details)', () => {
    const paymentIntent = withNextAction({ type: 'boleto_display_details', boleto_display_details: {} });
    expect(isBankTransferNextAction(paymentIntent)).toBe(false);
  });

  test('returns false for a redirect PaymentIntent', () => {
    const paymentIntent = withNextAction({ type: 'redirect_to_url', redirect_to_url: {} });
    expect(isBankTransferNextAction(paymentIntent)).toBe(false);
  });

  test('returns false when next_action is null or undefined', () => {
    expect(isBankTransferNextAction(withNextAction(null))).toBe(false);
    expect(isBankTransferNextAction({} as Stripe.PaymentIntent)).toBe(false);
  });

  // Fails closed: the type literal alone is not enough, the payload must be there.
  test('returns false when the type matches but the instructions object is absent', () => {
    const paymentIntent = withNextAction({ type: 'display_bank_transfer_instructions' });
    expect(isBankTransferNextAction(paymentIntent)).toBe(false);
  });

  // RELEASE GATE: micro-deposits is a distinct rail with its own predicate — this one must NOT match
  // it, or the two predicates would overlap.
  test('returns false for a micro-deposit PaymentIntent (verify_with_microdeposits)', () => {
    const paymentIntent = withNextAction({
      type: 'verify_with_microdeposits',
      verify_with_microdeposits: { hosted_verification_url: 'https://example.test/md' },
    });
    expect(isBankTransferNextAction(paymentIntent)).toBe(false);
  });
});

describe('isMicrodepositNextAction', () => {
  const withNextAction = (nextAction: unknown): Stripe.PaymentIntent =>
    ({ next_action: nextAction }) as Stripe.PaymentIntent;

  test('returns true for a PaymentIntent awaiting ACH micro-deposit verification', () => {
    const paymentIntent = withNextAction({
      type: 'verify_with_microdeposits',
      verify_with_microdeposits: {
        arrival_date: 123,
        hosted_verification_url: 'https://example.test/md',
        microdeposit_type: 'descriptor_code',
      },
    });
    expect(isMicrodepositNextAction(paymentIntent)).toBe(true);
  });

  // RELEASE GATE: card 3DS and Boleto emit requires_action too — freezing on them would be a
  // severe regression, so this predicate must stay disjoint.
  test('returns false for a card 3DS PaymentIntent (use_stripe_sdk)', () => {
    expect(isMicrodepositNextAction(withNextAction({ type: 'use_stripe_sdk', use_stripe_sdk: {} }))).toBe(false);
  });

  test('returns false for a Boleto PaymentIntent (boleto_display_details)', () => {
    expect(
      isMicrodepositNextAction(withNextAction({ type: 'boleto_display_details', boleto_display_details: {} })),
    ).toBe(false);
  });

  test('returns false for a bank transfer PaymentIntent (display_bank_transfer_instructions)', () => {
    const paymentIntent = withNextAction({
      type: 'display_bank_transfer_instructions',
      display_bank_transfer_instructions: { reference: 'BT-REF-11111' },
    });
    expect(isMicrodepositNextAction(paymentIntent)).toBe(false);
  });

  test('returns false when next_action is null or undefined', () => {
    expect(isMicrodepositNextAction(withNextAction(null))).toBe(false);
    expect(isMicrodepositNextAction({} as Stripe.PaymentIntent)).toBe(false);
  });

  // Fails closed: the type literal alone is not enough, the payload must be present.
  test('returns false when the type matches but the verification object is absent', () => {
    expect(isMicrodepositNextAction(withNextAction({ type: 'verify_with_microdeposits' }))).toBe(false);
  });
});

describe('paidAmountMatchesTotal', () => {
  const usd = (centAmount: number) => ({ centAmount, currencyCode: 'USD' });

  test('matches an exact amount and currency, case-insensitively', () => {
    expect(paidAmountMatchesTotal(2000, 'usd', usd(2000))).toBe(true);
  });

  test('rejects an amount shortfall', () => {
    expect(paidAmountMatchesTotal(2000, 'usd', usd(7000))).toBe(false);
  });

  // Equality, not ">=": an overpayment is as much a divergence as an amount shortfall and must not
  // mint an order either.
  test('rejects overpayment', () => {
    expect(paidAmountMatchesTotal(7000, 'usd', usd(2000))).toBe(false);
  });

  test('rejects a currency mismatch even when the amounts are equal', () => {
    expect(paidAmountMatchesTotal(2000, 'eur', usd(2000))).toBe(false);
  });

  // Minor-unit comparison with no division by 100, so zero-decimal currencies are handled correctly.
  test('compares zero-decimal currencies in their own minor unit', () => {
    expect(paidAmountMatchesTotal(2000, 'jpy', { centAmount: 2000, currencyCode: 'JPY' })).toBe(true);
    expect(paidAmountMatchesTotal(20, 'jpy', { centAmount: 2000, currencyCode: 'JPY' })).toBe(false);
  });
});

/**
 * A realistic commercetools-SDK optimistic-locking error: an `Error` whose structured fields carry the
 * signal (`code`/`statusCode`) while the human `message` does NOT contain "ConcurrentModification" or
 * "409". This is the exact shape that escaped classification in the live repro — the tests below
 * exist to keep message-only classification from ever being reintroduced.
 */
const realConcurrentModificationError = (): Error => {
  return Object.assign(new Error('Object abc has a different version than expected. Expected: 10 - Actual: 12.'), {
    code: 'ConcurrentModification',
    statusCode: 409,
  });
};

describe('isRetryableCtError', () => {
  // ADR-027: the payments SDK's own errors (e.g. getPayment) carry the HTTP status in `httpErrorStatus`.
  test.each([502, 503, 429, 409])('classifies a payments-SDK error with httpErrorStatus %s as retryable', (status) => {
    expect(isRetryableCtError(Object.assign(new Error('General error'), { httpErrorStatus: status }))).toBe(true);
  });

  test('keeps a payments-SDK 404 (httpErrorStatus) permanent', () => {
    expect(isRetryableCtError(Object.assign(new Error('Not found'), { httpErrorStatus: 404 }))).toBe(false);
  });

  // The regression guard: a REAL CT 409 carries the signal only on its structured fields.
  test('classifies a realistic ConcurrentModification (code + statusCode 409, no token in message) as retryable', () => {
    expect(isRetryableCtError(realConcurrentModificationError())).toBe(true);
  });

  test('classifies other transient CT errors by statusCode', () => {
    expect(isRetryableCtError(Object.assign(new Error('Service Unavailable'), { statusCode: 503 }))).toBe(true);
    expect(isRetryableCtError(Object.assign(new Error('Too Many Requests'), { statusCode: 429 }))).toBe(true);
  });

  // Still matches the legacy message form, so callers that only have a stringly-typed error keep working.
  test('still matches a retryable token carried in the message', () => {
    expect(isRetryableCtError(new Error('ETIMEDOUT'))).toBe(true);
    expect(isRetryableCtError('ECONNRESET while writing to commercetools')).toBe(true);
  });

  // A genuinely terminal error: a 400 whose code is not retryable and whose message has no token.
  test('classifies a terminal validation error (InvalidField 400) as NOT retryable', () => {
    const terminal = Object.assign(new Error('Address.state is not a valid value.'), {
      code: 'InvalidField',
      statusCode: 400,
    });
    expect(isRetryableCtError(terminal)).toBe(false);
  });

  test('classifies an unknown non-Error value without a retryable signal as NOT retryable', () => {
    expect(isRetryableCtError({ foo: 'bar' })).toBe(false);
  });
});

describe('isConcurrentModificationError', () => {
  test('detects a realistic ConcurrentModification by its structured fields (message has no token)', () => {
    expect(isConcurrentModificationError(realConcurrentModificationError())).toBe(true);
  });

  test('detects a 409 carried on statusCode even without the ConcurrentModification code', () => {
    expect(isConcurrentModificationError(Object.assign(new Error('Conflict'), { statusCode: 409 }))).toBe(true);
  });

  // Deliberately narrower than isRetryableCtError: a 503 is transient but NOT a version race, so a
  // re-read-and-retry cannot resolve it.
  test('does NOT treat a non-409 transient (503) as a concurrent modification', () => {
    expect(isConcurrentModificationError(Object.assign(new Error('Service Unavailable'), { statusCode: 503 }))).toBe(
      false,
    );
  });

  test('still matches a legacy token in the message', () => {
    expect(isConcurrentModificationError(new Error('ConcurrentModification'))).toBe(true);
  });
});

describe('redactError', () => {
  const SENTINEL = 'pi_SENTINEL_secret_DO_NOT_LOG';

  const buildStripeError = (): Error => {
    const err = Object.assign(new Error('Your card was declined.'), {
      name: 'StripeCardError',
      code: 'card_declined',
      statusCode: 402,
      decline_code: 'generic_decline',
      requestId: 'req_123',
      // own-enumerable Stripe props that a naive { error } would serialize
      payment_intent: { id: 'pi_123', client_secret: SENTINEL },
      raw: { payment_intent: { id: 'pi_123', client_secret: SENTINEL }, code: 'card_declined', statusCode: 402 },
    });
    return err;
  };

  test('keeps the diagnostic whitelist and drops the raw/payment_intent that carry client_secret', () => {
    const safe = redactError(buildStripeError());

    // classification survives
    expect(safe).toMatchObject({
      name: 'StripeCardError',
      code: 'card_declined',
      statusCode: 402,
      decline_code: 'generic_decline',
      requestId: 'req_123',
    });
    // the secret and its carriers never appear
    expect(safe).not.toHaveProperty('payment_intent');
    expect(safe).not.toHaveProperty('raw');
    expect(JSON.stringify(safe)).not.toContain(SENTINEL);
  });

  test('is pure — never mutates the live error (downstream classification reads the live object)', () => {
    const err = buildStripeError() as Error & { payment_intent: { client_secret: string } };
    redactError(err);
    expect(err.payment_intent.client_secret).toBe(SENTINEL);
  });

  test('surfaces safe fields off a wrapped .cause without serializing its raw payload', () => {
    const wrapped = Object.assign(new Error('Stripe API call failed'), {
      name: 'StripeApiError',
      cause: buildStripeError(),
    });
    const safe = redactError(wrapped) as { cause?: Record<string, unknown> };
    expect(safe.cause).toMatchObject({ code: 'card_declined' });
    expect(JSON.stringify(safe)).not.toContain(SENTINEL);
  });

  test('terminates on a cyclic cause chain instead of overflowing the stack', () => {
    const a = new Error('A') as Error & { cause?: unknown };
    const b = new Error('B') as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(() => redactError(a)).not.toThrow();
    expect(JSON.stringify(redactError(a))).toContain('"name"');
  });

  test('handles non-Error throwables without leaking', () => {
    expect(redactError('boom')).toEqual({ message: 'boom' });
    expect(redactError({ secret: SENTINEL })).toEqual({ message: 'Non-Error thrown value' });
  });

  test('keeps httpErrorStatus for a non-Stripe Errorx (which has no statusCode)', () => {
    // connect-payments-sdk's Errorx carries the HTTP status on `httpErrorStatus`, not `statusCode`.
    // Without it in the whitelist, the redacted log would drop the status for non-Stripe errors.
    const errorx = Object.assign(new Error('Invalid field'), {
      name: 'ErrorGeneral',
      code: 'InvalidInput',
      httpErrorStatus: 400,
    });
    const safe = redactError(errorx);
    expect(safe).toMatchObject({ name: 'ErrorGeneral', code: 'InvalidInput', httpErrorStatus: 400 });
    expect(safe).not.toHaveProperty('statusCode');
  });

  test('does not surface the private Errorx diagnostics privateMessage / privateFields', () => {
    const errorx = Object.assign(new Error('Auth failed'), {
      name: 'ErrorAuthErrorResponse',
      code: 'invalid_token',
      httpErrorStatus: 401,
      privateMessage: 'expected issuer https://a, got https://b',
      privateFields: { issuer: 'https://b', clientId: 'cid', session: '{"customerId":"c1"}' },
    });
    const safe = redactError(errorx) as Record<string, unknown>;
    expect(safe).toMatchObject({ code: 'invalid_token', httpErrorStatus: 401 });
    expect(safe).not.toHaveProperty('privateMessage');
    expect(safe).not.toHaveProperty('privateFields');
  });
});

// ADR-027: which failures of the hold's Stripe call are worth a webhook redelivery.
describe('isTransientStripeError', () => {
  test.each([
    ['a connection error', { type: 'StripeConnectionError' }],
    ['a Stripe-side error', { type: 'StripeAPIError', statusCode: 500 }],
    ['a rate limit or lock timeout', { type: 'StripeRateLimitError', statusCode: 429 }],
    ['a conflict', { type: 'StripeInvalidRequestError', statusCode: 409 }],
    ['an untyped 503', { statusCode: 503 }],
  ])('is transient for %s', (_case, error) => {
    expect(isTransientStripeError(error)).toBe(true);
  });

  test.each([
    [
      'a canceled subscription (measured)',
      { type: 'StripeInvalidRequestError', statusCode: 400, code: 'invalid_canceled_subscription_fields' },
    ],
    [
      'a missing subscription (measured)',
      { type: 'StripeInvalidRequestError', statusCode: 404, code: 'resource_missing' },
    ],
    ['an authentication error', { type: 'StripeAuthenticationError', statusCode: 401 }],
    ['an idempotency mismatch', { type: 'StripeIdempotencyError', statusCode: 400 }],
    ['an unknown value', new Error('boom')],
    ['nothing', undefined],
  ])('is permanent for %s', (_case, error) => {
    expect(isTransientStripeError(error)).toBe(false);
  });
});
