/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { StripeSubscriptionService } from '../../src/services/stripe-subscription.service';

// Mock all external dependencies
jest.mock('../../src/services/ct-payment-creation.service');
jest.mock('../../src/services/stripe-payment.service');
jest.mock('../../src/services/commerce-tools/customer-client');
jest.mock('../../src/services/commerce-tools/cart-client');
jest.mock('../../src/mappers/subscription-mapper');
jest.mock('../../src/libs/logger');
jest.mock('../../src/payment-sdk');

describe('StripeSubscriptionService - Simple Private Method Tests', () => {
  let stripeSubscriptionService: StripeSubscriptionService;

  beforeEach(() => {
    stripeSubscriptionService = new StripeSubscriptionService({
      ctCartService: {} as any,
      ctOrderService: {} as any,
      ctPaymentService: {} as any,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sealCartTotal — the anchor the drift guard compares against', () => {
    const cart = {
      id: 'cart_123',
      totalPrice: { type: 'centPrecision', currencyCode: 'EUR', centAmount: 2000, fractionDigits: 2 },
    } as any;

    test('writes the cart total and currency onto the subscription metadata', () => {
      const service = stripeSubscriptionService as any;

      const metadata = service.sealCartTotal(cart, { ct_payment_id: 'p_1' });

      expect(metadata).toEqual({
        ct_payment_id: 'p_1',
        ct_cart_total_amount: '2000',
        ct_cart_total_currency: 'EUR',
      });
    });

    test('keeps the amount a string, as the Stripe metadata API requires', () => {
      const service = stripeSubscriptionService as any;

      const metadata = service.sealCartTotal(cart, {});

      expect(typeof metadata.ct_cart_total_amount).toBe('string');
    });
  });

  describe('Private Method Access', () => {
    test('should be able to access private methods using type assertion', () => {
      const service = stripeSubscriptionService as any;

      expect(typeof service.handleSubscriptionPaymentAddToOrder).toBe('function');
      expect(typeof service.handleSubscriptionPaymentCreateNewOrder).toBe('function');
      expect(typeof service.createCartFromOrder).toBe('function');
      expect(typeof service.createNewCartFromOrder).toBe('function');
    });

    test('should have the expected private method signatures', () => {
      const service = stripeSubscriptionService as any;

      expect(service.handleSubscriptionPaymentAddToOrder.length).toBe(5);
      expect(service.handleSubscriptionPaymentCreateNewOrder.length).toBe(3);
      expect(service.createCartFromOrder.length).toBe(3);
      expect(service.createNewCartFromOrder.length).toBe(3);
    });
  });

  describe('Method Coverage Verification', () => {
    test('should verify that private methods are defined in the service', () => {
      const service = stripeSubscriptionService as any;

      const privateMethods = [
        'handleSubscriptionPaymentAddToOrder',
        'handleSubscriptionPaymentCreateNewOrder',
        'createCartFromOrder',
        'createNewCartFromOrder',
      ];

      privateMethods.forEach((methodName) => {
        expect(service[methodName]).toBeDefined();
        expect(typeof service[methodName]).toBe('function');
      });
    });
  });
});
