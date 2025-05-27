import Stripe from 'stripe';
import { describe, test, expect, jest } from '@jest/globals';
import {
  convertDateToUnixTimestamp,
  convertPaymentResultCode,
  getLocalizedString,
  isFromSubscriptionInvoice,
  isValidUUID,
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
  test('should return true for a payment event with an invoice', () => {
    const event = {
      type: 'payment_intent.succeeded',
      data: { object: { invoice: 'in_123' } },
    } as Stripe.Event;
    expect(isFromSubscriptionInvoice(event)).toBe(true);
  });

  test('should return true for a charge event with an invoice', () => {
    const event = {
      type: 'charge.succeeded',
      data: { object: { invoice: 'in_123' } },
    } as Stripe.Event;
    expect(isFromSubscriptionInvoice(event)).toBe(true);
  });

  test('should return false for an event without an invoice', () => {
    const event = {
      type: 'payment_intent.succeeded',
      data: { object: {} },
    } as Stripe.Event;
    expect(isFromSubscriptionInvoice(event)).toBe(false);
  });

  test('should return false for an event without an invoice', () => {
    const event = {
      type: 'invoice.paid',
      data: { object: {} },
    } as Stripe.Event;
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
