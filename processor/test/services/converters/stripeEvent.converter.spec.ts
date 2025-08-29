import { describe, test, expect } from '@jest/globals';
import { StripeEventConverter } from '../../../src/services/converters/stripeEventConverter';
import {
  mockEvent__charge_refund_captured,
  mockEvent__paymentIntent_canceled,
  mockEvent__paymentIntent_paymentFailed,
  mockEvent__paymentIntent_succeeded_captureMethodAutomatic,
  mockEvent__charge_succeeded_notCaptured,
  mockEvent__charge_refund_notCaptured,
  mockEvent__charge_succeeded_captured,
} from '../../utils/mock-routes-data';

describe('stripeEvent.converter', () => {
  const converter = new StripeEventConverter();

  test('convert a payment_intent.succeeded event', () => {
    const result = converter.convert(mockEvent__paymentIntent_succeeded_captureMethodAutomatic);

    expect(result).toEqual({
      paymentMethod: undefined,
      id: 'pi_11111',
      pspReference: 'pi_11111',
      pspInteraction: {
        response: JSON.stringify(mockEvent__paymentIntent_succeeded_captureMethodAutomatic),
      },
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
      id: 'pi_11111',
      paymentMethod: undefined,
      pspReference: 'pi_11111',
      pspInteraction: {
        response: JSON.stringify(mockEvent__paymentIntent_canceled),
      },
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
      id: undefined,
      paymentMethod: undefined,
      pspInteraction: {
        response: JSON.stringify(mockEvent__paymentIntent_paymentFailed),
      },
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

  test('convert a charge.refunded event', () => {
    const result = converter.convert(mockEvent__charge_refund_captured);

    expect(result).toEqual({
      id: 'pi_11111',
      paymentMethod: 'card',
      pspReference: 'pi_11111',
      pspInteraction: {
        response: JSON.stringify(mockEvent__charge_refund_captured),
      },
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

  test('convert a non supported event notification should throw error with proper message', () => {
    const event = JSON.parse(JSON.stringify(mockEvent__charge_refund_captured));
    event.type = 'account.application.deauthorized';

    expect(() => {
      converter.convert(event);
    }).toThrow('Unsupported event account.application.deauthorized');
  });

  test('convert a charge event without payment_intent should use charge id as pspReference', () => {
    const event = JSON.parse(JSON.stringify(mockEvent__charge_refund_captured));
    event.data.object.payment_intent = null;

    const result = converter.convert(event);

    expect(result).toEqual({
      id: 'pi_11111',
      paymentMethod: 'card',
      pspReference: 'ch_11111',
      pspInteraction: {
        response: JSON.stringify(event),
      },
      transactions: [
        {
          amount: {
            centAmount: 34500,
            currencyCode: 'MXN',
          },
          interactionId: 'ch_11111',
          state: 'Success',
          type: 'Refund',
        },
        {
          amount: {
            centAmount: 34500,
            currencyCode: 'MXN',
          },
          interactionId: 'ch_11111',
          state: 'Success',
          type: 'Chargeback',
        },
      ],
    });
  });

  test('convert a charge event without payment_method_details should handle missing payment method', () => {
    const event = JSON.parse(JSON.stringify(mockEvent__charge_refund_captured));
    event.data.object.payment_method_details = null;

    const result = converter.convert(event);

    expect(result).toEqual({
      id: 'pi_11111',
      paymentMethod: '',
      pspReference: 'pi_11111',
      pspInteraction: {
        response: JSON.stringify(event),
      },
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

  test('convert a charge.succeeded event', () => {
    const result = converter.convert(mockEvent__charge_succeeded_notCaptured);

    expect(result).toEqual({
      id: 'pi_11111',
      paymentMethod: 'card',
      pspReference: 'pi_11111',
      pspInteraction: {
        response: JSON.stringify(mockEvent__charge_succeeded_notCaptured),
      },
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

  test('convert a charge.succeeded event with captured: true should return empty transactions', () => {
    const event = { ...mockEvent__charge_succeeded_captured };
    event.type = 'charge.succeeded';

    const result = converter.convert(event);

    expect(result).toEqual({
      id: undefined,
      paymentMethod: 'card',
      pspReference: 'pi_11111',
      pspInteraction: {
        response: JSON.stringify(event),
      },
      transactions: [],
    });
  });

  test('convert a charge.refunded event with captured: false should return empty transactions', () => {
    const result = converter.convert(mockEvent__charge_refund_notCaptured);

    expect(result).toEqual({
      id: 'pi_11111',
      paymentMethod: 'card',
      pspReference: 'pi_11111',
      pspInteraction: {
        response: JSON.stringify(mockEvent__charge_refund_notCaptured),
      },
      transactions: [],
    });
  });

  test('convert a charge.refunded event with captured: true should return refund transactions', () => {
    const event = JSON.parse(JSON.stringify(mockEvent__charge_refund_captured));
    const result = converter.convert(event);

    expect(result).toEqual({
      id: 'pi_11111',
      paymentMethod: 'card',
      pspReference: 'pi_11111',
      pspInteraction: {
        response: JSON.stringify(event),
      },
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

  test('convert a non supported event notification should throw error with proper message', () => {
    const event = mockEvent__charge_refund_captured;
    event.type = 'account.application.deauthorized';

    expect(() => {
      converter.convert(event);
    }).toThrow('Unsupported event account.application.deauthorized');
  });
});
