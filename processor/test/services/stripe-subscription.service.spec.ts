import Stripe from 'stripe';
import { afterAll, afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { paymentSDK } from '../../src/payment-sdk';
import {
  lineItem,
  lineItemSubscription,
  mockGetCartResult,
  mockGetSubscriptionCart,
  mockGetSubscriptionCartWithTwoItems,
  mockGetSubscriptionCartWithVariant,
  shippingInfo,
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
import { DefaultPaymentService } from '@commercetools/connect-payments-sdk/dist/commercetools/services/ct-payment.service';
import { mockCtCustomerData, mockStripeCustomerId } from '../utils/mock-customer-data';
import { StripeCustomerService } from '../../src/services/stripe-customer.service';
import { StripeCouponService } from '../../src/services/stripe-coupon.service';
import * as Logger from '../../src/libs/logger/index';
import * as CustomTypeHelper from '../../src/services/commerce-tools/custom-type-helper';
import * as CartClient from '../../src/services/commerce-tools/cart-client';
import * as CustomerClient from '../../src/services/commerce-tools/customer-client';
import * as StripeClient from '../../src/clients/stripe.client';
import * as Config from '../../src/config/config';
import fastify, { FastifyInstance } from 'fastify';
import {
  AuthorityAuthorizationHook,
  CommercetoolsCartService,
  CommercetoolsOrderService,
  CommercetoolsPaymentService,
  Oauth2AuthenticationHook,
  SessionHeaderAuthenticationHook,
} from '@commercetools/connect-payments-sdk';
import { IncomingHttpHeaders } from 'node:http';
import { subscriptionRoutes } from '../../src/routes/stripe-subscription.route';
import { SubscriptionOutcome } from '../../src/dtos/stripe-payment.dto';

jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {}),
}));
jest.mock('../../src/libs/logger');

// Helper function to get variant (copied from mock-cart-data.ts)
const getVariant = (num: number): any => {
  const variants = {
    1: { id: 1, sku: 'variant-sku-1' },
    6: { id: 6, sku: 'variant-sku-6' },
  };
  return variants[num as keyof typeof variants];
};

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
  const token = 'token';
  let fastifyApp: FastifyInstance = fastify({ logger: false });

  const spyAuthenticateOauth2 = jest
    .spyOn(Oauth2AuthenticationHook.prototype, 'authenticate')
    .mockImplementation(() => async (request: { headers: IncomingHttpHeaders }) => {
      expect(request.headers['authorization']).toContain(`Bearer ${token}`);
    });

  const spyAuthenticateSession = jest
    .spyOn(SessionHeaderAuthenticationHook.prototype, 'authenticate')
    .mockImplementationOnce(() => async (request: { headers: IncomingHttpHeaders }) => {
      expect(request.headers['x-session-id']).toContain('session-id');
    });

  const spyAuthenticateAuthority = jest
    .spyOn(AuthorityAuthorizationHook.prototype, 'authorize')
    .mockImplementation(() => async () => {
      expect('manage_project').toEqual('manage_project');
    });

  let spiedSubscriptionService = new StripeSubscriptionService({
    ctCartService: jest.fn() as unknown as CommercetoolsCartService,
    ctPaymentService: jest.fn() as unknown as CommercetoolsPaymentService,
    ctOrderService: jest.fn() as unknown as CommercetoolsOrderService,
  });

  beforeEach(async () => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
    Stripe.prototype.subscriptions = {
      create: jest.fn(),
      retrieve: jest.fn(),
      update: jest.fn(),
      list: jest.fn(),
      cancel: jest.fn(),
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
      create: jest.fn(),
      finalizeInvoice: jest.fn(),
    } as unknown as Stripe.InvoicesResource;
    Stripe.prototype.invoiceItems = {
      create: jest.fn(),
    } as unknown as Stripe.InvoiceItemsResource;
    Stripe.prototype.setupIntents = {
      create: jest.fn(),
      retrieve: jest.fn(),
    } as unknown as Stripe.SetupIntentsResource;

    await fastifyApp.close();
    fastifyApp = fastify({ logger: false });

    // Create properly mocked hooks and service
    const spiedSessionHeaderAuthenticationHook = {
      authenticate: jest.fn().mockReturnValue(async () => {}),
    } as unknown as SessionHeaderAuthenticationHook;

    const spiedOauth2AuthenticationHook = {
      authenticate: jest.fn().mockReturnValue(async () => {}),
    } as unknown as Oauth2AuthenticationHook;

    const spiedAuthorityAuthorizationHook = {
      authorize: jest.fn().mockReturnValue(async () => {}),
    } as unknown as AuthorityAuthorizationHook;

    // Create mock subscription service with all required methods
    spiedSubscriptionService = {
      createSetupIntent: jest.fn(),
      createSubscription: jest.fn(),
      createSubscriptionFromSetupIntent: jest.fn(),
      confirmSubscriptionPayment: jest.fn(),
      getCustomerSubscriptions: jest.fn(),
      cancelSubscription: jest.fn(),
      updateSubscription: jest.fn(),
    } as unknown as StripeSubscriptionService;

    // Re-register routes with fresh mocks
    await fastifyApp.register(subscriptionRoutes, {
      prefix: '',
      sessionHeaderAuthHook: spiedSessionHeaderAuthenticationHook,
      oauth2AuthHook: spiedOauth2AuthenticationHook,
      authorizationHook: spiedAuthorityAuthorizationHook,
      subscriptionService: spiedSubscriptionService,
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    spyAuthenticateOauth2.mockClear();
    spyAuthenticateSession.mockClear();
    spyAuthenticateAuthority.mockClear();
    await fastifyApp.ready();
  });

  afterAll(async () => {
    await fastifyApp.close();
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
      expect(Logger.log.info).toHaveBeenCalled();
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
      expect(Logger.log.info).toHaveBeenCalled();
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
      expect(Logger.log.info).toHaveBeenCalledWith('Stripe Subscription from Setup Intent created.', {
        ctCartId: mockCart.id,
        stripeSubscriptionId: subscriptionResponseMock.id,
        stripeSetupIntentId: setupIntentIdMock,
      });
      expect(stripeSendInvoiceMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalledWith('Stripe Subscription invoice was sent.');
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
      expect(Logger.log.info).toHaveBeenCalledWith('Stripe Subscription from Setup Intent created.', {
        ctCartId: mockCart.id,
        stripeSubscriptionId: subscriptionResponseMock.id,
        stripeSetupIntentId: setupIntentIdMock,
      });
      expect(stripeSendInvoiceMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalledWith('Stripe Subscription invoice is paid.');
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
      expect(Logger.log.info).toHaveBeenCalledWith('Stripe Subscription from Setup Intent created.', {
        ctCartId: mockCart.id,
        stripeSubscriptionId: subscriptionResponseMock.id,
        stripeSetupIntentId: setupIntentIdMock,
      });
      expect(stripeSendInvoiceMock).toHaveBeenCalled();
      expect(Logger.log.warn).toHaveBeenCalledWith('Stripe Subscription invoice was not sent.');
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
        const stripeSearchProductsMock = jest
          .spyOn(Stripe.prototype.products, 'search')
          .mockResolvedValue(stripeProductEmptyResponseMock);
        const stripeCreateProductMock = jest
          .spyOn(Stripe.prototype.products, 'create')
          .mockResolvedValue(stripeProductDataMock);
        const stripeSearchPricesMock = jest
          .spyOn(Stripe.prototype.prices, 'search')
          .mockResolvedValue(stripePriceEmptyResponseMock);
        const stripeCreatePriceMock = jest
          .spyOn(Stripe.prototype.prices, 'create')
          .mockResolvedValue(stripePriceDataMock);
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

    test('should work with cart that has subscription and other items', async () => {
      setupMockConfig({
        stripeCollectBillingAddress: 'auto',
        merchantReturnUrl: '',
      });
      const mockCartWithMixedItems = {
        ...mockGetCartResult(),
        lineItems: [
          { ...lineItem, id: 'regular-item-1', quantity: 1 }, // Regular item first
          { ...lineItemSubscription, variant: getVariant(1), quantity: 2, id: 'subscription-item-1' }, // Subscription item second
          { ...lineItem, id: 'regular-item-2', quantity: 1 } // Another regular item
        ]
      };
      const getCartExpandedMock = jest.spyOn(CartClient, 'getCartExpanded').mockResolvedValue(mockCartWithMixedItems);
      const getCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'getCtCustomer')
        .mockResolvedValue(mockCtCustomerData);
      
      const result = await stripeSubscriptionService.prepareSubscriptionData({ basicData: true });

      expect(result).toBeDefined();
      expect(getCartExpandedMock).toHaveBeenCalled();
      expect(getCustomerMock).toHaveBeenCalled();
      expect(result.cart).toStrictEqual(mockCartWithMixedItems);
      expect(result.stripeCustomerId).toStrictEqual(mockStripeCustomerId);
      expect(result.subscriptionParams).toBeDefined();
      expect(result.merchantReturnUrl).toBeDefined();
      expect(result.billingAddress).toBeUndefined();
    });

    test('should create subscription with all line items included', async () => {
      setupMockConfig({
        stripeCollectBillingAddress: 'auto',
        merchantReturnUrl: '',
      });
      const mockCartWithMixedItems = {
        ...mockGetCartResult(),
        lineItems: [
          { ...lineItem, id: 'regular-item-1', quantity: 2 }, // Regular item first
          { ...lineItemSubscription, variant: getVariant(1), quantity: 1, id: 'subscription-item-1' }, // Subscription item second
          { ...lineItem, id: 'regular-item-2', quantity: 3 } // Another regular item
        ]
      };
      
      const getCartExpandedMock = jest.spyOn(CartClient, 'getCartExpanded').mockResolvedValue(mockCartWithMixedItems);
      const getCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'getCtCustomer')
        .mockResolvedValue(mockCtCustomerData);
      const getPaymentMock = jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockResolvedValue(mockGetPaymentAmount);
      const getPriceIdMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'getSubscriptionPriceId')
        .mockResolvedValue(stripePriceIdMock);
      const stripeSearchProductsMock = jest
        .spyOn(Stripe.prototype.products, 'search')
        .mockResolvedValue(stripeProductEmptyResponseMock);
      const stripeCreateProductMock = jest
        .spyOn(Stripe.prototype.products, 'create')
        .mockResolvedValue(stripeProductDataMock);
      const stripeSearchPricesMock = jest
        .spyOn(Stripe.prototype.prices, 'search')
        .mockResolvedValue(stripePriceEmptyResponseMock);
      const stripeCreatePriceMock = jest
        .spyOn(Stripe.prototype.prices, 'create')
        .mockResolvedValue(stripePriceDataMock);
      const stripeCreateSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'create')
        .mockResolvedValue(subscriptionResponseMock);
      const saveSubscriptionIdMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId')
        .mockResolvedValue();
      const handleCtPaymentCreationMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation')
        .mockResolvedValue('payment-reference');
      const getStripeCouponsMock = jest
        .spyOn(StripeCouponService.prototype, 'getStripeCoupons')
        .mockResolvedValue([]);
      const stripeCreateInvoiceItemsMock = jest
        .spyOn(Stripe.prototype.invoiceItems, 'create')
        .mockResolvedValue({} as any);
      const stripeCreateInvoiceMock = jest
        .spyOn(Stripe.prototype.invoices, 'create')
        .mockResolvedValue({ id: 'inv_test123' } as any);
      const stripeFinalizeInvoiceMock = jest
        .spyOn(Stripe.prototype.invoices, 'finalizeInvoice')
        .mockResolvedValue({} as any);

      const result = await stripeSubscriptionService.createSubscription();

      expect(result).toBeDefined();
      expect(getCartExpandedMock).toHaveBeenCalled();
      expect(getCustomerMock).toHaveBeenCalled();
      expect(getPaymentMock).toHaveBeenCalled();
      expect(getPriceIdMock).toHaveBeenCalled();
      expect(stripeCreateSubscriptionMock).toHaveBeenCalled();
      expect(saveSubscriptionIdMock).toHaveBeenCalled();
      expect(handleCtPaymentCreationMock).toHaveBeenCalled();
      expect(getStripeCouponsMock).toHaveBeenCalled();
      
      // Verify that one-time items invoice was created
      expect(stripeCreateInvoiceItemsMock).toHaveBeenCalledTimes(2); // Called for each regular item
      expect(stripeCreateInvoiceMock).toHaveBeenCalledTimes(1);
      expect(stripeFinalizeInvoiceMock).toHaveBeenCalledTimes(1);
      
      // Verify that the subscription was created with only subscription and shipping items
      const subscriptionCall = stripeCreateSubscriptionMock.mock.calls[0][0];
      expect(subscriptionCall.items).toBeDefined();
      expect(subscriptionCall.items!).toHaveLength(2); // subscription + shipping only
      expect(subscriptionCall.items![0].price).toBe(stripePriceIdMock); // subscription item
      expect(subscriptionCall.items![0].quantity).toBe(1); // subscription quantity
      
      // Verify that one-time items invoice creation was called
      expect(stripeCreatePriceMock).toHaveBeenCalledTimes(3); // Called for 2 regular items + 1 shipping
      expect(stripeSearchProductsMock).toHaveBeenCalledTimes(3);
      expect(stripeSearchPricesMock).toHaveBeenCalledTimes(3);
    });

    test('should create subscription without one-time items invoice when no regular items', async () => {
      setupMockConfig({
        stripeCollectBillingAddress: 'auto',
        merchantReturnUrl: '',
      });
      const mockCartWithOnlySubscription = {
        ...mockGetCartResult(),
        lineItems: [
          { ...lineItemSubscription, variant: getVariant(1), quantity: 1, id: 'subscription-item-1' }, // Only subscription item
        ]
      };
      
      const getCartExpandedMock = jest.spyOn(CartClient, 'getCartExpanded').mockResolvedValue(mockCartWithOnlySubscription);
      const getCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'getCtCustomer')
        .mockResolvedValue(mockCtCustomerData);
      const getPaymentMock = jest
        .spyOn(DefaultCartService.prototype, 'getPaymentAmount')
        .mockResolvedValue(mockGetPaymentAmount);
      const getPriceIdMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'getSubscriptionPriceId')
        .mockResolvedValue(stripePriceIdMock);
      const getShippingPriceIdMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'getSubscriptionShippingPriceId')
        .mockResolvedValue(undefined);
      const stripeCreateSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'create')
        .mockResolvedValue(subscriptionResponseMock);
      const saveSubscriptionIdMock = jest
        .spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId')
        .mockResolvedValue();
      const handleCtPaymentCreationMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation')
        .mockResolvedValue('payment-reference');
      const getStripeCouponsMock = jest
        .spyOn(StripeCouponService.prototype, 'getStripeCoupons')
        .mockResolvedValue([]);
      const stripeCreateInvoiceItemsMock = jest
        .spyOn(Stripe.prototype.invoiceItems, 'create')
        .mockResolvedValue({} as any);
      const stripeCreateInvoiceMock = jest
        .spyOn(Stripe.prototype.invoices, 'create')
        .mockResolvedValue({ id: 'inv_test123' } as any);
      const stripeFinalizeInvoiceMock = jest
        .spyOn(Stripe.prototype.invoices, 'finalizeInvoice')
        .mockResolvedValue({} as any);

      const result = await stripeSubscriptionService.createSubscription();

      expect(result).toBeDefined();
      expect(getCartExpandedMock).toHaveBeenCalled();
      expect(getCustomerMock).toHaveBeenCalled();
      expect(getPaymentMock).toHaveBeenCalled();
      expect(getPriceIdMock).toHaveBeenCalled();
      expect(stripeCreateSubscriptionMock).toHaveBeenCalled();
      expect(saveSubscriptionIdMock).toHaveBeenCalled();
      expect(handleCtPaymentCreationMock).toHaveBeenCalled();
      expect(getStripeCouponsMock).toHaveBeenCalled();
      
      // Verify that one-time items invoice was NOT created (no regular items)
      expect(stripeCreateInvoiceItemsMock).toHaveBeenCalledTimes(0);
      expect(stripeCreateInvoiceMock).toHaveBeenCalledTimes(0);
      expect(stripeFinalizeInvoiceMock).toHaveBeenCalledTimes(0);
      
      // Verify that the subscription was created with only subscription item
      const subscriptionCall = stripeCreateSubscriptionMock.mock.calls[0][0];
      expect(subscriptionCall.items).toBeDefined();
      expect(subscriptionCall.items!).toHaveLength(1); // subscription only
      expect(subscriptionCall.items![0].price).toBe(stripePriceIdMock); // subscription item
      expect(subscriptionCall.items![0].quantity).toBe(1); // subscription quantity
    });

    test('should get all line item prices excluding subscription items', async () => {
      const mockCartWithMixedItems = {
        ...mockGetCartResult(),
        lineItems: [
          { ...lineItem, id: 'regular-item-1', quantity: 2 }, // Regular item first
          { ...lineItemSubscription, variant: getVariant(1), quantity: 1, id: 'subscription-item-1' }, // Subscription item second
          { ...lineItem, id: 'regular-item-2', quantity: 3 } // Another regular item
        ]
      };
      
      const stripeSearchProductsMock = jest
        .spyOn(Stripe.prototype.products, 'search')
        .mockResolvedValue(stripeProductEmptyResponseMock);
      const stripeCreateProductMock = jest
        .spyOn(Stripe.prototype.products, 'create')
        .mockResolvedValue(stripeProductDataMock);
      const stripeSearchPricesMock = jest
        .spyOn(Stripe.prototype.prices, 'search')
        .mockResolvedValue(stripePriceEmptyResponseMock);
      const stripeCreatePriceMock = jest
        .spyOn(Stripe.prototype.prices, 'create')
        .mockResolvedValue(stripePriceDataMock);

      // Use reflection to access private method for testing
      const getAllLineItemPrices = (stripeSubscriptionService as any).getAllLineItemPrices.bind(stripeSubscriptionService);
      const result = await getAllLineItemPrices(mockCartWithMixedItems);

      expect(result).toHaveLength(2); // Only regular items, not subscription
      expect(result[0].quantity).toBe(2); // First regular item quantity
      expect(result[1].quantity).toBe(3); // Second regular item quantity
      expect(stripeSearchProductsMock).toHaveBeenCalledTimes(2); // Called for each regular item
      expect(stripeCreateProductMock).toHaveBeenCalledTimes(2);
      expect(stripeSearchPricesMock).toHaveBeenCalledTimes(2);
      expect(stripeCreatePriceMock).toHaveBeenCalledTimes(2);
    });

    test('should allow cart with quantity greater than 1', async () => {
      setupMockConfig({
        stripeCollectBillingAddress: 'auto',
        merchantReturnUrl: '',
      });
      const mockCartWithQuantity = {
        ...mockGetSubscriptionCartWithVariant(1),
        lineItems: [{ ...mockGetSubscriptionCartWithVariant(1).lineItems[0], quantity: 3 }]
      };
      const getCartExpandedMock = jest.spyOn(CartClient, 'getCartExpanded').mockResolvedValue(mockCartWithQuantity);
      const getCustomerMock = jest
        .spyOn(StripeCustomerService.prototype, 'getCtCustomer')
        .mockResolvedValue(mockCtCustomerData);
      
      const result = await stripeSubscriptionService.prepareSubscriptionData({ basicData: true });

      expect(result).toBeDefined();
      expect(getCartExpandedMock).toHaveBeenCalled();
      expect(getCustomerMock).toHaveBeenCalled();
      expect(result.cart).toStrictEqual(mockCartWithQuantity);
      expect(result.stripeCustomerId).toStrictEqual(mockStripeCustomerId);
      expect(result.subscriptionParams).toBeDefined();
      expect(result.merchantReturnUrl).toBeDefined();
      expect(result.billingAddress).toBeUndefined();
    });

    test('should throw error when no subscription product found in cart', async () => {
      const mockCartWithNoSubscription = {
        ...mockGetCartResult(),
        lineItems: [
          { ...lineItem, id: 'regular-item-1', quantity: 1 },
          { ...lineItem, id: 'regular-item-2', quantity: 1 }
        ]
      };
      const getCartExpandedMock = jest.spyOn(CartClient, 'getCartExpanded').mockResolvedValue(mockCartWithNoSubscription);
      
      const result = stripeSubscriptionService.prepareSubscriptionData({ basicData: true });
      expect(getCartExpandedMock).toHaveBeenCalled();
      expect(result).rejects.toThrow('No subscription product found in cart.');
    });
  });

  describe('method validateSubscription', () => {
    test('should throw error subscription has no invoice', async () => {
      expect(() => stripeSubscriptionService.validateSubscription(subscriptionWithoutPaymentResponseMock)).toThrow(
        new Error('Failed to create Subscription, missing Payment Intent.'),
      );
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
      expect(Logger.log.info).toHaveBeenCalled();
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

      const result = await stripeSubscriptionService.getSubscriptionPriceId(mockGetSubscriptionCartWithVariant(1), mockGetPaymentAmount);
      expect(result).toStrictEqual(stripePriceIdMock);
      expect(Logger.log.info).toHaveBeenCalled();
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

      const result = await stripeSubscriptionService.getSubscriptionPriceId(mockGetSubscriptionCartWithVariant(1), mockGetPaymentAmount);
      expect(result).toStrictEqual(stripePriceIdMock);
      expect(Logger.log.info).toHaveBeenCalled();
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
      expect(Logger.log.warn).toHaveBeenCalled();
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
      expect(Logger.log.warn).toHaveBeenCalled();
      expect(stripeUpdatePriceMock).toHaveBeenCalled();
    });
  });

  describe('method getStripeProduct', () => {
    test('should get the existing stripe product ID', async () => {
      const productMock = lineItem;
      const stripeSearchProducts = jest
        .spyOn(Stripe.prototype.products, 'search')
        .mockResolvedValue(stripeProductResponseMock);

      const result = await stripeSubscriptionService.getStripeProduct({ product: productMock });
      expect(result).toStrictEqual(stripeProductIdMock);
      expect(Logger.log.info).toHaveBeenCalled();
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

      const result = await stripeSubscriptionService.getStripeProduct({ product: productMock });
      expect(result).toStrictEqual(stripeProductIdMock);
      expect(Logger.log.info).toHaveBeenCalled();
      expect(stripeSearchProducts).toHaveBeenCalled();
      expect(createStripeProductMock).toHaveBeenCalled();
    });
  });

  describe('method createStripeProduct', () => {
    test('should create a new stripe product', async () => {
      const stripeCreateProductMock = jest
        .spyOn(Stripe.prototype.products, 'create')
        .mockResolvedValue(stripeProductDataMock);

      const result = await stripeSubscriptionService.createStripeProduct({ product: lineItem });
      expect(result).toStrictEqual(stripeProductIdMock);
      expect(Logger.log.info).toHaveBeenCalled();
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
      expect(Logger.log.info).toHaveBeenCalled();
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
      expect(result).rejects.toThrow(new Error('Failed to create Setup Intent.'));
      expect(stripeCreatePriceMock).toHaveBeenCalled();
    });
  });

  describe('method saveSubscriptionId', () => {
    test('should save subscription ID successfully', async () => {
      const getCustomFieldUpdateActionsMock = jest
        .spyOn(CustomTypeHelper, 'getCustomFieldUpdateActions')
        .mockResolvedValue(mock_SetLineItemCustomFieldActions);
      const updateCartByIdMock = jest.spyOn(CartClient, 'updateCartById').mockResolvedValue(mockGetCartResult());

      const result = await stripeSubscriptionService.saveSubscriptionId(mockGetSubscriptionCartWithVariant(1), 'stripeSubscriptionId');
      expect(result).toBeUndefined();
      expect(Logger.log.info).toHaveBeenCalled();
      expect(getCustomFieldUpdateActionsMock).toHaveBeenCalled();
      expect(updateCartByIdMock).toHaveBeenCalled();
    });
  });

  describe('method confirmSubscriptionPayment', () => {
    test('should confirm subscription payment successfully', async () => {
      const getCartExpandedMock = jest
        .spyOn(CartClient, 'getCartExpanded')
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

      const result = await stripeSubscriptionService.confirmSubscriptionPayment({
        paymentReference: 'paymentReference',
        subscriptionId: 'subscriptionId',
        paymentIntentId: 'paymentIntentId',
      });

      expect(result).toBeUndefined();
      expect(getCartExpandedMock).toHaveBeenCalled();
      expect(getInvoiceFromSubscriptionMock).toHaveBeenCalled();
      expect(getCurrentPaymentMock).toHaveBeenCalled();
      expect(updateSubscriptionPaymentTransactionsMock).toHaveBeenCalled();
    });

    test('should confirm subscription payment with subscription ID successfully', async () => {
      const getCartExpandedMock = jest
        .spyOn(CartClient, 'getCartExpanded')
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

      const result = await stripeSubscriptionService.confirmSubscriptionPayment({
        paymentReference: 'paymentReference',
        subscriptionId: 'subscriptionId',
      });

      expect(result).toBeUndefined();
      expect(getCartExpandedMock).toHaveBeenCalled();
      expect(getInvoiceFromSubscriptionMock).toHaveBeenCalled();
      expect(getCurrentPaymentMock).toHaveBeenCalled();
      expect(updateSubscriptionPaymentTransactionsMock).toHaveBeenCalled();
    });

    test('should confirm subscription payment successfully without invoice', async () => {
      const getCartExpandedMock = jest
        .spyOn(CartClient, 'getCartExpanded')
        .mockResolvedValue(mockGetSubscriptionCartWithVariant(6));
      const getCurrentPaymentMock = jest
        .spyOn(DefaultPaymentService.prototype, 'getPayment')
        .mockResolvedValue(mockGetPaymentResult);
      const updateSubscriptionPaymentTransactionsMock = jest
        .spyOn(CtPaymentCreationService.prototype, 'updateSubscriptionPaymentTransactions')
        .mockResolvedValue();

      const result = await stripeSubscriptionService.confirmSubscriptionPayment({
        paymentReference: 'paymentReference',
        subscriptionId: 'subscriptionId',
      });

      expect(result).toBeUndefined();
      expect(getCartExpandedMock).toHaveBeenCalled();
      expect(getCurrentPaymentMock).toHaveBeenCalled();
      expect(updateSubscriptionPaymentTransactionsMock).toHaveBeenCalled();
    });

    test('should fail to confirm subscription payment', async () => {
      const error = new Error('Failed to get cart');
      const getCartExpandedMock = jest.spyOn(CartClient, 'getCartExpanded').mockReturnValue(Promise.reject(error));
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
      expect(getCartExpandedMock).toHaveBeenCalled();
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

    test('should get payment mode as subscription when subscription is not first item', () => {
      const mockCartWithSubscriptionNotFirst = {
        ...mockGetCartResult(),
        lineItems: [
          { ...lineItem, id: 'regular-item-1', quantity: 1 }, // Regular item first
          { ...lineItemSubscription, variant: getVariant(1), quantity: 2, id: 'subscription-item-1' }, // Subscription item second
        ]
      };
      const result = stripeSubscriptionService.getPaymentMode(mockCartWithSubscriptionNotFirst);
      expect(result).toStrictEqual('subscription');
    });
  });

  describe('method getSubscriptionPaymentAmount', () => {
    test('should get subscription payment amount successfully', () => {
      const result = stripeSubscriptionService.getSubscriptionPaymentAmount(mockGetSubscriptionCartWithVariant(6));
      const expectedAmount = {
        ...mockGetPaymentAmount,
        totalCentAmount: mockGetPaymentAmount.centAmount
      };
      expect(result).toStrictEqual(expectedAmount);
    });

    test('should calculate total amount including quantity', () => {
      const mockCartWithQuantity = {
        ...mockGetSubscriptionCartWithVariant(6),
        lineItems: [{ ...mockGetSubscriptionCartWithVariant(6).lineItems[0], quantity: 3 }]
      };
      const result = stripeSubscriptionService.getSubscriptionPaymentAmount(mockCartWithQuantity);
      const expectedAmount = {
        ...mockGetPaymentAmount,
        totalCentAmount: mockGetPaymentAmount.centAmount * 3
      };
      expect(result).toStrictEqual(expectedAmount);
    });

    test('should throw an error when no subscription found', () => {
      expect(() => stripeSubscriptionService.getSubscriptionPaymentAmount(mockGetCartResult())).toThrow(
        'No subscription product found in cart.',
      );
    });

    test('should work with subscription not in first position', () => {
      const mockCartWithSubscriptionNotFirst = {
        ...mockGetCartResult(),
        lineItems: [
          { ...lineItem, id: 'regular-item-1', quantity: 1 }, // Regular item first
          { ...lineItemSubscription, variant: getVariant(6), quantity: 2, id: 'subscription-item-1' }, // Subscription item second
        ]
      };
      const result = stripeSubscriptionService.getSubscriptionPaymentAmount(mockCartWithSubscriptionNotFirst);
      const expectedAmount = {
        ...mockGetPaymentAmount,
        totalCentAmount: mockGetPaymentAmount.centAmount * 2
      };
      expect(result).toStrictEqual(expectedAmount);
    });
  });

  describe('method getSubscriptionShippingPriceId', () => {
    test('should get existing shipping price ID successfully', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);
      const stripeSearchProductsMock = jest
        .spyOn(Stripe.prototype.products, 'search')
        .mockResolvedValue(stripeProductResponseMock);
      const stripeSearchPricesMock = jest
        .spyOn(Stripe.prototype.prices, 'search')
        .mockResolvedValue(stripePriceResponseMock);

      const result = await stripeSubscriptionService.getSubscriptionShippingPriceId(mockCart);
      
      expect(result).toStrictEqual(stripePriceIdMock);
      expect(stripeSearchProductsMock).toHaveBeenCalled();
      expect(stripeSearchPricesMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalled();
    });

    test('should create new shipping price when no existing price found', async () => {
      const mockCart = mockGetSubscriptionCartWithVariant(1);
      const stripeSearchProductsMock = jest
        .spyOn(Stripe.prototype.products, 'search')
        .mockResolvedValue(stripeProductEmptyResponseMock);
      const stripeCreateProductMock = jest
        .spyOn(Stripe.prototype.products, 'create')
        .mockResolvedValue(stripeProductDataMock);
      const stripeSearchPricesMock = jest
        .spyOn(Stripe.prototype.prices, 'search')
        .mockResolvedValue(stripePriceEmptyResponseMock);
      const stripeCreatePriceMock = jest
        .spyOn(Stripe.prototype.prices, 'create')
        .mockResolvedValue(stripePriceDataMock);

      const result = await stripeSubscriptionService.getSubscriptionShippingPriceId(mockCart);
      
      expect(result).toStrictEqual(stripePriceIdMock);
      expect(stripeSearchProductsMock).toHaveBeenCalled();
      expect(stripeCreateProductMock).toHaveBeenCalled();
      expect(stripeSearchPricesMock).toHaveBeenCalled();
      expect(stripeCreatePriceMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalled();
    });

    test('should return undefined when no shipping info in cart', async () => {
      const mockCart = { ...mockGetSubscriptionCartWithVariant(1), shippingInfo: undefined };

      const result = await stripeSubscriptionService.getSubscriptionShippingPriceId(mockCart);
      
      expect(result).toBeUndefined();
      expect(Logger.log.info).toHaveBeenCalledWith('No shipping method found in cart.');
    });
  });

  describe('method getStripePriceByMetadata', () => {
    test('should search stripe prices by metadata successfully', async () => {
      const stripeSearchPricesMock = jest
        .spyOn(Stripe.prototype.prices, 'search')
        .mockResolvedValue(stripePriceResponseMock);

      const result = await stripeSubscriptionService.getStripePriceByMetadata(lineItem);
      
      expect(result).toStrictEqual(stripePriceResponseMock);
      expect(stripeSearchPricesMock).toHaveBeenCalled();
    });
  });

  describe('method getStripeShippingPriceByMetadata', () => {
    test('should search stripe shipping prices by metadata successfully', async () => {
      const stripeSearchPricesMock = jest
        .spyOn(Stripe.prototype.prices, 'search')
        .mockResolvedValue(stripePriceResponseMock);

      const result = await stripeSubscriptionService.getStripeShippingPriceByMetadata(shippingInfo);
      
      expect(result).toStrictEqual(stripePriceResponseMock);
      expect(stripeSearchPricesMock).toHaveBeenCalled();
    });
  });

  describe('method createStripeShippingPrice', () => {
    test('should create stripe shipping price successfully', async () => {
      const stripeCreatePriceMock = jest
        .spyOn(Stripe.prototype.prices, 'create')
        .mockResolvedValue(stripePriceDataMock);

      const result = await stripeSubscriptionService.createStripeShippingPrice({
        shipping: shippingInfo,
        stripeProductId: stripeProductIdMock,
        attributes: mockSubscriptionAttributes,
      });
      
      expect(result).toStrictEqual(stripePriceIdMock);
      expect(stripeCreatePriceMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalled();
    });
  });

  describe('method getSubscriptionTypes', () => {
    test('should get subscription types successfully', () => {
      const attributes = {
        collection_method: 'charge_automatically',
        trial_period_days: 7,
      } as Stripe.SubscriptionCreateParams;

      const result = stripeSubscriptionService.getSubscriptionTypes(attributes);
      
      expect(result).toBeDefined();
      expect(result.hasFreeAnchorDays).toBeDefined();
      expect(result.isSendInvoice).toBeDefined();
    });
  });

  describe('method getCustomerSubscriptions', () => {
    test('should get customer subscriptions successfully', async () => {
      const customerId = 'customer_123';
      const mockSubscriptions = [subscriptionResponseMock];
      const getCustomerByIdMock = jest
        .spyOn(CustomerClient, 'getCustomerById')
        .mockResolvedValue({
          ...mockCtCustomerData,
          custom: {
            type: { typeId: 'type', id: 'mock-type-id' },
            fields: {
              stripeConnector_stripeCustomerId: 'cus_123',
            },
          },
        });
      const stripeListSubscriptionsMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'list')
        .mockResolvedValue({
          data: mockSubscriptions,
          has_more: false,
          object: 'list',
          url: '',
          lastResponse: {
            headers: {},
            requestId: 'req_123',
            statusCode: 200,
          },
        } as Stripe.Response<Stripe.ApiList<Stripe.Subscription>>);

      const result = await stripeSubscriptionService.getCustomerSubscriptions(customerId);
      
      expect(result).toStrictEqual(mockSubscriptions);
      expect(getCustomerByIdMock).toHaveBeenCalledWith(customerId);
      expect(stripeListSubscriptionsMock).toHaveBeenCalled();
    });
  });

  describe('method cancelSubscription', () => {
    test('should cancel subscription successfully', async () => {
      const customerId = 'customer_123';
      const subscriptionId = 'sub_mock_id';
      const getCustomerByIdMock = jest
        .spyOn(CustomerClient, 'getCustomerById')
        .mockResolvedValue({
          ...mockCtCustomerData,
          custom: {
            type: { typeId: 'type', id: 'mock-type-id' },
            fields: {
              stripeConnector_stripeCustomerId: 'cus_123',
            },
          },
        });
      const stripeListSubscriptionsMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'list')
        .mockResolvedValue({
          data: [subscriptionResponseMock],
          has_more: false,
          object: 'list',
          url: '',
          lastResponse: {
            headers: {},
            requestId: 'req_123',
            statusCode: 200,
          },
        } as Stripe.Response<Stripe.ApiList<Stripe.Subscription>>);
      const stripeCancelSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'cancel')
        .mockResolvedValue({
          ...subscriptionResponseMock,
          status: 'canceled',
        });

      const result = await stripeSubscriptionService.cancelSubscription({ customerId, subscriptionId });
      
      expect(result.id).toStrictEqual('sub_mock_id');
      expect(result.status).toStrictEqual('canceled');
      expect(result.outcome).toStrictEqual(SubscriptionOutcome.CANCELED);
      expect(getCustomerByIdMock).toHaveBeenCalledWith(customerId);
      expect(stripeCancelSubscriptionMock).toHaveBeenCalled();
    });

    test('should fail to cancel subscription', async () => {
      const customerId = 'customer_123';
      const subscriptionId = 'sub_mock_id';
      const getCustomerByIdMock = jest
        .spyOn(CustomerClient, 'getCustomerById')
        .mockResolvedValue({
          ...mockCtCustomerData,
          custom: {
            type: { typeId: 'type', id: 'mock-type-id' },
            fields: {
              stripeConnector_stripeCustomerId: 'cus_123',
            },
          },
        });
      const stripeListSubscriptionsMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'list')
        .mockResolvedValue({
          data: [subscriptionResponseMock],
          has_more: false,
          object: 'list',
          url: '',
          lastResponse: {
            headers: {},
            requestId: 'req_123',
            statusCode: 200,
          },
        } as Stripe.Response<Stripe.ApiList<Stripe.Subscription>>);
      const error = new Error('Failed to cancel subscription');
      const stripeCancelSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'cancel')
        .mockRejectedValue(error);

      try {
        await stripeSubscriptionService.cancelSubscription({ customerId, subscriptionId });
      } catch (error) {
        expect(error).toBeDefined();
      }
      expect(getCustomerByIdMock).toHaveBeenCalledWith(customerId);
      expect(stripeCancelSubscriptionMock).toHaveBeenCalled();
    });
  });

  describe('method updateSubscription', () => {
    test('should update subscription successfully', async () => {
      const customerId = 'customer_123';
      const subscriptionId = 'sub_mock_id';
      const params = { cancel_at_period_end: true };
      const mockUpdatedSubscription = {
        ...subscriptionResponseMock,
        cancel_at_period_end: true,
      };
      const getCustomerByIdMock = jest
        .spyOn(CustomerClient, 'getCustomerById')
        .mockResolvedValue({
          ...mockCtCustomerData,
          custom: {
            type: { typeId: 'type', id: 'mock-type-id' },
            fields: {
              stripeConnector_stripeCustomerId: 'cus_123',
            },
          },
        });
      const stripeListSubscriptionsMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'list')
        .mockResolvedValue({
          data: [subscriptionResponseMock],
          has_more: false,
          object: 'list',
          url: '',
          lastResponse: {
            headers: {},
            requestId: 'req_123',
            statusCode: 200,
          },
        } as Stripe.Response<Stripe.ApiList<Stripe.Subscription>>);
      const stripeUpdateSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'update')
        .mockResolvedValue(mockUpdatedSubscription);

      const result = await stripeSubscriptionService.updateSubscription({
        customerId,
        subscriptionId,
        params,
      });
      
      expect(result).toStrictEqual(mockUpdatedSubscription);
      expect(getCustomerByIdMock).toHaveBeenCalledWith(customerId);
      expect(stripeUpdateSubscriptionMock).toHaveBeenCalled();
    });

    test('should fail to update subscription', async () => {
      const customerId = 'customer_123';
      const subscriptionId = 'sub_mock_id';
      const params = { cancel_at_period_end: true };
      const getCustomerByIdMock = jest
        .spyOn(CustomerClient, 'getCustomerById')
        .mockResolvedValue({
          ...mockCtCustomerData,
          custom: {
            type: { typeId: 'type', id: 'mock-type-id' },
            fields: {
              stripeConnector_stripeCustomerId: 'cus_123',
            },
          },
        });
      const stripeListSubscriptionsMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'list')
        .mockResolvedValue({
          data: [subscriptionResponseMock],
          has_more: false,
          object: 'list',
          url: '',
          lastResponse: {
            headers: {},
            requestId: 'req_123',
            statusCode: 200,
          },
        } as Stripe.Response<Stripe.ApiList<Stripe.Subscription>>);
      const error = new Error('Failed to update subscription');
      const stripeUpdateSubscriptionMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'update')
        .mockRejectedValue(error);

      try {
        await stripeSubscriptionService.updateSubscription({
          customerId,
          subscriptionId,
          params,
        });
      } catch (error) {
        expect(error).toBeDefined();
      }
      expect(getCustomerByIdMock).toHaveBeenCalledWith(customerId);
      expect(stripeUpdateSubscriptionMock).toHaveBeenCalled();
    });
  });

  describe('method validateCustomerSubscription', () => {
    test('should validate customer subscription successfully', async () => {
      const customerId = 'customer_123';
      const subscriptionId = 'sub_mock_id';
      const getCustomerByIdMock = jest
        .spyOn(CustomerClient, 'getCustomerById')
        .mockResolvedValue({
          ...mockCtCustomerData,
          custom: {
            type: { typeId: 'type', id: 'mock-type-id' },
            fields: {
              stripeConnector_stripeCustomerId: 'cus_123',
            },
          },
        });
      const stripeListSubscriptionsMock = jest
        .spyOn(Stripe.prototype.subscriptions, 'list')
        .mockResolvedValue({
          data: [subscriptionResponseMock],
          has_more: false,
          object: 'list',
          url: '',
          lastResponse: {
            headers: {},
            requestId: 'req_123',
            statusCode: 200,
          },
        } as Stripe.Response<Stripe.ApiList<Stripe.Subscription>>);

      await stripeSubscriptionService.validateCustomerSubscription(customerId, subscriptionId);
      
      expect(getCustomerByIdMock).toHaveBeenCalledWith(customerId);
      expect(stripeListSubscriptionsMock).toHaveBeenCalled();
    });
  });

  describe('method processSubscriptionEvent', () => {
    test('should process subscription event successfully', async () => {
      const mockEvent = {
        id: 'evt_123',
        object: 'event',
        api_version: '2020-08-27',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: subscriptionResponseMock,
        },
        livemode: false,
        pending_webhooks: 0,
        request: null,
        type: 'customer.subscription.created',
      } as Stripe.Event;

      await stripeSubscriptionService.processSubscriptionEvent(mockEvent);
      
      // Basic test to ensure method doesn't throw
      expect(true).toBe(true);
    });
  });

  describe('Stripe Subscription Routes', () => {
    describe('DELETE /subscription-api/:customerId/:subscriptionId', () => {
      test('it should cancel subscription successfully', async () => {
        // Given
        const customerId = 'customer_123';
        const subscriptionId = 'sub_123';
        const mockResult = {
          id: subscriptionId,
          status: 'canceled',
          outcome: SubscriptionOutcome.CANCELED,
          message: 'Subscription canceled successfully',
        };

        jest.spyOn(spiedSubscriptionService, 'cancelSubscription').mockResolvedValue(mockResult);

        // When
        const response = await fastifyApp.inject({
          method: 'DELETE',
          url: `/subscription-api/${customerId}/${subscriptionId}`,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: {},
        });

        // Then
        expect(response.statusCode).toEqual(200);
        expect(response.json()).toEqual(mockResult);
        expect(spiedSubscriptionService.cancelSubscription).toHaveBeenCalledWith({ customerId, subscriptionId });
      });

      test('it should return error on cancellation failure', async () => {
        // Given
        const customerId = 'customer_123';
        const subscriptionId = 'sub_123';

        jest.spyOn(spiedSubscriptionService, 'cancelSubscription').mockRejectedValue(new Error('Failed to cancel'));

        // When
        const response = await fastifyApp.inject({
          method: 'DELETE',
          url: `/subscription-api/${customerId}/${subscriptionId}`,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: {},
        });

        // Then
        expect(response.statusCode).toEqual(400);
        expect(response.json().id).toEqual(subscriptionId);
        expect(response.json().status).toEqual('failed');
        expect(response.json().outcome).toEqual('error');
        expect(response.json().message).toEqual('Failed to cancel');
      });
    });

    describe('POST /subscription-api/:customerId', () => {
      test('it should update subscription successfully', async () => {
        // Given
        const customerId = 'customer_123';
        const subscriptionId = 'sub_123';
        const updateParams = {
          cancel_at_period_end: true,
        };

        const mockResult = {
          id: subscriptionId,
          status: 'active',
          object: 'subscription',
          application: null,
          application_fee_percent: null,
          automatic_tax: {
            disabled_reason: null,
            liability: null,
            enabled: false,
          },
          billing_cycle_anchor: 123456789,
          billing_cycle_anchor_config: null,
          billing_thresholds: null,
          cancel_at: null,
          cancel_at_period_end: false,
          canceled_at: null,
          cancellation_details: null,
          collection_method: 'charge_automatically',
          created: 123456789,
          currency: 'usd',
          current_period_end: 123456789,
          current_period_start: 123456789,
          customer: 'cus_123',
          days_until_due: null,
          default_payment_method: null,
          default_source: null,
          default_tax_rates: [],
          description: null,
          discount: null,
          ended_at: null,
          items: { object: 'list', data: [], has_more: false, url: '' },
          latest_invoice: null,
          livemode: false,
          metadata: {},
          next_pending_invoice_item_invoice: null,
          pause_collection: null,
          pending_invoice_item_interval: null,
          pending_setup_intent: null,
          pending_update: null,
          plan: null,
          quantity: null,
          schedule: null,
          start_date: 123456789,
          test_clock: null,
          transfer_data: null,
          trial_end: null,
          trial_start: null,
          discounts: [],
          invoice_settings: {
            account_tax_ids: null,
            issuer: null,
          },
          on_behalf_of: null,
          payment_settings: null,
          trial_settings: null,
        } as unknown as Stripe.Subscription;

        jest.spyOn(spiedSubscriptionService, 'updateSubscription').mockResolvedValue(mockResult);

        // When
        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription-api/${customerId}`,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          payload: {
            id: subscriptionId,
            params: updateParams,
          },
        });

        // Then
        expect(response.statusCode).toEqual(200);
        expect(response.json().id).toEqual(subscriptionId);
        expect(response.json().outcome).toEqual('updated');
        expect(spiedSubscriptionService.updateSubscription).toHaveBeenCalledWith({
          customerId,
          subscriptionId,
          params: updateParams,
          options: undefined,
        });
      });

      test('it should return error on update failure', async () => {
        // Given
        const customerId = 'customer_123';
        const subscriptionId = 'sub_123';

        jest.spyOn(spiedSubscriptionService, 'updateSubscription').mockRejectedValue(new Error('Failed to update'));

        // When
        const response = await fastifyApp.inject({
          method: 'POST',
          url: `/subscription-api/${customerId}`,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          payload: {
            id: subscriptionId,
            params: {},
          },
        });

        // Then
        expect(response.statusCode).toEqual(400);
        expect(response.json().id).toEqual(subscriptionId);
        expect(response.json().status).toEqual('failed');
        expect(response.json().outcome).toEqual('error');
        expect(response.json().message).toEqual('Failed to update');
      });
    });
  });
});
