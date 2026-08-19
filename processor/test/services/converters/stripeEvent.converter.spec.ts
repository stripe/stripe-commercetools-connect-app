import Stripe from 'stripe';
import { describe, test, expect } from '@jest/globals';
import { StripeEventConverter } from '../../../src/services/converters/stripeEventConverter';
import {
  mockEvent__charge_refund_captured,
  mockEvent__paymentIntent_canceled,
  mockEvent__paymentIntent_paymentFailed,
  mockEvent__paymentIntent_succeeded_captureMethodAutomatic,
  mockEvent__paymentIntent_processing_crypto,
  mockEvent__charge_succeeded_notCaptured,
  mockEvent__charge_refund_notCaptured,
  mockEvent__charge_succeeded_captured,
  mockEvent__paymentIntent_requiresAction_bankTransfer,
  mockEvent__paymentIntent_partiallyFunded_bankTransfer,
  mockEvent__customerCashBalanceTransaction_funded,
  mockEvent__paymentIntent_succeeded_captureMethodManual,
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

  test('convert a payment_intent.processing event returns a Pending Authorization with amount (not amount_received)', () => {
    const result = converter.convert(mockEvent__paymentIntent_processing_crypto);

    expect(result).toEqual({
      paymentMethod: undefined,
      id: 'pi_11111',
      pspReference: 'pi_11111',
      pspInteraction: {
        response: JSON.stringify(mockEvent__paymentIntent_processing_crypto),
      },
      transactions: [
        {
          amount: {
            centAmount: 13200,
            currencyCode: 'MXN',
          },
          interactionId: 'pi_11111',
          state: 'Pending',
          type: 'Authorization',
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

  describe('bank transfer (customer_balance) — SB3-207 Etapa 2', () => {
    test('payment_intent.requires_action writes one Pending Authorization for the FULL pi.amount', () => {
      const event = mockEvent__paymentIntent_requiresAction_bankTransfer;
      const paymentIntent = event.data.object as Stripe.PaymentIntent;

      // Guard the premise of this test: while the wire is in flight amount_received is 0,
      // so populateAmount() (which reads amount_received) would produce a 0-cent
      // authorization. The amount MUST come from pi.amount.
      expect(paymentIntent.amount_received).toBe(0);
      expect(paymentIntent.amount).toBe(12300);

      const result = converter.convert(event);

      expect(result.transactions).toEqual([
        {
          type: 'Authorization',
          state: 'Pending',
          amount: { centAmount: 12300, currencyCode: 'EUR' },
          interactionId: 'pi_bt_11111',
        },
      ]);
      expect(result.id).toBe('ct_payment_bt_11111');
    });

    test('payment_intent.partially_funded writes NO transaction at all', () => {
      const result = converter.convert(mockEvent__paymentIntent_partiallyFunded_bankTransfer);
      expect(result.transactions).toEqual([]);
    });

    test('customer_cash_balance_transaction.created is rejected — it must never be converted', () => {
      expect(() => {
        converter.convert(mockEvent__customerCashBalanceTransaction_funded);
      }).toThrow(/observability-only/);
    });
  });

  describe('pspInteraction redaction — SB3-207 Etapa 2', () => {
    test('strips financial_addresses and hosted_instructions_url, keeps reference and amount_remaining', () => {
      const result = converter.convert(mockEvent__paymentIntent_requiresAction_bankTransfer);
      const persisted = JSON.parse(result.pspInteraction?.response as string);
      const instructions = persisted.data.object.next_action.display_bank_transfer_instructions;

      expect(instructions.financial_addresses).toBeUndefined();
      expect(instructions.hosted_instructions_url).toBeNull();
      expect(instructions.reference).toBe('BT-REF-11111');
      expect(instructions.amount_remaining).toBe(12300);
      expect(instructions.currency).toBe('eur');
      expect(instructions.type).toBe('eu_bank_transfer');

      // First path that persists an OPEN PaymentIntent: the client_secret is live and usable
      // against Stripe's public client API for the whole funding window.
      expect(persisted.data.object.client_secret).toBeNull();

      // Nothing resembling an IBAN or a live secret survives anywhere in the persisted blob.
      expect(result.pspInteraction?.response).not.toContain('DE89370400440532013000');
      expect(result.pspInteraction?.response).not.toContain('payments.stripe.com/bank_transfer_instructions');
      expect(result.pspInteraction?.response).not.toContain('pi_bt_11111_secret');
    });

    test('does not mutate the source event', () => {
      const event = mockEvent__paymentIntent_requiresAction_bankTransfer;
      converter.convert(event);
      const instructions = (event.data.object as Stripe.PaymentIntent).next_action?.display_bank_transfer_instructions;
      expect(instructions?.financial_addresses).toBeDefined();
      expect(instructions?.hosted_instructions_url).toContain('payments.stripe.com');
    });

    // NON-REGRESSION: every existing flow must keep a byte-identical pspInteraction.
    test('leaves a card PaymentIntent event byte-identical to JSON.stringify(event)', () => {
      const event = mockEvent__paymentIntent_succeeded_captureMethodManual;
      const result = converter.convert(event);
      expect(result.pspInteraction?.response).toBe(JSON.stringify(event));
    });

    test('leaves a crypto processing event byte-identical to JSON.stringify(event)', () => {
      const event = mockEvent__paymentIntent_processing_crypto;
      const result = converter.convert(event);
      expect(result.pspInteraction?.response).toBe(JSON.stringify(event));
    });
  });
});
