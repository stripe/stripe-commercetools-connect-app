import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { DefaultCartService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-cart.service';
import { DefaultPaymentService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-payment.service';
import { Cart } from '@commercetools/connect-payments-sdk';
import { paymentSDK } from '../../src/payment-sdk';
import { mockGetCartResult } from '../utils/mock-cart-data';
import { mockCtCustomerId } from '../utils/mock-customer-data';
import { CtPaymentCreationService } from '../../src/services/ct-payment-creation.service';
import { StripePaymentServiceOptions } from '../../src/services/types/stripe-payment.type';
import {
  mockGetPaymentAmount,
  mockGetPaymentResult,
  mockStripeCreatePaymentResult,
} from '../utils/mock-payment-results';
import * as Logger from '../../src/libs/logger/index';
import * as ConfigModule from '../../src/config/config';
import { mockInvoice, mockInvoiceId } from '../utils/mock-subscription-data';
import { subscriptionResponseMock } from '../utils/mock-subscription-response';

jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {}),
}));
jest.mock('../../src/libs/logger');

describe('ct-payment-creation.service', () => {
  const opts: StripePaymentServiceOptions = {
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
    ctOrderService: paymentSDK.ctOrderService,
  };
  const paymentCreationService = new CtPaymentCreationService(opts);

  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
    Stripe.prototype.paymentIntents = {
      update: jest.fn(),
    } as unknown as Stripe.PaymentIntentsResource;
    Stripe.prototype.subscriptions = {
      update: jest.fn(),
    } as unknown as Stripe.SubscriptionsResource;
    Stripe.prototype.invoices = {
      retrieve: jest.fn(),
    } as unknown as Stripe.InvoicesResource;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('method createCtPayment', () => {
    test('should create ct payment successfully', async () => {
      const getPaymentAmountMock = jest
        .spyOn(DefaultPaymentService.prototype, 'createPayment')
        .mockResolvedValue(mockGetPaymentResult);

      const result = await paymentCreationService.createCtPayment({
        cart: mockGetCartResult(),
        amountPlanned: mockGetPaymentAmount,
        interactionId: mockStripeCreatePaymentResult.id,
      });

      expect(result).toStrictEqual(mockGetPaymentResult.id);
      expect(result).toBeDefined();
      expect(getPaymentAmountMock).toHaveBeenCalled();
    });

    test('should create ct payment without customer ID successfully', async () => {
      const mockCart: Cart = { ...mockGetCartResult(), customerId: undefined };
      const getPaymentAmountMock = jest
        .spyOn(DefaultPaymentService.prototype, 'createPayment')
        .mockResolvedValue(mockGetPaymentResult);

      const result = await paymentCreationService.createCtPayment({
        cart: mockCart,
        amountPlanned: mockGetPaymentAmount,
        interactionId: mockStripeCreatePaymentResult.id,
      });

      expect(result).toStrictEqual(mockGetPaymentResult.id);
      expect(result).toBeDefined();
      expect(getPaymentAmountMock).toHaveBeenCalled();
    });

    test('should create ct payment with anonymous ID successfully', async () => {
      const mockCart: Cart = { ...mockGetCartResult(), customerId: undefined, anonymousId: 'test-anonymous-id' };
      const getPaymentAmountMock = jest
        .spyOn(DefaultPaymentService.prototype, 'createPayment')
        .mockResolvedValue(mockGetPaymentResult);

      const result = await paymentCreationService.createCtPayment({
        cart: mockCart,
        amountPlanned: mockGetPaymentAmount,
        interactionId: mockStripeCreatePaymentResult.id,
      });

      expect(result).toStrictEqual(mockGetPaymentResult.id);
      expect(result).toBeDefined();
      expect(getPaymentAmountMock).toHaveBeenCalled();
    });

    test('should create ct payment for subscription successfully', async () => {
      const getPaymentAmountMock = jest
        .spyOn(DefaultPaymentService.prototype, 'createPayment')
        .mockResolvedValue(mockGetPaymentResult);

      const result = await paymentCreationService.createCtPayment({
        cart: mockGetCartResult(),
        amountPlanned: mockGetPaymentAmount,
        interactionId: mockStripeCreatePaymentResult.id,
      });

      expect(result).toStrictEqual(mockGetPaymentResult.id);
      expect(result).toBeDefined();

      expect(getPaymentAmountMock).toHaveBeenCalled();
    });
  });

  describe('method addCtPayment', () => {
    test('should add ct payment successfully', async () => {
      const addPaymentAmountMock = jest
        .spyOn(DefaultCartService.prototype, 'addPayment')
        .mockResolvedValue(mockGetCartResult());

      await paymentCreationService.addCtPayment(mockGetCartResult(), mockGetPaymentResult.id);
      expect(addPaymentAmountMock).toHaveBeenCalled();
    });
  });

  describe('method handleCtPaymentCreation', () => {
    test('should create and add ct payment successfully', async () => {
      const ctPaymentIdMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'createCtPayment')
        .mockResolvedValue(mockGetPaymentResult.id);
      const addCtPaymentMock = jest.spyOn(CtPaymentCreationService.prototype, 'addCtPayment').mockResolvedValue();
      const updatePaymentMetadataMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'updatePaymentMetadata')
        .mockResolvedValue();

      await paymentCreationService.handleCtPaymentCreation({
        cart: mockGetCartResult(),
        amountPlanned: mockGetPaymentAmount,
        interactionId: mockStripeCreatePaymentResult.id,
      });
      expect(ctPaymentIdMock).toHaveBeenCalled();
      expect(addCtPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMetadataMock).toHaveBeenCalled();
    });

    test('should create and add ct payment successfully', async () => {
      const ctPaymentIdMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'createCtPayment')
        .mockResolvedValue(mockGetPaymentResult.id);
      const addCtPaymentMock = jest.spyOn(CtPaymentCreationService.prototype, 'addCtPayment').mockResolvedValue();
      const updatePaymentMetadataMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'updatePaymentMetadata')
        .mockResolvedValue();

      await paymentCreationService.handleCtPaymentCreation({
        cart: mockGetCartResult(),
        amountPlanned: mockGetPaymentAmount,
        interactionId: mockInvoiceId,
      });
      expect(ctPaymentIdMock).toHaveBeenCalled();
      expect(addCtPaymentMock).toHaveBeenCalled();
      expect(updatePaymentMetadataMock).toHaveBeenCalled();
    });
  });

  describe('method updatePaymentMetadata', () => {
    test('should update metadata for payment intent successfully', async () => {
      const stripeUpdatePaymentIntentMock = jest
        .spyOn(Stripe.prototype.paymentIntents, 'update')
        .mockResolvedValue(mockStripeCreatePaymentResult);

      await paymentCreationService.updatePaymentMetadata({
        cart: mockGetCartResult(),
        ctPaymentId: mockGetPaymentResult.id,
        paymentIntentId: mockStripeCreatePaymentResult.id,
      });
      expect(Logger.log.info).toHaveBeenCalled();
      expect(stripeUpdatePaymentIntentMock).toHaveBeenCalled();
    });

    test('should update metadata for payment intent and subscription successfully', async () => {
      const stripeUpdatePaymentIntentMock = jest
        .spyOn(Stripe.prototype.paymentIntents, 'update')
        .mockResolvedValue(mockStripeCreatePaymentResult);
      const stripeUpdateSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'update')
        .mockResolvedValue(subscriptionResponseMock);

      await paymentCreationService.updatePaymentMetadata({
        cart: mockGetCartResult(),
        ctPaymentId: mockGetPaymentResult.id,
        paymentIntentId: mockStripeCreatePaymentResult.id,
        subscriptionId: subscriptionResponseMock.id,
      });
      expect(Logger.log.info).toHaveBeenCalled();
      expect(stripeUpdatePaymentIntentMock).toHaveBeenCalled();
      expect(stripeUpdateSubscriptionMock).toHaveBeenCalled();
    });

    test('should not update and log warning', async () => {
      await paymentCreationService.updatePaymentMetadata({
        cart: mockGetCartResult(),
        ctPaymentId: mockGetPaymentResult.id,
      });
      expect(Logger.log.warn).toHaveBeenCalled();
    });
  });

  describe('method getPaymentMetadata', () => {
    test('should return the payment metadata with customer id', () => {
      const cart = mockGetCartResult();
      const paymentMetadataMock = {
        cart_id: cart.id,
        ct_project_key: ConfigModule.getConfig().projectKey,
        ct_customer_id: mockCtCustomerId,
      };
      const result = paymentCreationService.getPaymentMetadata(cart);
      expect(result).toStrictEqual(paymentMetadataMock);
    });

    test('should return the payment metadata withhout customer id', () => {
      const cart: Cart = { ...mockGetCartResult(), customerId: undefined };
      const paymentMetadataMock = {
        cart_id: cart.id,
        ct_project_key: ConfigModule.getConfig().projectKey,
      };
      const result = paymentCreationService.getPaymentMetadata(cart);
      expect(result).toStrictEqual(paymentMetadataMock);
    });
  });

  describe('method updateSubscriptionPaymentTransactions', () => {
    test('should update the payment transaction successfully', async () => {
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockResolvedValue(mockGetPaymentResult);

      await paymentCreationService.updateSubscriptionPaymentTransactions({
        payment: mockGetPaymentResult,
        interactionId: mockStripeCreatePaymentResult.id,
        subscriptionId: subscriptionResponseMock.id,
      });
      expect(updatePaymentMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalled();
    });

    test('should update the payment transaction successfully and with pending', async () => {
      const updatePaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'updatePayment')
        .mockResolvedValue(mockGetPaymentResult);

      await paymentCreationService.updateSubscriptionPaymentTransactions({
        payment: mockGetPaymentResult,
        interactionId: mockStripeCreatePaymentResult.id,
        subscriptionId: subscriptionResponseMock.id,
        isPending: true,
      });
      expect(updatePaymentMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalled();
    });
  });

  describe('method getStripeInvoiceExpanded', () => {
    test('should get the payment amount successfully', async () => {
      const stripeGetInvoiceMock = jest.spyOn(Stripe.prototype.invoices, 'retrieve').mockResolvedValue(mockInvoice);

      const result = await paymentCreationService.getStripeInvoiceExpanded(mockStripeCreatePaymentResult.id);
      expect(result).toStrictEqual(mockInvoice);
      expect(stripeGetInvoiceMock).toHaveBeenCalled();
    });

    test('should fail to retrieve the invoice', async () => {
      const stripeGetInvoiceMock = jest
        .spyOn(Stripe.prototype.invoices, 'retrieve')
        .mockReturnValue(Promise.reject('test error'));
      try {
        await paymentCreationService.getStripeInvoiceExpanded(mockStripeCreatePaymentResult.id);
      } catch {
        expect(stripeGetInvoiceMock).toHaveBeenCalled();
        expect(Logger.log.error).toHaveBeenCalled();
      }
    });
  });

  describe('method handleCtPaymentSubscription', () => {
    test('should handle ct payment subscription successfully', async () => {
      const updatePaymentMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'createCtPayment')
        .mockResolvedValue('payment-id');

      await paymentCreationService.handleCtPaymentSubscription({
        cart: mockGetCartResult(),
        amountPlanned: mockGetPaymentAmount,
        interactionId: mockStripeCreatePaymentResult.id,
      });
      expect(updatePaymentMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalled();
    });
  });
});
