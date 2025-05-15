import { describe, test, expect } from '@jest/globals';
import { SubscriptionEventConverter } from '../../../src/services/converters/subscriptionEventConverter';
import {
  mockEvent__invoice_failed__Expanded,
  mockEvent__invoice_paid__Expanded_noPaymnet_intent__amount_paid,
  mockEvent__invoice_paid__Expanded_Paymnet_intent__amount_paid,
} from '../../utils/mock-subscription-data';
import Stripe from 'stripe';
import { Payment } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/payment';
import { mockGetPaymentResult } from '../../utils/mock-payment-results';

describe('subscriptionEvent.converter', () => {
  const converter = new SubscriptionEventConverter();

  test('convert a invoice.paid event with NO payment intent and NO charge pending', () => {
    const eventInvoice = mockEvent__invoice_paid__Expanded_noPaymnet_intent__amount_paid.data.object as Stripe.Invoice;
    const mockPayment: Payment = mockGetPaymentResult;
    const isPaymentChargePending = false;
    const result = converter.convert(
      mockEvent__invoice_paid__Expanded_noPaymnet_intent__amount_paid,
      eventInvoice,
      isPaymentChargePending,
      mockPayment,
    );

    expect(result).toEqual({
      paymentMethod: undefined,
      id: '123456',
      pspReference: 'in_1RO4tTI1uSMp8YbX5hnju5zf',
      pspInteraction: {
        response: JSON.stringify(mockEvent__invoice_paid__Expanded_noPaymnet_intent__amount_paid),
      },
      transactions: [
        {
          amount: {
            centAmount: 1000,
            currencyCode: 'USD',
          },
          interactionId: 'in_1RO4tTI1uSMp8YbX5hnju5zf',
          state: 'Success',
          type: 'Authorization',
        },
        {
          amount: {
            centAmount: 1000,
            currencyCode: 'USD',
          },
          interactionId: 'in_1RO4tTI1uSMp8YbX5hnju5zf',
          state: 'Success',
          type: 'Charge',
        },
      ],
    });
  });

  test('convert a invoice.paid event with YES Payment intent and NO charge pending', () => {
    const eventInvoice = mockEvent__invoice_paid__Expanded_Paymnet_intent__amount_paid.data.object as Stripe.Invoice;
    const mockPayment: Payment = mockGetPaymentResult;
    const isPaymentChargePending = false;
    const result = converter.convert(
      mockEvent__invoice_paid__Expanded_Paymnet_intent__amount_paid,
      eventInvoice,
      isPaymentChargePending,
      mockPayment,
    );

    expect(result).toEqual({
      paymentMethod: 'card',
      id: '123456',
      pspReference: 'pi_3RO4tUI1uSMp8YbX1c0AuScG',
      pspInteraction: {
        response: JSON.stringify(mockEvent__invoice_paid__Expanded_Paymnet_intent__amount_paid),
      },
      transactions: [
        {
          amount: {
            centAmount: 1000,
            currencyCode: 'USD',
          },
          interactionId: 'pi_3RO4tUI1uSMp8YbX1c0AuScG',
          state: 'Success',
          type: 'Authorization',
        },
        {
          amount: {
            centAmount: 1000,
            currencyCode: 'USD',
          },
          interactionId: 'pi_3RO4tUI1uSMp8YbX1c0AuScG',
          state: 'Success',
          type: 'Charge',
        },
      ],
    });
  });

  test('convert a invoice.paid event with NO Payment intent and YES Charge pending', () => {
    const eventInvoice = mockEvent__invoice_paid__Expanded_noPaymnet_intent__amount_paid.data.object as Stripe.Invoice;
    const mockPayment: Payment = mockGetPaymentResult;
    const isPaymentChargePending = true;
    const result = converter.convert(
      mockEvent__invoice_paid__Expanded_noPaymnet_intent__amount_paid,
      eventInvoice,
      isPaymentChargePending,
      mockPayment,
    );

    expect(result).toEqual({
      paymentMethod: undefined,
      id: '123456',
      pspReference: 'in_1RO4tTI1uSMp8YbX5hnju5zf',
      pspInteraction: {
        response: JSON.stringify(mockEvent__invoice_paid__Expanded_noPaymnet_intent__amount_paid),
      },
      transactions: [
        {
          amount: {
            centAmount: 1000,
            currencyCode: 'USD',
          },
          interactionId: 'in_1RO4tTI1uSMp8YbX5hnju5zf',
          state: 'Success',
          type: 'Charge',
        },
      ],
    });
  });

  test('convert a invoice.paid event with YES Payment intent and YES Charge pending', () => {
    const eventInvoice = mockEvent__invoice_paid__Expanded_Paymnet_intent__amount_paid.data.object as Stripe.Invoice;
    const mockPayment: Payment = mockGetPaymentResult;
    const isPaymentChargePending = true;
    const result = converter.convert(
      mockEvent__invoice_paid__Expanded_Paymnet_intent__amount_paid,
      eventInvoice,
      isPaymentChargePending,
      mockPayment,
    );

    expect(result).toEqual({
      paymentMethod: 'card',
      id: '123456',
      pspReference: 'in_1RO4tTI1uSMp8YbX5hnju5zf',
      pspInteraction: {
        response: JSON.stringify(mockEvent__invoice_paid__Expanded_Paymnet_intent__amount_paid),
      },
      transactions: [
        {
          amount: {
            centAmount: 1000,
            currencyCode: 'USD',
          },
          interactionId: 'in_1RO4tTI1uSMp8YbX5hnju5zf',
          state: 'Success',
          type: 'Charge',
        },
      ],
    });
  });

  test('convert a invoice.payment_failed event with NO payment intent and NO charge pending and Subscription payment', () => {
    const eventInvoice = mockEvent__invoice_failed__Expanded.data.object as Stripe.Invoice;
    const mockPayment: Payment = mockGetPaymentResult;
    const isPaymentChargePending = false;
    const result = converter.convert(
      mockEvent__invoice_failed__Expanded,
      eventInvoice,
      isPaymentChargePending,
      mockPayment,
    );

    expect(result).toEqual({
      paymentMethod: 'card',
      id: '123456',
      pspReference: 'pi_3RMyC4I1uSMp8YbX18a8VISG',
      pspInteraction: {
        response: JSON.stringify(mockEvent__invoice_failed__Expanded),
      },
      transactions: [
        {
          amount: {
            centAmount: 1600,
            currencyCode: 'USD',
          },
          interactionId: 'pi_3RMyC4I1uSMp8YbX18a8VISG',
          state: 'Failure',
          type: 'Authorization',
        },
        {
          amount: {
            centAmount: 1600,
            currencyCode: 'USD',
          },
          interactionId: 'pi_3RMyC4I1uSMp8YbX18a8VISG',
          state: 'Failure',
          type: 'Charge',
        },
      ],
    });
  });

  test('convert a invoice.payment_failed event with NO payment intent and YES charge pending and Subscription payment', () => {
    const eventInvoice = mockEvent__invoice_failed__Expanded.data.object as Stripe.Invoice;
    const mockPayment: Payment = mockGetPaymentResult;
    const isPaymentChargePending = true;
    const result = converter.convert(
      mockEvent__invoice_failed__Expanded,
      eventInvoice,
      isPaymentChargePending,
      mockPayment,
    );

    expect(result).toEqual({
      paymentMethod: 'card',
      id: '123456',
      pspReference: 'in_1RMyBxI1uSMp8YbXSr6NyMNn',
      pspInteraction: {
        response: JSON.stringify(mockEvent__invoice_failed__Expanded),
      },
      transactions: [
        {
          amount: {
            centAmount: 1600,
            currencyCode: 'USD',
          },
          interactionId: 'in_1RMyBxI1uSMp8YbXSr6NyMNn',
          state: 'Failure',
          type: 'Charge',
        },
      ],
    });
  });
});
