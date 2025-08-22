import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { StripeSubscriptionService } from '../../src/services/stripe-subscription.service';
import { paymentSDK } from '../../src/payment-sdk';
import { mockGetCartResult, mockGetSubscriptionCartWithVariant, getVariant } from '../utils/mock-cart-data';
import { mockGetPaymentAmount } from '../utils/mock-payment-results';

jest.mock('../../src/libs/logger');

describe('stripe-subscription.service.utils', () => {
  const opts = {
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
    ctOrderService: paymentSDK.ctOrderService,
  };
  const stripeSubscriptionService: StripeSubscriptionService = new StripeSubscriptionService(opts);

  const lineItemSubscription = mockGetSubscriptionCartWithVariant(1).lineItems[0];

  beforeEach(async () => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('method getPaymentMode', () => {
    test('should get payment mode successfully', () => {
      const result = stripeSubscriptionService.getPaymentMode(mockGetCartResult());
      expect(result).toStrictEqual('payment');
    });

    test('should get payment mode as setup', () => {
      const result = stripeSubscriptionService.getPaymentMode(mockGetSubscriptionCartWithVariant(6));
      expect(result).toStrictEqual('setup');
    });

    test('should get payment mode as setup when trial days present', () => {
      const result = stripeSubscriptionService.getPaymentMode(mockGetSubscriptionCartWithVariant(1));
      expect(result).toStrictEqual('setup');
    });

    test('should get payment mode as subscription when subscription is not first item', () => {
      const mockCartWithMultipleSubscriptions = {
        ...mockGetCartResult(),
        lineItems: [
          { ...lineItemSubscription, variant: getVariant(6), quantity: 1, id: 'subscription-item-1' },
          { ...lineItemSubscription, variant: getVariant(1), quantity: 2, id: 'subscription-item-2' },
        ],
      };
      const result = stripeSubscriptionService.getPaymentMode(mockCartWithMultipleSubscriptions);
      expect(result).toStrictEqual('setup');
    });
  });

  describe('method getSubscriptionPaymentAmount', () => {
    test('should get subscription payment amount successfully', () => {
      const result = stripeSubscriptionService.getSubscriptionPaymentAmount(mockGetSubscriptionCartWithVariant(6));
      const expectedAmount = {
        ...mockGetPaymentAmount,
        totalCentAmount: mockGetPaymentAmount.centAmount,
      };
      expect(result).toStrictEqual(expectedAmount);
    });

    test('should calculate total amount including quantity', () => {
      const mockCartWithQuantity = {
        ...mockGetSubscriptionCartWithVariant(6),
        lineItems: [{ ...mockGetSubscriptionCartWithVariant(6).lineItems[0], quantity: 3 }],
      };
      const result = stripeSubscriptionService.getSubscriptionPaymentAmount(mockCartWithQuantity);
      const expectedAmount = {
        ...mockGetPaymentAmount,
        totalCentAmount: mockGetPaymentAmount.centAmount * 3,
      };
      expect(result).toStrictEqual(expectedAmount);
    });

    test('should throw an error when no subscription found', () => {
      expect(() => stripeSubscriptionService.getSubscriptionPaymentAmount(mockGetCartResult())).toThrow();
    });
  });

  describe('method getSubscriptionTypes', () => {
    test('should get subscription types successfully', () => {
      const mockAttributes = {
        customer: 'cus_123',
        items: [{ price: 'price_123' }],
        trial_period_days: 7,
        billing_cycle_anchor: 1234567890,
        proration_behavior: 'none' as const,
      };
      const result = stripeSubscriptionService.getSubscriptionTypes(mockAttributes);
      expect(result).toBeDefined();
      expect(result.hasTrial).toBeDefined();
      expect(result.hasFreeAnchorDays).toBeDefined();
      expect(result.isSendInvoice).toBeDefined();
    });

    test('should return default types when minimal attributes provided', () => {
      const result = stripeSubscriptionService.getSubscriptionTypes({
        customer: 'cus_123',
        items: [{ price: 'price_123' }],
      });
      expect(result).toBeDefined();
      expect(result.hasTrial).toBe(false);
      expect(result.hasFreeAnchorDays).toBe(false);
      expect(result.isSendInvoice).toBe(false);
    });
  });
});
