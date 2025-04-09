import { describe, test, expect, jest } from '@jest/globals';
import { convertPaymentResultCode, parseJSON } from '../../src/utils';
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
