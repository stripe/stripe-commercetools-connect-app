import { describe, expect, test } from '@jest/globals';
import {
  getSubscriptionAttributes,
  getBillingAnchor,
  getTrialSettings,
  getCancelAt,
  getSubscriptionUpdateAttributes,
} from '../../src/mappers/subscription-mapper';
import { Attribute } from '@commercetools/platform-sdk';

describe('getSubscriptionAttributes', () => {
  test('should map product attributes to Stripe subscription parameters', () => {
    const productAttributes: Attribute[] = [
      { name: 'collection_method', value: 'send_invoice' },
      { name: 'days_until_due', value: 5 },
      { name: 'billing_cycle_anchor_date', value: '2025-05-20T12:00:00Z' },
      { name: 'trial_period_days', value: 14 },
      { name: 'description', value: 'Test subscription' },
    ];

    const result = getSubscriptionAttributes(productAttributes);

    expect(result).toEqual({
      collection_method: 'send_invoice',
      days_until_due: 5,
      description: 'Test subscription',
      proration_behavior: 'create_prorations',
      billing_cycle_anchor: expect.any(Number), // Unix timestamp
      trial_period_days: 14,
    });
  });

  test('should handle undefined product attributes', () => {
    const result = getSubscriptionAttributes(undefined);
    expect(result).toEqual({
      proration_behavior: 'create_prorations',
    });
  });

  test('should set daysUntilDue to the value of days_until_due when collection_method is send_invoice', () => {
    const productAttributes: Attribute[] = [
      { name: 'collection_method', value: 'send_invoice' },
      { name: 'days_until_due', value: 5 },
    ];

    const result = getSubscriptionAttributes(productAttributes);

    expect(result.days_until_due).toBe(5);
  });

  test('should set daysUntilDue to 1 when collection_method is send_invoice and days_until_due is undefined', () => {
    const productAttributes: Attribute[] = [{ name: 'collection_method', value: 'send_invoice' }];

    const result = getSubscriptionAttributes(productAttributes);

    expect(result.days_until_due).toBe(1);
  });

  test('should set daysUntilDue to undefined when collection_method is not send_invoice', () => {
    const productAttributes: Attribute[] = [{ name: 'collection_method', value: 'charge_automatically' }];

    const result = getSubscriptionAttributes(productAttributes);

    expect(result.days_until_due).toBeUndefined();
  });
});

describe('getBillingAnchor', () => {
  test('should return billing_cycle_anchor_config with day_of_month and time', () => {
    const result = getBillingAnchor({
      billing_cycle_anchor_day: 15,
      billing_cycle_anchor_time: '12:30:45',
    });

    expect(result).toEqual({
      billing_cycle_anchor_config: {
        day_of_month: 15,
        hour: 12,
        minute: 30,
        second: 45,
      },
    });
  });

  test('should return billing_cycle_anchor_config with day_of_month only', () => {
    const result = getBillingAnchor({
      billing_cycle_anchor_day: 15,
    });

    expect(result).toEqual({
      billing_cycle_anchor_config: {
        day_of_month: 15,
      },
    });
  });

  test('should return billing_cycle_anchor with a date', () => {
    const result = getBillingAnchor({
      billing_cycle_anchor_date: '2025-05-20T12:00:00Z',
    });

    expect(result).toEqual({
      billing_cycle_anchor: expect.any(Number), // Unix timestamp
    });
  });

  test('should return undefined if no valid input is provided', () => {
    const result = getBillingAnchor({});
    expect(result).toBeUndefined();
  });
});

describe('getTrialSettings', () => {
  test('should return trial_period_days and trial_settings', () => {
    const result = getTrialSettings({
      trial_period_days: 14,
      missing_payment_method_at_trial_end: 'cancel',
    });

    expect(result).toEqual({
      trial_period_days: 14,
      trial_settings: {
        end_behavior: { missing_payment_method: 'cancel' },
      },
    });
  });

  test('should return trial_end with a date', () => {
    const result = getTrialSettings({
      trial_end_date: '2025-05-20T12:00:00Z',
    });

    expect(result).toEqual({
      trial_end: expect.any(Number), // Unix timestamp
    });
  });

  test('should return undefined if no trial settings are provided', () => {
    const result = getTrialSettings({});
    expect(result).toBeUndefined();
  });
});

describe('getCancelAt', () => {
  test('should return cancel_at_period_end when true', () => {
    const result = getCancelAt({
      cancel_at_period_end: true,
    });

    expect(result).toEqual({
      cancel_at_period_end: true,
    });
  });

  test('should return cancel_at with a date', () => {
    const result = getCancelAt({
      cancel_at: '2025-05-20T12:00:00Z',
    });

    expect(result).toEqual({
      cancel_at: expect.any(Number), // Unix timestamp
    });
  });

  test('should return undefined if no cancel settings are provided', () => {
    const result = getCancelAt({});
    expect(result).toBeUndefined();
  });
});

describe('getSubscriptionUpdateAttributes', () => {
  test('should map product attributes to Stripe subscription update parameters', () => {
    const productAttributes: Attribute[] = [
      { name: 'collection_method', value: 'send_invoice' },
      { name: 'days_until_due', value: 5 },
      { name: 'billing_cycle_anchor_date', value: '2025-05-20T12:00:00Z' },
      { name: 'trial_end_date', value: '2025-05-20T12:00:00Z' },
      { name: 'description', value: 'Test subscription update' },
      { name: 'off_session', value: true },
      { name: 'proration_behavior', value: 'none' },
      { name: 'missing_payment_method_at_trial_end', value: 'cancel' },
    ];

    const result = getSubscriptionUpdateAttributes(productAttributes);

    expect(result).toEqual({
      collection_method: 'send_invoice',
      days_until_due: 5,
      description: 'Test subscription update',
      off_session: true,
      proration_behavior: 'none',
      billing_cycle_anchor: expect.any(Number), // Unix timestamp
      trial_end: expect.any(Number), // Unix timestamp
      trial_settings: {
        end_behavior: { missing_payment_method: 'cancel' },
      },
    });
  });

  test('should handle undefined product attributes', () => {
    const result = getSubscriptionUpdateAttributes(undefined);
    expect(result).toEqual({
      proration_behavior: 'create_prorations',
    });
  });

  test('should set daysUntilDue to the value of days_until_due when collection_method is send_invoice', () => {
    const productAttributes: Attribute[] = [
      { name: 'collection_method', value: 'send_invoice' },
      { name: 'days_until_due', value: 7 },
    ];

    const result = getSubscriptionUpdateAttributes(productAttributes);

    expect(result.days_until_due).toBe(7);
  });

  test('should set daysUntilDue to 1 when collection_method is send_invoice and days_until_due is undefined', () => {
    const productAttributes: Attribute[] = [{ name: 'collection_method', value: 'send_invoice' }];

    const result = getSubscriptionUpdateAttributes(productAttributes);

    expect(result.days_until_due).toBe(1);
  });

  test('should set daysUntilDue to undefined when collection_method is not send_invoice', () => {
    const productAttributes: Attribute[] = [{ name: 'collection_method', value: 'charge_automatically' }];

    const result = getSubscriptionUpdateAttributes(productAttributes);

    expect(result.days_until_due).toBeUndefined();
  });

  test('should use default proration_behavior when not specified', () => {
    const productAttributes: Attribute[] = [{ name: 'collection_method', value: 'charge_automatically' }];

    const result = getSubscriptionUpdateAttributes(productAttributes);

    expect(result.proration_behavior).toBe('create_prorations');
  });

  test('should handle trial settings with missing payment method behavior', () => {
    const productAttributes: Attribute[] = [
      { name: 'trial_end_date', value: '2025-05-20T12:00:00Z' },
      { name: 'missing_payment_method_at_trial_end', value: 'pause' },
    ];

    const result = getSubscriptionUpdateAttributes(productAttributes);

    expect(result.trial_settings).toEqual({
      end_behavior: { missing_payment_method: 'pause' },
    });
  });
});
