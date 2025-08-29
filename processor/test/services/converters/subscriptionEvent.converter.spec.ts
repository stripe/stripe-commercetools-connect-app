import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { SubscriptionEventConverter } from '../../../src/services/converters/subscriptionEventConverter';
import {
  mockEvent__invoice_failed__Expanded,
  mockEvent__invoice_paid__Expanded_noPaymnet_intent__amount_paid,
  mockEvent__invoice_paid__Expanded_Paymnet_intent__amount_paid,
} from '../../utils/mock-subscription-data';
import Stripe from 'stripe';
import { Payment } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/payment';
import { mockGetPaymentResult } from '../../utils/mock-payment-results';
import * as StripeClient from '../../../src/clients/stripe.client';

jest.mock('../../../src/clients/stripe.client');

describe('subscriptionEvent.converter', () => {
  let converter: SubscriptionEventConverter;

  beforeEach(() => {
    converter = new SubscriptionEventConverter();
    jest.clearAllMocks();
    (StripeClient.wrapStripeError as jest.Mock).mockImplementation((error) => error);
  });

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

  test('convert a invoice.paid event with Stripe Applied Balance (paid but no payment_intent and no charge)', () => {
    const mockInvoice = {
      id: 'in_test123',
      paid: true,
      payment_intent: null,
      charge: null,
      amount_paid: 500,
      currency: 'usd',
      amount_due: 0,
      subscription_details: {
        metadata: {
          ctPaymentId: 'ct_payment_123',
        },
      },
    } as unknown as Stripe.Invoice;

    const mockEvent = {
      type: 'invoice.paid',
      data: {
        object: mockInvoice,
      },
    } as unknown as Stripe.Event;

    const mockPayment: Payment = mockGetPaymentResult;
    const isPaymentChargePending = false;

    const result = converter.convert(mockEvent, mockInvoice, isPaymentChargePending, mockPayment);

    expect(result.paymentMethod).toBe('Stripe Applied Balance');
    expect(result.pspReference).toBe('in_test123');
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].type).toBe('Authorization');
    expect(result.transactions[1].type).toBe('Charge');
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

  test('convert a charge.refunded event', () => {
    const mockCharge = {
      id: 'ch_test123',
      amount: 1000,
      amount_refunded: 500,
      currency: 'usd',
      payment_method_details: {
        type: 'card',
      },
    } as unknown as Stripe.Charge;

    const mockInvoice = {
      id: 'in_test123',
      charge: mockCharge,
      amount_paid: 1000,
      currency: 'usd',
      amount_due: 0,
    } as unknown as Stripe.Invoice;

    const mockEvent = {
      type: 'charge.refunded',
      data: {
        object: mockCharge,
      },
    } as unknown as Stripe.Event;

    const mockPayment: Payment = mockGetPaymentResult;
    const isPaymentChargePending = false;

    const result = converter.convert(mockEvent, mockInvoice, isPaymentChargePending, mockPayment);

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toEqual({
      type: 'Refund',
      state: 'Success',
      amount: {
        centAmount: 500,
        currencyCode: 'USD',
      },
      interactionId: 'in_test123',
    });
    expect(result.transactions[1]).toEqual({
      type: 'Chargeback',
      state: 'Success',
      amount: {
        centAmount: 500,
        currencyCode: 'USD',
      },
      interactionId: 'in_test123',
    });
  });

  test('convert a charge.refunded event with missing charge data', () => {
    const mockCharge = {
      id: 'ch_test123',
      amount: 1000,
      currency: 'usd',
      amount_refunded: undefined,
    } as unknown as Stripe.Charge;

    const mockInvoice = {
      id: 'in_test123',
      charge: mockCharge,
      amount_paid: 1000,
      currency: 'usd',
      amount_due: 0,
    } as unknown as Stripe.Invoice;

    const mockEvent = {
      type: 'charge.refunded',
      data: {
        object: mockCharge,
      },
    } as unknown as Stripe.Event;

    const mockPayment: Payment = mockGetPaymentResult;
    const isPaymentChargePending = false;

    const result = converter.convert(mockEvent, mockInvoice, isPaymentChargePending, mockPayment);

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].amount.centAmount).toBe(undefined); // amount_refunded is undefined
    expect(result.transactions[1].amount.centAmount).toBe(undefined); // amount_refunded is undefined
  });

  test('convert an unsupported event type should throw error', () => {
    const mockInvoice = {
      id: 'in_test123',
      amount_paid: 1000,
      currency: 'usd',
      amount_due: 0,
    } as unknown as Stripe.Invoice;

    const mockEvent = {
      type: 'unsupported.event.type',
      data: {
        object: mockInvoice,
      },
    } as unknown as Stripe.Event;

    const mockPayment: Payment = mockGetPaymentResult;
    const isPaymentChargePending = false;

    expect(() => {
      converter.convert(mockEvent, mockInvoice, isPaymentChargePending, mockPayment);
    }).toThrow('Unsupported event unsupported.event.type');

    expect(StripeClient.wrapStripeError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Unsupported event unsupported.event.type',
      }),
    );
  });

  test('convert with missing payment method details type', () => {
    const mockCharge = {
      id: 'ch_test123',
      amount: 1000,
      currency: 'usd',
      payment_method_details: {},
    } as unknown as Stripe.Charge;

    const mockInvoice = {
      id: 'in_test123',
      charge: mockCharge,
      amount_paid: 1000,
      currency: 'usd',
      amount_due: 0,
    } as unknown as Stripe.Invoice;

    const mockEvent = {
      type: 'invoice.paid',
      data: {
        object: mockInvoice,
      },
    } as unknown as Stripe.Event;

    const mockPayment: Payment = mockGetPaymentResult;
    const isPaymentChargePending = false;

    const result = converter.convert(mockEvent, mockInvoice, isPaymentChargePending, mockPayment);

    expect(result.paymentMethod).toBeUndefined();
    expect(result.transactions).toHaveLength(2);
  });

  test('convert with missing payment method details entirely', () => {
    const mockCharge = {
      id: 'ch_test123',
      amount: 1000,
      currency: 'usd',
    } as unknown as Stripe.Charge;

    const mockInvoice = {
      id: 'in_test123',
      charge: mockCharge,
      amount_paid: 1000,
      currency: 'usd',
      amount_due: 0,
    } as unknown as Stripe.Invoice;

    const mockEvent = {
      type: 'invoice.paid',
      data: {
        object: mockInvoice,
      },
    } as unknown as Stripe.Event;

    const mockPayment: Payment = mockGetPaymentResult;
    const isPaymentChargePending = false;

    const result = converter.convert(mockEvent, mockInvoice, isPaymentChargePending, mockPayment);

    expect(result.paymentMethod).toBeUndefined();
    expect(result.transactions).toHaveLength(2);
  });

  test('convert with missing charge data', () => {
    const mockInvoice = {
      id: 'in_test123',
      charge: null,
      amount_paid: 1000,
      currency: 'usd',
      amount_due: 0,
    } as unknown as Stripe.Invoice;

    const mockEvent = {
      type: 'invoice.paid',
      data: {
        object: mockInvoice,
      },
    } as unknown as Stripe.Event;

    const mockPayment: Payment = mockGetPaymentResult;
    const isPaymentChargePending = false;

    const result = converter.convert(mockEvent, mockInvoice, isPaymentChargePending, mockPayment);

    expect(result.paymentMethod).toBeUndefined();
    expect(result.transactions).toHaveLength(2);
  });

  test('convert with missing payment intent data', () => {
    const mockInvoice = {
      id: 'in_test123',
      payment_intent: null,
      charge: null,
      amount_paid: 1000,
      currency: 'usd',
      amount_due: 0,
    } as unknown as Stripe.Invoice;

    const mockEvent = {
      type: 'invoice.paid',
      data: {
        object: mockInvoice,
      },
    } as unknown as Stripe.Event;

    const mockPayment: Payment = mockGetPaymentResult;
    const isPaymentChargePending = false;

    const result = converter.convert(mockEvent, mockInvoice, isPaymentChargePending, mockPayment);

    expect(result.paymentMethod).toBeUndefined();
    expect(result.pspReference).toBe('in_test123');
    expect(result.transactions).toHaveLength(2);
  });
});
