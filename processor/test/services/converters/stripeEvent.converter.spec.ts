import { describe, test, expect } from '@jest/globals';
import { StripeEventConverter } from '../../../src/services/converters/stripeEventConverter';
import {
  mockEvent__charge_refund_captured,
  mockEvent__paymentIntent_canceled,
  mockEvent__paymentIntent_paymentFailed,
  mockEvent__paymentIntent_succeeded_captureMethodAutomatic,
  mockEvent__charge_succeeded_notCaptured,
} from '../../utils/mock-routes-data';

describe('stripeEvent.converter', () => {
  const converter = new StripeEventConverter();

  test('convert a payment_intent.succeeded event', () => {
    const result = converter.convert(mockEvent__paymentIntent_succeeded_captureMethodAutomatic);

    expect(result).toEqual({
      paymentMethod: 'payment',
      pspReference: 'pi_11111',
      transactions: [
        {
          amount: {
            centAmount: 13200,
            currencyCode: 'MXN',
          },
          interactionId: 'pi_11111',
          state: 'Success',
          type: 'Charge',
        },
      ],
    });
  });

  test('convert a payment_intent.canceled event', () => {
    const result = converter.convert(mockEvent__paymentIntent_canceled);

    expect(result).toEqual({
      paymentMethod: 'payment',
      pspReference: 'pi_11111',
      transactions: [
        {
          amount: {
            centAmount: 0,
            currencyCode: 'MXN',
          },
          interactionId: 'pi_11111',
          state: 'Failure',
          type: 'Authorization',
        },
        {
          amount: {
            centAmount: 0,
            currencyCode: 'MXN',
          },
          interactionId: 'pi_11111',
          state: 'Success',
          type: 'CancelAuthorization',
        },
      ],
    });
  });

  test('convert a payment_intent.payment_failed event', () => {
    const result = converter.convert(mockEvent__paymentIntent_paymentFailed);

    expect(result).toEqual({
      paymentMethod: 'payment',
      pspReference: 'pi_11111',
      transactions: [
        {
          amount: {
            centAmount: 0,
            currencyCode: 'MXN',
          },
          interactionId: 'pi_11111',
          state: 'Failure',
          type: 'Authorization',
        },
      ],
    });
  });

  test('convert a payment_intent.payment_failed event', () => {
    const result = converter.convert(mockEvent__charge_refund_captured);

    expect(result).toEqual({
      id: 'pi_11111',
      paymentMethod: 'payment',
      pspReference: 'pi_11111',
      transactions: [
        {
          amount: {
            centAmount: 34500,
            currencyCode: 'MXN',
          },
          interactionId: 'pi_11111',
          state: 'Success',
          type: 'Refund',
        },
        {
          amount: {
            centAmount: 34500,
            currencyCode: 'MXN',
          },
          interactionId: 'pi_11111',
          state: 'Success',
          type: 'Chargeback',
        },
      ],
    });
  });

  test('convert a non supported event notification', () => {
    const event = mockEvent__charge_refund_captured;
    event.type = 'account.application.deauthorized';

    try {
      converter.convert(event);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });

  test('convert a charge.succeeded event', () => {
    const result = converter.convert(mockEvent__charge_succeeded_notCaptured);

    expect(result).toEqual({
      paymentMethod: 'payment',
      pspReference: 'pi_11111',
      transactions: [
        {
          amount: {
            centAmount: 0,
            currencyCode: 'MXN',
          },
          interactionId: 'pi_11111',
          state: 'Success',
          type: 'Authorization',
        },
      ],
    });
  });
});
