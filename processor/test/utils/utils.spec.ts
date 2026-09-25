import Stripe from 'stripe';
import { describe, test, expect, jest } from '@jest/globals';
import {
  convertDateToUnixTimestamp,
  convertPaymentResultCode,
  getLocalizedString,
  isBankTransferNextAction,
  isMicrodepositNextAction,
  isFromSubscriptionInvoice,
  isValidUUID,
  paidAmountMatchesTotal,
  parseJSON,
  parseTimeString,
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

  test('rejects underpayment', () => {
    expect(paidAmountMatchesTotal(2000, 'usd', usd(7000))).toBe(false);
  });

  // Equality, not ">=": an overpayment is as much a divergence as an underpayment and must not
  // silently mint an order either.
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
