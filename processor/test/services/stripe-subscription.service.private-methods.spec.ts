/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { StripeSubscriptionService } from '../../src/services/stripe-subscription.service';
import { paymentSDK } from '../../src/payment-sdk';
import { CtPaymentCreationService } from '../../src/services/ct-payment-creation.service';
import { StripePaymentService } from '../../src/services/stripe-payment.service';
import { mockGetSubscriptionCartWithVariant } from '../utils/mock-cart-data';
import { METADATA_CUSTOMER_ID_FIELD, METADATA_VARIANT_SKU_FIELD, METADATA_PRICE_ID_FIELD } from '../../src/constants';
import * as CartClient from '../../src/services/commerce-tools/cart-client';
import * as CustomerClient from '../../src/services/commerce-tools/customer-client';

// Mock the payment SDK
jest.mock('../../src/payment-sdk', () => ({
  paymentSDK: {
    ctCartService: {
      getCart: jest.fn(),
      getCartByPaymentId: jest.fn(),
    },
    ctPaymentService: {
      getPayment: jest.fn(),
      findPaymentsByInterfaceId: jest.fn(),
      hasTransactionInState: jest.fn(),
      updatePayment: jest.fn(),
      addPaymentToOrder: jest.fn(),
    },
    ctOrderService: {
      getOrderByPaymentId: jest.fn(),
    },
    ctAPI: {
      client: {
        carts: jest.fn(() => ({
          post: jest.fn(() => ({
            execute: jest.fn(),
          })),
        })),
      },
    },
  },
}));

// Mock other services
jest.mock('../../src/services/ct-payment-creation.service');
jest.mock('../../src/services/stripe-payment.service');
jest.mock('../../src/services/commerce-tools/customer-client');
jest.mock('../../src/services/commerce-tools/cart-client');
jest.mock('../../src/mappers/subscription-mapper');
jest.mock('../../src/libs/logger');

describe('StripeSubscriptionService - Private Methods', () => {
  let stripeSubscriptionService: StripeSubscriptionService;

  beforeEach(() => {
    stripeSubscriptionService = new StripeSubscriptionService({
      ctCartService: {
        getCart: jest.fn(),
        getCartByPaymentId: jest.fn(),
      } as any,
      ctOrderService: {
        getOrderByPaymentId: jest.fn(),
      } as any,
      ctPaymentService: {
        getPayment: jest.fn(),
        findPaymentsByInterfaceId: jest.fn(),
        hasTransactionInState: jest.fn(),
        updatePayment: jest.fn(),
      } as any,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleSubscriptionPaymentAddToOrder', () => {
    test('should add subscription payment to existing order successfully', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);
      const mockCreatedPayment = 'payment_123';
      const mockSubscription = {
        id: 'sub_123',
        items: { data: [{ price: { metadata: {} } }] },
      };
      const mockPayment = {
        id: 'ct_payment_123',
        amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
      };
      const mockUpdateData = {
        id: 'update_123',
        pspReference: 'psp_123',
      };

      jest.spyOn(StripePaymentService.prototype, 'addPaymentToOrder').mockResolvedValue(undefined);

      await (stripeSubscriptionService as any).handleSubscriptionPaymentAddToOrder(
        mockCart,
        mockCreatedPayment,
        mockSubscription,
        mockPayment,
        mockUpdateData,
      );

      expect(StripePaymentService.prototype.addPaymentToOrder).toHaveBeenCalledWith(mockPayment.id, mockCreatedPayment);

      expect(mockUpdateData.id).toBe(mockCreatedPayment);
    });

    test('should handle errors when adding payment to order', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);
      const mockCreatedPayment = 'payment_123';
      const mockSubscription = {
        id: 'sub_123',
        items: { data: [{ price: { metadata: {} } }] },
      };
      const mockPayment = {
        id: 'ct_payment_123',
        amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
      };
      const mockUpdateData = {
        id: 'update_123',
        pspReference: 'psp_123',
      };

      jest
        .spyOn(StripePaymentService.prototype, 'addPaymentToOrder')
        .mockRejectedValue(new Error('Failed to add payment to order'));

      await expect(
        (stripeSubscriptionService as any).handleSubscriptionPaymentAddToOrder(
          mockCart,
          mockCreatedPayment,
          mockSubscription,
          mockPayment,
          mockUpdateData,
        ),
      ).rejects.toThrow('Failed to add payment to order');
    });
  });

  describe('handleSubscriptionPaymentCreateNewOrder', () => {
    test('should create new order for subscription payment successfully', async () => {
      const mockSubscription = {
        id: 'sub_123',
        items: { data: [{ price: { metadata: {} } }] },
      };
      const mockInvoiceExpanded = {
        id: 'in_123',
        subscription_details: {
          metadata: {
            [METADATA_CUSTOMER_ID_FIELD]: 'ct_customer_123',
          },
        },
        charge: {
          id: 'ch_123',
          billing_details: {
            address: {
              city: 'Test City',
              country: 'US',
              line1: '123 Test St',
              postal_code: '12345',
              state: 'CA',
            },
          },
        },
        total: 1500,
      };
      const mockUpdateData = {
        id: 'update_123',
        pspReference: 'psp_123',
      };

      const mockOrder = {
        id: 'order_123',
        lineItems: [
          {
            id: 'line_1',
            productId: 'product_123',
            variant: { id: 'variant_1', sku: 'SKU123' },
            price: { id: 'price_123' },
            quantity: 1,
          },
        ],
        totalPrice: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        shippingAddress: {
          city: 'Test City',
          country: 'US',
          streetName: '123 Test St',
          postalCode: '12345',
          state: 'CA',
        },
        billingAddress: {
          city: 'Test City',
          country: 'US',
          streetName: '123 Test St',
          postalCode: '12345',
          state: 'CA',
        },
      };

      const mockCustomer = {
        id: 'ct_customer_123',
        email: 'test@example.com',
      };

      const mockCart = {
        id: 'cart_123',
        lineItems: [],
        totalPrice: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
      };

      const mockUpdatedCart = {
        ...mockCart,
        shippingAddress: mockOrder.shippingAddress,
        billingAddress: mockOrder.billingAddress,
      };

      jest
        .spyOn(stripeSubscriptionService['ctOrderService'], 'getOrderByPaymentId')
        .mockResolvedValue(mockOrder as any);

      jest.spyOn(CustomerClient, 'getCustomerById').mockResolvedValue(mockCustomer as any);

      jest.spyOn(stripeSubscriptionService as any, 'createCartFromOrder').mockResolvedValue(mockCart as any);

      jest.spyOn(StripePaymentService.prototype, 'updateCartAddress').mockResolvedValue(mockUpdatedCart as any);

      jest.spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation').mockResolvedValue('new_payment_123');

      jest.spyOn(paymentSDK.ctCartService, 'getCart').mockResolvedValue(mockUpdatedCart as any);

      jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue(undefined);

      jest.spyOn(stripeSubscriptionService, 'updateSubscriptionMetadata').mockResolvedValue(undefined);

      const result = await (stripeSubscriptionService as any).handleSubscriptionPaymentCreateNewOrder(
        mockSubscription,
        mockInvoiceExpanded,
        mockUpdateData,
      );

      expect(result).toBe('new_payment_123');

      expect(stripeSubscriptionService['ctOrderService'].getOrderByPaymentId).toHaveBeenCalledWith({
        paymentId: 'update_123',
      });
      expect(CustomerClient.getCustomerById).toHaveBeenCalledWith('ct_customer_123');
      expect((stripeSubscriptionService as any).createCartFromOrder).toHaveBeenCalledWith(
        mockOrder,
        mockCustomer,
        mockSubscription,
      );
      expect(StripePaymentService.prototype.updateCartAddress).toHaveBeenCalledWith(
        mockInvoiceExpanded.charge as any,
        mockCart as any,
      );
      expect(CtPaymentCreationService.prototype.handleCtPaymentCreation).toHaveBeenCalled();
      expect(StripePaymentService.prototype.createOrder).toHaveBeenCalled();
      expect(stripeSubscriptionService.updateSubscriptionMetadata).toHaveBeenCalledWith({
        subscriptionId: mockSubscription.id,
        ctPaymentId: 'new_payment_123',
        customerId: mockCustomer.id,
      });
    });

    test('should throw error when customer ID not found in invoice metadata', async () => {
      const mockSubscription = {
        id: 'sub_123',
        items: { data: [{ price: { metadata: {} } }] },
      };
      const mockInvoiceExpanded = {
        id: 'in_123',
        subscription_details: {
          metadata: {},
        },
      };
      const mockUpdateData = {
        id: 'update_123',
        pspReference: 'psp_123',
      };

      const mockOrder = { id: 'order_123' };

      jest.spyOn(paymentSDK.ctOrderService, 'getOrderByPaymentId').mockResolvedValue(mockOrder as any);

      await expect(
        (stripeSubscriptionService as any).handleSubscriptionPaymentCreateNewOrder(
          mockSubscription,
          mockInvoiceExpanded,
          mockUpdateData,
        ),
      ).rejects.toThrow('Customer ID not found in invoice metadata');
    });

    test('should throw error when customer not found', async () => {
      const mockSubscription = {
        id: 'sub_123',
        items: { data: [{ price: { metadata: {} } }] },
      };
      const mockInvoiceExpanded = {
        id: 'in_123',
        subscription_details: {
          metadata: {
            [METADATA_CUSTOMER_ID_FIELD]: 'ct_customer_123',
          },
        },
      };
      const mockUpdateData = {
        id: 'update_123',
        pspReference: 'psp_123',
      };

      const mockOrder = { id: 'order_123' };

      jest.spyOn(paymentSDK.ctOrderService, 'getOrderByPaymentId').mockResolvedValue(mockOrder as any);

      jest.spyOn(CustomerClient, 'getCustomerById').mockResolvedValue(null as any); // Customer not found

      await expect(
        (stripeSubscriptionService as any).handleSubscriptionPaymentCreateNewOrder(
          mockSubscription,
          mockInvoiceExpanded,
          mockUpdateData,
        ),
      ).rejects.toThrow('Customer not found');
    });
  });

  describe('createCartFromOrder', () => {
    test('should create cart from order successfully', async () => {
      const mockOrder = {
        id: 'order_123',
        lineItems: [
          {
            id: 'line_1',
            productId: 'product_123',
            variant: { id: 'variant_1', sku: 'SKU123' },
            price: { id: 'price_123' },
            quantity: 1,
          },
        ],
        totalPrice: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        shippingAddress: {
          city: 'Test City',
          country: 'US',
          streetName: '123 Test St',
          postalCode: '12345',
          state: 'CA',
        },
        billingAddress: {
          city: 'Test City',
          country: 'US',
          streetName: '123 Test St',
          postalCode: '12345',
          state: 'CA',
        },
      };

      const mockCustomer = {
        id: 'ct_customer_123',
        email: 'test@example.com',
      };

      const mockSubscription = {
        id: 'sub_123',
        items: { data: [{ price: { metadata: {} } }] },
      };

      const mockCart = {
        id: 'cart_123',
        lineItems: [],
        totalPrice: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
      };

      jest.spyOn(stripeSubscriptionService as any, 'createNewCartFromOrder').mockResolvedValue(mockCart as any);

      const result = await (stripeSubscriptionService as any).createCartFromOrder(
        mockOrder,
        mockCustomer,
        mockSubscription,
      );

      expect(result).toBe(mockCart);

      expect((stripeSubscriptionService as any).createNewCartFromOrder).toHaveBeenCalledWith(
        mockOrder,
        mockCustomer,
        mockSubscription,
      );
    });

    test('should handle errors when creating cart from order', async () => {
      const mockOrder = {
        id: 'order_123',
        lineItems: [],
        totalPrice: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
      };

      const mockCustomer = {
        id: 'ct_customer_123',
        email: 'test@example.com',
      };

      const mockSubscription = {
        id: 'sub_123',
        items: { data: [{ price: { metadata: {} } }] },
      };

      jest
        .spyOn(stripeSubscriptionService as any, 'createNewCartFromOrder')
        .mockRejectedValue(new Error('Failed to create cart') as any);

      await expect(
        (stripeSubscriptionService as any).createCartFromOrder(mockOrder, mockCustomer, mockSubscription),
      ).rejects.toThrow('Failed to create cart');
    });
  });

  describe('createNewCartFromOrder', () => {
    test('should create new cart using commercetools API successfully', async () => {
      const mockOrder = {
        id: 'order_123',
        lineItems: [
          {
            id: 'line_1',
            productId: 'product_123',
            variant: { id: 'variant_1', sku: 'SKU123' },
            price: { id: 'price_123' },
            quantity: 1,
          },
        ],
        totalPrice: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        shippingAddress: {
          city: 'Test City',
          country: 'US',
          streetName: '123 Test St',
          postalCode: '12345',
          state: 'CA',
        },
        billingAddress: {
          city: 'Test City',
          country: 'US',
          streetName: '123 Test St',
          postalCode: '12345',
          state: 'CA',
        },
      };

      const mockCustomer = {
        id: 'ct_customer_123',
        email: 'test@example.com',
      };

      const mockSubscription = {
        id: 'sub_123',
        items: {
          data: [
            {
              id: 'item_1',
              price: {
                metadata: {
                  [METADATA_VARIANT_SKU_FIELD]: 'SKU123',
                },
                unit_amount: 1000,
                currency: 'usd',
              },
            },
          ],
        },
        metadata: {
          [METADATA_PRICE_ID_FIELD]: 'price_123',
        },
      };

      const mockCart = {
        id: 'cart_123',
        lineItems: [],
        totalPrice: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
      };

      const mockUpdatedCart = {
        ...mockCart,
        lineItems: [
          {
            id: 'line_1',
            price: { value: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 } },
            quantity: 1,
          },
        ],
      };

      const mockExecute = (jest.fn() as any).mockResolvedValue({ body: mockCart } as any);
      const mockPost = jest.fn().mockReturnValue({ execute: mockExecute });
      const mockCarts = jest.fn().mockReturnValue({ post: mockPost });
      (paymentSDK.ctAPI.client as any).carts = mockCarts;

      jest.spyOn(CartClient, 'updateCartById').mockResolvedValue(mockUpdatedCart as any);
      jest.spyOn(CartClient, 'getCartExpanded').mockResolvedValue(mockUpdatedCart as any);

      (stripeSubscriptionService as any).findSubscriptionLineItem = jest.fn().mockReturnValue({
        id: 'line_1',
        price: { value: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 } },
        quantity: 1,
      });

      jest.spyOn(stripeSubscriptionService, 'getCreateSubscriptionPriceId').mockResolvedValue('new_price_123');

      const result = await (stripeSubscriptionService as any).createNewCartFromOrder(
        mockOrder,
        mockCustomer,
        mockSubscription,
      );

      expect(result).toBe(mockUpdatedCart);

      expect(mockCarts).toHaveBeenCalled();
      expect(mockPost).toHaveBeenCalledWith({
        body: {
          currency: 'USD',
          customerId: mockCustomer.id,
          customerEmail: mockCustomer.email,
          country: 'US',
        },
      });
      expect(mockExecute).toHaveBeenCalled();
      expect(CartClient.updateCartById).toHaveBeenCalled();
      expect(CartClient.getCartExpanded).toHaveBeenCalled();
    });

    test('should handle cart creation without line items', async () => {
      const mockOrder = {
        id: 'order_123',
        lineItems: [],
        totalPrice: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
        shippingAddress: {
          city: 'Test City',
          country: 'US',
          streetName: '123 Test St',
          postalCode: '12345',
          state: 'CA',
        },
      };

      const mockCustomer = {
        id: 'ct_customer_123',
        email: 'test@example.com',
      };

      const mockSubscription = {
        id: 'sub_123',
        items: { data: [] },
      };

      const mockCart = {
        id: 'cart_123',
        lineItems: [],
        totalPrice: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
      };

      const mockExecute = (jest.fn() as any).mockResolvedValue({ body: mockCart } as any);
      const mockPost = jest.fn().mockReturnValue({ execute: mockExecute });
      const mockCarts = jest.fn().mockReturnValue({ post: mockPost });
      (paymentSDK.ctAPI.client as any).carts = mockCarts;

      jest.spyOn(CartClient, 'updateCartById').mockResolvedValue(mockCart as any);

      const result = await (stripeSubscriptionService as any).createNewCartFromOrder(
        mockOrder,
        mockCustomer,
        mockSubscription,
      );

      expect(result).toBe(mockCart);

      expect(mockCarts).toHaveBeenCalled();
      expect(mockPost).toHaveBeenCalledWith({
        body: {
          currency: 'USD',
          customerId: mockCustomer.id,
          customerEmail: mockCustomer.email,
          country: 'US',
        },
      });
      expect(mockExecute).toHaveBeenCalled();
    });
  });
});
