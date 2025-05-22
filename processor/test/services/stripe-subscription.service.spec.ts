import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { paymentSDK } from '../../src/payment-sdk';
import {
  lineItem,
  mockGetCartResult,
  mockGetSubscriptionCart,
  mockGetSubscriptionCartWithTwoItems,
  mockGetSubscriptionCartWithVariant,
} from '../utils/mock-cart-data';
import { StripePaymentServiceOptions } from '../../src/services/types/stripe-payment.type';
import {
  mockGetPaymentAmount,
  mockGetPaymentResult,
  mockStripeCreatePaymentResult,
} from '../utils/mock-payment-results';
import { StripeSubscriptionService } from '../../src/services/stripe-subscription.service';
import {
  mockSubscriptionAttributes,
  setupIntentIdMock,
  setupIntentResponseMock,
  stripeDifferentPriceResponseMock,
  stripePriceDataMock,
  stripePriceEmptyResponseMock,
  stripePriceIdMock,
  stripePriceResponseMock,
  stripeProductDataMock,
  stripeProductEmptyResponseMock,
  stripeProductIdMock,
  stripeProductResponseMock,
  subscriptionResponseMock,
  subscriptionWithoutPaymentResponseMock,
} from '../utils/mock-subscription-response';
import { mock_SetLineItemCustomFieldActions } from '../utils/mock-actions-data';
import { DefaultCartService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-cart.service';
import { mockInvoice, mockInvoiceWithAmountDue, mockSubscriptionId } from '../utils/mock-subscription-data';
import { CtPaymentCreationService } from '../../src/services/ct-payment-creation.service';
import { StripePaymentService } from '../../src/services/stripe-payment.service';
import { DefaultPaymentService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-payment.service';
import { mockCtCustomerData, mockStripeCustomerId } from '../utils/mock-customer-data';
import { StripeCustomerService } from '../../src/services/stripe-customer.service';
import * as Logger from '../../src/libs/logger/index';
import * as CustomTypeHelper from '../../src/services/commerce-tools/custom-type-helper';
import * as CartClient from '../../src/services/commerce-tools/cart-client';
import * as StripeClient from '../../src/clients/stripe.client';
import * as Config from '../../src/config/config';

jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {}),
}));
jest.mock('../../src/libs/logger');

interface FlexibleConfig {
  [key: string]: string | number | Config.PaymentFeatures;
}

function setupMockConfig(keysAndValues: Record<string, string>) {
  const mockConfig: FlexibleConfig = {};
  Object.keys(keysAndValues).forEach((key) => {
    mockConfig[key] = keysAndValues[key];
  });

  jest.spyOn(Config, 'getConfig').mockReturnValue(mockConfig as ReturnType<typeof Config.getConfig>);
}

describe('stripe-subscription.service', () => {
  const opts: StripePaymentServiceOptions = {
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
    ctOrderService: paymentSDK.ctOrderService,
  };
  const stripeSubscriptionService = new StripeSubscriptionService(opts);

  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
    Stripe.prototype.subscriptions = {
      create: jest.fn(),
      retrieve: jest.fn(),
      update: jest.fn(),
    } as unknown as Stripe.SubscriptionsResource;
    Stripe.prototype.prices = {
      create: jest.fn(),
      search: jest.fn(),
      update: jest.fn(),
    } as unknown as Stripe.PricesResource;
    Stripe.prototype.products = {
      create: jest.fn(),
      search: jest.fn(),
    } as unknown as Stripe.ProductsResource;
    Stripe.prototype.invoices = {
      retrieve: jest.fn(),
      sendInvoice: jest.fn(),
    } as unknown as Stripe.InvoicesResource;
    Stripe.prototype.setupIntents = {
      create: jest.fn(),
      retrieve: jest.fn(),
    } as unknown as Stripe.SetupIntentsResource;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('method createSetupIntent', () => {
    test('should create setup intent successfully', async () => {
      const prepareSubscriptionDataMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue({
          cart: mockGetCartResult(),
          stripeCustomerId: mockStripeCustomerId,
          subscriptionParams: {
            customer: mockStripeCustomerId,
            off_session: true,
          },
          billingAddress: '',
          merchantReturnUrl: '',
        });
      const stripeCreateSetupIntentMock = jest
        .spyOn(Stripe.prototype.setupIntents, 'create')
        .mockResolvedValue(setupIntentResponseMock);

      const result = await stripeSubscriptionService.createSetupIntent();
      expect(result.clientSecret).toStrictEqual(setupIntentResponseMock.client_secret);
      expect(prepareSubscriptionDataMock).toHaveBeenCalled();
      expect(stripeCreateSetupIntentMock).toHaveBeenCalled();
    });

    test('should create setup intent successfully', async () => {
      const prepareSubscriptionDataMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue({
          cart: mockGetCartResult(),
          stripeCustomerId: mockStripeCustomerId,
          subscriptionParams: {
            customer: mockStripeCustomerId,
            off_session: true,
          },
          billingAddress: '',
          merchantReturnUrl: '',
        });
      const error = new Error('Failed to create Setup Intent');
      const stripeCreateSetupIntentMock = jest
        .spyOn(Stripe.prototype.setupIntents, 'create')
        .mockReturnValue(Promise.reject(error));
      const wrapStripeError = jest.spyOn(StripeClient, 'wrapStripeError').mockReturnValue(error);

      try {
        await stripeSubscriptionService.createSetupIntent();
      } catch (error) {
        expect(wrapStripeError).toHaveBeenCalledWith(error);
      }
      expect(prepareSubscriptionDataMock).toHaveBeenCalled();
      expect(stripeCreateSetupIntentMock).toHaveBeenCalled();
    });
  });

  describe('method createSubscription', () => {
    test('should create subscription successful', async () => {
      const prepareSubscriptionDataMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockImplementation(async () => ({
          cart: mockGetSubscriptionCartWithVariant(1),
          stripeCustomerId: mockStripeCustomerId,
          subscriptionParams: { customer: mockStripeCustomerId, off_session: true },
          billingAddress: '',
          merchantReturnUrl: '',
          amountPlanned: mockGetPaymentAmount,
          priceId: stripePriceIdMock,
        }));
      const stripeCreateSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'create')
        .mockResolvedValue(subscriptionResponseMock);
      const saveSubscriptionIdMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId')
        .mockResolvedValue();
      const handleCtPaymentCreationMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation')
        .mockResolvedValue(mockGetPaymentResult.id);

      const result = await stripeSubscriptionService.createSubscription();

      expect(result).toBeDefined();
      expect(result.subscriptionId).toStrictEqual(subscriptionResponseMock.id);
      expect(result.clientSecret).toStrictEqual(mockStripeCreatePaymentResult.client_secret);
      expect(result.paymentReference).toStrictEqual(mockGetPaymentResult.id);
      expect(Logger.log.info).toBeCalled();
      expect(prepareSubscriptionDataMock).toHaveBeenCalled();
      expect(stripeCreateSubscriptionMock).toHaveBeenCalled();
      expect(saveSubscriptionIdMock).toHaveBeenCalled();
      expect(handleCtPaymentCreationMock).toHaveBeenCalled();
    });

    test('should fail to create subscription', async () => {
      const error = new Error('Failed to create subscription');
      const prepareSubscriptionDataMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockImplementation(async () => ({
          cart: mockGetSubscriptionCartWithVariant(1),
          stripeCustomerId: mockStripeCustomerId,
          subscriptionParams: { customer: mockStripeCustomerId, off_session: true },
          billingAddress: '',
          merchantReturnUrl: '',
          amountPlanned: mockGetPaymentAmount,
          priceId: stripePriceIdMock,
        }));
      const stripeCreateSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'create')
        .mockReturnValue(Promise.reject(error));
      const wrapStripeError = jest.spyOn(StripeClient, 'wrapStripeError').mockReturnValue(error);

      try {
        await stripeSubscriptionService.createSubscription();
      } catch (error) {
        expect(wrapStripeError).toHaveBeenCalledWith(error);
      }
      expect(prepareSubscriptionDataMock).toHaveBeenCalled();
      expect(stripeCreateSubscriptionMock).toHaveBeenCalled();
    });
  });

  describe('method createSubscriptionFromSetupIntent', () => {
    test('should create subscription successful', async () => {
      const prepareSubscriptionDataMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockImplementation(async () => ({
          cart: mockGetSubscriptionCartWithVariant(1),
          stripeCustomerId: mockStripeCustomerId,
          subscriptionParams: { customer: mockStripeCustomerId, off_session: true },
          merchantReturnUrl: '',
          amountPlanned: mockGetPaymentAmount,
          priceId: stripePriceIdMock,
        }));
      const stripeRetrieveSetupIntentMock = jest
        .spyOn(Stripe.prototype.setupIntents, 'retrieve')
        .mockResolvedValue(setupIntentResponseMock);
      const stripeCreateSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'create')
        .mockResolvedValue(subscriptionResponseMock);
      const saveSubscriptionIdMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId')
        .mockResolvedValue();
      const handleCtPaymentCreationMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation')
        .mockResolvedValue(mockGetPaymentResult.id);

      const result = await stripeSubscriptionService.createSubscriptionFromSetupIntent(setupIntentIdMock);

      expect(result).toBeDefined();
      expect(result.subscriptionId).toStrictEqual(subscriptionResponseMock.id);
      expect(result.paymentReference).toStrictEqual(mockGetPaymentResult.id);
      expect(Logger.log.info).toBeCalled();
      expect(prepareSubscriptionDataMock).toHaveBeenCalled();
      expect(stripeRetrieveSetupIntentMock).toHaveBeenCalled();
      expect(stripeCreateSubscriptionMock).toHaveBeenCalled();
      expect(saveSubscriptionIdMock).toHaveBeenCalled();
      expect(handleCtPaymentCreationMock).toHaveBeenCalled();
    });

    test('should create subscription with invoice successfully', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(6);
      const prepareSubscriptionDataMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockImplementation(async () => ({
          cart: mockCart,
          stripeCustomerId: mockStripeCustomerId,
          subscriptionParams: { customer: mockStripeCustomerId, off_session: true, collection_method: 'send_invoice' },
          merchantReturnUrl: '',
          amountPlanned: mockGetPaymentAmount,
          priceId: stripePriceIdMock,
        }));
      const stripeRetrieveSetupIntentMock = jest
        .spyOn(Stripe.prototype.setupIntents, 'retrieve')
        .mockResolvedValue(setupIntentResponseMock);
      const stripeCreateSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'create')
        .mockResolvedValue(subscriptionResponseMock);
      const stripeSendInvoiceMock = jest
        .spyOn(Stripe.prototype.invoices, 'sendInvoice')
        .mockResolvedValue(mockInvoiceWithAmountDue);
      const saveSubscriptionIdMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId')
        .mockResolvedValue();
      const handleCtPaymentCreationMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation')
        .mockResolvedValue(mockGetPaymentResult.id);

      const result = await stripeSubscriptionService.createSubscriptionFromSetupIntent(setupIntentIdMock);

      expect(result).toBeDefined();
      expect(result.subscriptionId).toStrictEqual(subscriptionResponseMock.id);
      expect(result.paymentReference).toStrictEqual(mockGetPaymentResult.id);
      expect(prepareSubscriptionDataMock).toHaveBeenCalled();
      expect(stripeRetrieveSetupIntentMock).toHaveBeenCalled();
      expect(stripeCreateSubscriptionMock).toHaveBeenCalled();
      expect(Logger.log.info).toBeCalledWith('Stripe Subscription from Setup Intent created.', {
        ctCartId: mockCart.id,
        stripeSubscriptionId: subscriptionResponseMock.id,
        stripeSetupIntentId: setupIntentIdMock,
      });
      expect(stripeSendInvoiceMock).toHaveBeenCalled();
      expect(Logger.log.info).toBeCalledWith('Stripe Subscription invoice was sent.');
      expect(saveSubscriptionIdMock).toHaveBeenCalled();
      expect(handleCtPaymentCreationMock).toHaveBeenCalled();
    });

    test('should create subscription with invoice as 0 (already paid) successfully', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(6);
      const prepareSubscriptionDataMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockImplementation(async () => ({
          cart: mockCart,
          stripeCustomerId: mockStripeCustomerId,
          subscriptionParams: { customer: mockStripeCustomerId, off_session: true, collection_method: 'send_invoice' },
          merchantReturnUrl: '',
          amountPlanned: mockGetPaymentAmount,
          priceId: stripePriceIdMock,
        }));
      const stripeRetrieveSetupIntentMock = jest
        .spyOn(Stripe.prototype.setupIntents, 'retrieve')
        .mockResolvedValue(setupIntentResponseMock);
      const stripeCreateSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'create')
        .mockResolvedValue(subscriptionResponseMock);
      const stripeSendInvoiceMock = jest.spyOn(Stripe.prototype.invoices, 'sendInvoice').mockResolvedValue(mockInvoice);
      const saveSubscriptionIdMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId')
        .mockResolvedValue();
      const handleCtPaymentCreationMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation')
        .mockResolvedValue(mockGetPaymentResult.id);

      const result = await stripeSubscriptionService.createSubscriptionFromSetupIntent(setupIntentIdMock);

      expect(result).toBeDefined();
      expect(result.subscriptionId).toStrictEqual(subscriptionResponseMock.id);
      expect(result.paymentReference).toStrictEqual(mockGetPaymentResult.id);
      expect(prepareSubscriptionDataMock).toHaveBeenCalled();
      expect(stripeRetrieveSetupIntentMock).toHaveBeenCalled();
      expect(stripeCreateSubscriptionMock).toHaveBeenCalled();
      expect(Logger.log.info).toBeCalledWith('Stripe Subscription from Setup Intent created.', {
        ctCartId: mockCart.id,
        stripeSubscriptionId: subscriptionResponseMock.id,
        stripeSetupIntentId: setupIntentIdMock,
      });
      expect(stripeSendInvoiceMock).toHaveBeenCalled();
      expect(Logger.log.info).toBeCalledWith('Stripe Subscription invoice is paid.');
      expect(saveSubscriptionIdMock).toHaveBeenCalled();
      expect(handleCtPaymentCreationMock).toHaveBeenCalled();
    });

    test('should create subscription and fail to send invoice successfully', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(6);
      const prepareSubscriptionDataMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockImplementation(async () => ({
          cart: mockCart,
          stripeCustomerId: mockStripeCustomerId,
          subscriptionParams: {
            customer: mockStripeCustomerId,
            off_session: true,
            collection_method: 'send_invoice',
            billing_cycle_anchor: 111564654,
            proration_behavior: 'none',
          },
          merchantReturnUrl: '',
          amountPlanned: mockGetPaymentAmount,
          priceId: stripePriceIdMock,
        }));
      const stripeRetrieveSetupIntentMock = jest
        .spyOn(Stripe.prototype.setupIntents, 'retrieve')
        .mockResolvedValue(setupIntentResponseMock);
      const stripeCreateSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'create')
        .mockResolvedValue(subscriptionResponseMock);
      const stripeSendInvoiceMock = jest
        .spyOn(Stripe.prototype.invoices, 'sendInvoice')
        .mockResolvedValue({ ...mockInvoiceWithAmountDue, status: 'draft' });
      const saveSubscriptionIdMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId')
        .mockResolvedValue();
      const handleCtPaymentCreationMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation')
        .mockResolvedValue(mockGetPaymentResult.id);

      const result = await stripeSubscriptionService.createSubscriptionFromSetupIntent(setupIntentIdMock);

      expect(result).toBeDefined();
      expect(result.subscriptionId).toStrictEqual(subscriptionResponseMock.id);
      expect(result.paymentReference).toStrictEqual(mockGetPaymentResult.id);
      expect(prepareSubscriptionDataMock).toHaveBeenCalled();
      expect(stripeRetrieveSetupIntentMock).toHaveBeenCalled();
      expect(stripeCreateSubscriptionMock).toHaveBeenCalled();
      expect(Logger.log.info).toBeCalledWith('Stripe Subscription from Setup Intent created.', {
        ctCartId: mockCart.id,
        stripeSubscriptionId: subscriptionResponseMock.id,
        stripeSetupIntentId: setupIntentIdMock,
      });
      expect(stripeSendInvoiceMock).toHaveBeenCalled();
      expect(Logger.log.warn).toBeCalledWith('Stripe Subscription invoice was not sent.');
      expect(saveSubscriptionIdMock).toHaveBeenCalled();
      expect(handleCtPaymentCreationMock).toHaveBeenCalled();
    });

    test('should throw an error due to missing payment method', async () => {
      const prepareSubscriptionDataMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockImplementation(async () => ({
          cart: mockGetSubscriptionCartWithVariant(1),
          stripeCustomerId: mockStripeCustomerId,
          subscriptionParams: { customer: mockStripeCustomerId, off_session: true },
          merchantReturnUrl: '',
          amountPlanned: mockGetPaymentAmount,
          priceId: stripePriceIdMock,
        }));
      const wrapStripeError = jest.spyOn(StripeClient, 'wrapStripeError');
      const stripeRetrieveSetupIntentMock = jest
        .spyOn(Stripe.prototype.setupIntents, 'retrieve')
        .mockResolvedValue({ ...setupIntentResponseMock, payment_method: null });

      try {
        await stripeSubscriptionService.createSubscriptionFromSetupIntent(setupIntentIdMock);
      } catch (error) {
        expect(wrapStripeError).toHaveBeenCalledWith(error);
      }

      expect(prepareSubscriptionDataMock).toHaveBeenCalled();
      expect(stripeRetrieveSetupIntentMock).toHaveBeenCalled();
    });
  });

  describe('method prepareSubscriptionData', () => {
    test('should return basic subscription data successfully', async () => {
      setupMockConfig({
        stripeCollectBillingAddress: 'auto',
        merchantReturnUrl: '',
      });
      const mockCart = mockGetSubscriptionCartWithVariant(1);
      const getCartExpandedMock = jest.spyOn(CartClient, 'getCartExpanded').mockResolvedValue(mockCart);
      const getCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'getCtCustomer')
        .mockResolvedValue(mockCtCustomerData);
      const result = await stripeSubscriptionService.prepareSubscriptionData({ basicData: true });

      expect(result).toBeDefined();
      expect(getCartExpandedMock).toHaveBeenCalled();
      expect(getCustomerMock).toHaveBeenCalled();
      expect(result.cart).toStrictEqual(mockCart);
      expect(result.stripeCustomerId).toStrictEqual(mockStripeCustomerId);
      expect(result.subscriptionParams).toBeDefined();
      expect(result.merchantReturnUrl).toBeDefined();
      expect(result.billingAddress).toBeUndefined();
    });

    test('should return all subscription data successfully', async () => {
      setupMockConfig({
        stripeCollectBillingAddress: 'never',
        merchantReturnUrl: '',
      });
      const mockCart = mockGetSubscriptionCartWithVariant(1);
      const getCartExpandedMock = jest.spyOn(CartClient, 'getCartExpanded').mockResolvedValue(mockCart);
      const getCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'getCtCustomer')
        .mockResolvedValue(mockCtCustomerData);
      const getBillingAddressMock = jest
        .spyOn(StripeCustomerService.prototype, 'getBillingAddress')
        .mockReturnValue('{}');
      const getPaymentMock = jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockResolvedValue(mockGetPaymentAmount);
      const getPriceIdMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'getSubscriptionPriceId')
        .mockResolvedValue(stripePriceIdMock);
      const result = await stripeSubscriptionService.prepareSubscriptionData();

      expect(result).toBeDefined();
      expect(getCartExpandedMock).toHaveBeenCalled();
      expect(getCustomerMock).toHaveBeenCalled();
      expect(getBillingAddressMock).toHaveBeenCalled();
      expect(getPaymentMock).toHaveBeenCalled();
      expect(getPriceIdMock).toHaveBeenCalled();
      expect(result.cart).toStrictEqual(mockCart);
      expect(result.stripeCustomerId).toStrictEqual(mockStripeCustomerId);
      expect(result.subscriptionParams).toBeDefined();
      expect(result.priceId).toStrictEqual(stripePriceIdMock);
      expect(result.amountPlanned).toStrictEqual(mockGetPaymentAmount);
      expect(result.merchantReturnUrl).toBeDefined();
      expect(result.billingAddress).toBeDefined();
    });

    test('should return all subscription data successfully', async () => {
      const mockCart = mockGetSubscriptionCartWithTwoItems;
      const getCartExpandedMock = jest.spyOn(CartClient, 'getCartExpanded').mockResolvedValue(mockCart);
      const result = stripeSubscriptionService.prepareSubscriptionData();
      expect(getCartExpandedMock).toHaveBeenCalled();
      expect(result).rejects.toThrowError();
    });
  });

  describe('method validateSubscription', () => {
    test('should throw error subscription has no invoice', async () => {
      expect(() =>
        stripeSubscriptionService.validateSubscription(subscriptionWithoutPaymentResponseMock),
      ).toThrowError();
    });
  });

  describe('method getSubscriptionPriceId', () => {
    test('should get the existing stripe price ID', async () => {
      const stripeSearchPricesMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'getStripePriceByMetadata')
        .mockResolvedValue(stripePriceResponseMock);

      const result = await stripeSubscriptionService.getSubscriptionPriceId(
        mockGetSubscriptionCartWithVariant(1),
        mockGetPaymentAmount,
      );
      expect(result).toStrictEqual(stripePriceIdMock);
      expect(Logger.log.info).toBeCalled();
      expect(stripeSearchPricesMock).toHaveBeenCalled();
    });

    test('should disasble old stripe price and create new one successfully', async () => {
      const stripeUpdatePaymentIntentMock = jest
        .spyOn(Stripe.prototype.prices, 'search')
        .mockResolvedValue(stripeDifferentPriceResponseMock);
      const getStripeProductIdMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'getStripeProduct')
        .mockResolvedValue(stripeProductIdMock);
      const disableStripePriceMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'disableStripePrice')
        .mockResolvedValue();
      const createStripePriceMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'createStripePrice')
        .mockResolvedValue(stripePriceIdMock);

      const result = await stripeSubscriptionService.getSubscriptionPriceId(mockGetCartResult(), mockGetPaymentAmount);
      expect(result).toStrictEqual(stripePriceIdMock);
      expect(Logger.log.info).toBeCalled();
      expect(stripeUpdatePaymentIntentMock).toHaveBeenCalled();
      expect(getStripeProductIdMock).toHaveBeenCalled();
      expect(disableStripePriceMock).toHaveBeenCalled();
      expect(createStripePriceMock).toHaveBeenCalled();
    });

    test('should create a stripe price successfully', async () => {
      const stripeUpdatePaymentIntentMock = jest
        .spyOn(Stripe.prototype.prices, 'search')
        .mockResolvedValue(stripePriceEmptyResponseMock);
      const getStripeProductIdMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'getStripeProduct')
        .mockResolvedValue(stripeProductIdMock);
      const createStripePriceMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'createStripePrice')
        .mockResolvedValue(stripePriceIdMock);

      const result = await stripeSubscriptionService.getSubscriptionPriceId(mockGetCartResult(), mockGetPaymentAmount);
      expect(result).toStrictEqual(stripePriceIdMock);
      expect(Logger.log.info).toBeCalled();
      expect(stripeUpdatePaymentIntentMock).toHaveBeenCalled();
      expect(getStripeProductIdMock).toHaveBeenCalled();
      expect(createStripePriceMock).toHaveBeenCalled();
    });
  });

  describe('method disableStripePrice', () => {
    test('should disable stripe price successfully', async () => {
      const stripeUpdatePriceMock = jest
        .spyOn(Stripe.prototype.prices, 'update')
        .mockResolvedValue(stripePriceDataMock);

      const result = await stripeSubscriptionService.disableStripePrice(
        stripePriceDataMock,
        mockGetSubscriptionCartWithVariant(1).lineItems[0],
      );
      expect(result).toBeUndefined();
      expect(Logger.log.warn).toBeCalled();
      expect(stripeUpdatePriceMock).toHaveBeenCalled();
    });

    test('should disable stripe price without nickname successfully', async () => {
      const stripeUpdatePriceMock = jest
        .spyOn(Stripe.prototype.prices, 'update')
        .mockResolvedValue(stripePriceDataMock);

      const result = await stripeSubscriptionService.disableStripePrice(
        { ...stripePriceDataMock, nickname: null },
        mockGetSubscriptionCartWithVariant(1).lineItems[0],
      );
      expect(result).toBeUndefined();
      expect(Logger.log.warn).toBeCalled();
      expect(stripeUpdatePriceMock).toHaveBeenCalled();
    });
  });

  describe('method getStripeProduct', () => {
    test('should get the existing stripe product ID', async () => {
      const productMock = lineItem;
      const stripeSearchProducts = jest
        .spyOn(Stripe.prototype.products, 'search')
        .mockResolvedValue(stripeProductResponseMock);

      const result = await stripeSubscriptionService.getStripeProduct(productMock);
      expect(result).toStrictEqual(stripeProductIdMock);
      expect(Logger.log.info).toBeCalled();
      expect(stripeSearchProducts).toHaveBeenCalled();
    });

    test('should create a new stripe product ID', async () => {
      const productMock = lineItem;
      const stripeSearchProducts = jest
        .spyOn(Stripe.prototype.products, 'search')
        .mockResolvedValue(stripeProductEmptyResponseMock);
      const createStripeProductMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'createStripeProduct')
        .mockResolvedValue(stripeProductIdMock);

      const result = await stripeSubscriptionService.getStripeProduct(productMock);
      expect(result).toStrictEqual(stripeProductIdMock);
      expect(Logger.log.info).toBeCalled();
      expect(stripeSearchProducts).toHaveBeenCalled();
      expect(createStripeProductMock).toHaveBeenCalled();
    });
  });

  describe('method createStripeProduct', () => {
    test('should create a new stripe product', async () => {
      const stripeCreateProductMock = jest
        .spyOn(Stripe.prototype.products, 'create')
        .mockResolvedValue(stripeProductDataMock);

      const result = await stripeSubscriptionService.createStripeProduct(lineItem);
      expect(result).toStrictEqual(stripeProductIdMock);
      expect(Logger.log.info).toBeCalled();
      expect(stripeCreateProductMock).toHaveBeenCalled();
    });
  });

  describe('method createStripePrice', () => {
    test('should create a new stripe price', async () => {
      const productMock = mockGetCartResult().lineItems[0];
      const stripeCreatePriceMock = jest
        .spyOn(Stripe.prototype.prices, 'create')
        .mockResolvedValue(stripePriceDataMock);

      const result = await stripeSubscriptionService.createStripePrice({
        amount: mockGetPaymentAmount,
        product: productMock,
        stripeProductId: stripeProductIdMock,
        attributes: mockSubscriptionAttributes,
      });
      expect(result).toStrictEqual(stripePriceIdMock);
      expect(stripeCreatePriceMock).toHaveBeenCalled();
    });
  });

  describe('method createStripeSetupIntent', () => {
    test('should create a new stripe price', async () => {
      const stripeCreatePriceMock = jest
        .spyOn(Stripe.prototype.setupIntents, 'create')
        .mockResolvedValue(setupIntentResponseMock);

      const result = await stripeSubscriptionService.createStripeSetupIntent({
        cart: mockGetCartResult(),
        stripeCustomerId: 'stripeCustomerId',
        offSession: true,
      });
      expect(result.id).toStrictEqual(setupIntentResponseMock.id);
      expect(result.clientSecret).toStrictEqual(setupIntentResponseMock.client_secret);
      expect(Logger.log.info).toBeCalled();
      expect(stripeCreatePriceMock).toHaveBeenCalled();
    });

    test('should fail to create a new stripe price', async () => {
      const stripeCreatePriceMock = jest
        .spyOn(Stripe.prototype.setupIntents, 'create')
        .mockResolvedValue({ ...setupIntentResponseMock, client_secret: null });

      const result = stripeSubscriptionService.createStripeSetupIntent({
        cart: mockGetCartResult(),
        stripeCustomerId: 'stripeCustomerId',
        offSession: false,
      });
      expect(result).rejects.toThrowError(new Error('Failed to create Setup Intent.'));
      expect(stripeCreatePriceMock).toHaveBeenCalled();
    });
  });

  describe('method saveSubscriptionId', () => {
    test('should save subscription ID successfully', async () => {
      const getCustomFieldUpdateActionsMock = jest
        .spyOn(CustomTypeHelper, 'getCustomFieldUpdateActions')
        .mockResolvedValue(mock_SetLineItemCustomFieldActions);
      const updateCartByIdMock = jest.spyOn(CartClient, 'updateCartById').mockResolvedValue(mockGetCartResult());

      const result = await stripeSubscriptionService.saveSubscriptionId(mockGetCartResult(), 'stripeSubscriptionId');
      expect(result).toBeUndefined();
      expect(Logger.log.info).toBeCalled();
      expect(getCustomFieldUpdateActionsMock).toHaveBeenCalled();
      expect(updateCartByIdMock).toHaveBeenCalled();
    });
  });

  describe('method confirmSubscriptionPayment', () => {
    test('should confirm subscription payment successfully', async () => {
      const getCartMock = jest
        .spyOn(DefaultCartService.prototype, 'getCart')
        .mockResolvedValue(mockGetSubscriptionCart);
      const getInvoiceFromSubscriptionMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'getInvoiceFromSubscription')
        .mockResolvedValue(mockInvoice);
      const getCurrentPaymentMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'getCurrentPayment')
        .mockResolvedValue(mockGetPaymentResult);
      const updateSubscriptionPaymentTransactionsMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'updateSubscriptionPaymentTransactions')
        .mockResolvedValue();
      const createOrderMock = jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue();

      const result = await stripeSubscriptionService.confirmSubscriptionPayment({
        paymentReference: 'paymentReference',
        subscriptionId: 'subscriptionId',
        paymentIntentId: 'paymentIntentId',
      });

      expect(result).toBeUndefined();
      expect(getCartMock).toHaveBeenCalled();
      expect(getInvoiceFromSubscriptionMock).toHaveBeenCalled();
      expect(getCurrentPaymentMock).toHaveBeenCalled();
      expect(updateSubscriptionPaymentTransactionsMock).toHaveBeenCalled();
      expect(createOrderMock).toHaveBeenCalled();
    });

    test('should confirm subscription payment with subscription ID successfully', async () => {
      const getCartMock = jest
        .spyOn(DefaultCartService.prototype, 'getCart')
        .mockResolvedValue(mockGetSubscriptionCartWithVariant(8));
      const getInvoiceFromSubscriptionMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'getInvoiceFromSubscription')
        .mockResolvedValue(undefined as never);
      const getCurrentPaymentMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'getCurrentPayment')
        .mockResolvedValue(mockGetPaymentResult);
      const updateSubscriptionPaymentTransactionsMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'updateSubscriptionPaymentTransactions')
        .mockResolvedValue();
      const createOrderMock = jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue();

      const result = await stripeSubscriptionService.confirmSubscriptionPayment({
        paymentReference: 'paymentReference',
        subscriptionId: 'subscriptionId',
      });

      expect(result).toBeUndefined();
      expect(getCartMock).toHaveBeenCalled();
      expect(getInvoiceFromSubscriptionMock).toHaveBeenCalled();
      expect(getCurrentPaymentMock).toHaveBeenCalled();
      expect(updateSubscriptionPaymentTransactionsMock).toHaveBeenCalled();
      expect(createOrderMock).toHaveBeenCalled();
    });

    test('should confirm subscription payment successfully without invoice', async () => {
      const getCartMock = jest
        .spyOn(DefaultCartService.prototype, 'getCart')
        .mockResolvedValue(mockGetSubscriptionCartWithVariant(6));
      const getCurrentPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockResolvedValue(mockGetPaymentResult);
      const updateSubscriptionPaymentTransactionsMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'updateSubscriptionPaymentTransactions')
        .mockResolvedValue();
      const createOrderMock = jest.spyOn(StripePaymentService.prototype, 'createOrder').mockResolvedValue();

      const result = await stripeSubscriptionService.confirmSubscriptionPayment({
        paymentReference: 'paymentReference',
        subscriptionId: 'subscriptionId',
      });

      expect(result).toBeUndefined();
      expect(getCartMock).toHaveBeenCalled();
      expect(getCurrentPaymentMock).toHaveBeenCalled();
      expect(updateSubscriptionPaymentTransactionsMock).toHaveBeenCalled();
      expect(createOrderMock).toHaveBeenCalled();
    });

    test('should fail to confirm subscription payment', async () => {
      const error = new Error('Failed to get cart');
      const getCartMock = jest.spyOn(DefaultCartService.prototype, 'getCart').mockReturnValue(Promise.reject(error));
      const wrapStripeError = jest.spyOn(StripeClient, 'wrapStripeError').mockReturnValue(error);

      try {
        await stripeSubscriptionService.confirmSubscriptionPayment({
          paymentReference: 'paymentReference',
          subscriptionId: 'subscriptionId',
          paymentIntentId: 'paymentIntentId',
        });
      } catch (error) {
        expect(wrapStripeError).toHaveBeenCalledWith(error);
      }
      expect(getCartMock).toHaveBeenCalled();
    });
  });

  describe('method getInvoiceFromSubscription', () => {
    test('should get invoice from subscription successfully', async () => {
      const stripeGetInvoiceMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'retrieve')
        .mockResolvedValue(subscriptionResponseMock);

      const result = await stripeSubscriptionService.getInvoiceFromSubscription(mockSubscriptionId);
      expect(result).toStrictEqual(subscriptionResponseMock.latest_invoice);
      expect(stripeGetInvoiceMock).toHaveBeenCalled();
    });

    test('should fail to get invoice from subscription', async () => {
      const stripeGetInvoiceMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'retrieve')
        .mockResolvedValue(subscriptionWithoutPaymentResponseMock);

      const result = stripeSubscriptionService.getInvoiceFromSubscription(mockSubscriptionId);
      expect(result).rejects.toThrow();
      expect(stripeGetInvoiceMock).toHaveBeenCalled();
    });
  });

  describe('method getCurrentPayment', () => {
    test('should get default payment successfully', async () => {
      const getPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockResolvedValue(mockGetPaymentResult);

      const result = await stripeSubscriptionService.getCurrentPayment({
        invoice: mockInvoice,
        paymentReference: 'paymentReference',
        subscriptionParams: {
          customer: mockStripeCustomerId,
        },
      });
      expect(result.amountPlanned.centAmount).toStrictEqual(mockGetPaymentResult.amountPlanned.centAmount);
      expect(getPaymentMock).toHaveBeenCalled();
    });

    test('should get payment with price as 0', async () => {
      const getPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockResolvedValue(mockGetPaymentResult);

      const result = await stripeSubscriptionService.getCurrentPayment({
        invoice: mockInvoice,
        paymentReference: 'paymentReference',
        subscriptionParams: {
          customer: mockStripeCustomerId,
          trial_end: 12165454864,
        },
      });
      expect(result.amountPlanned.centAmount).toStrictEqual(0);
      expect(getPaymentMock).toHaveBeenCalled();
    });

    test('should get payment with price as amount_due', async () => {
      const getPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockResolvedValue(mockGetPaymentResult);

      const result = await stripeSubscriptionService.getCurrentPayment({
        invoice: mockInvoiceWithAmountDue,
        paymentReference: 'paymentReference',
        subscriptionParams: {
          customer: mockStripeCustomerId,
          billing_cycle_anchor: 12165454864,
          collection_method: 'send_invoice',
          proration_behavior: 'create_prorations',
        },
      });
      expect(result.amountPlanned.centAmount).toStrictEqual(mockInvoiceWithAmountDue.amount_due);
      expect(getPaymentMock).toHaveBeenCalled();
    });

    test('should get payment with price as amount_paid', async () => {
      const getPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockResolvedValue(mockGetPaymentResult);

      const result = await stripeSubscriptionService.getCurrentPayment({
        invoice: mockInvoice,
        paymentReference: 'paymentReference',
        subscriptionParams: {
          customer: mockStripeCustomerId,
          billing_cycle_anchor: 12165454864,
          collection_method: 'charge_automatically',
          proration_behavior: 'create_prorations',
        },
      });
      expect(result.amountPlanned.centAmount).toStrictEqual(mockInvoiceWithAmountDue.amount_due);
      expect(getPaymentMock).toHaveBeenCalled();
    });
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

    test('should get payment mode as subscription', () => {
      const result = stripeSubscriptionService.getPaymentMode(mockGetSubscriptionCart);
      expect(result).toStrictEqual('subscription');
    });
  });

  describe('method getSubscriptionPaymentAmount', () => {
    test('should get subscription payment amount successfully', () => {
      const result = stripeSubscriptionService.getSubscriptionPaymentAmount(mockGetSubscriptionCartWithVariant(6));
      expect(result).toStrictEqual(mockGetPaymentAmount);
    });

    test('should throw an error', () => {
      expect(() => stripeSubscriptionService.getSubscriptionPaymentAmount(mockGetCartResult())).toThrowError(
        'Cart is not a subscription.',
      );
    });
  });
});
