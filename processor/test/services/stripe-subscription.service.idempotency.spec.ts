jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {}),
}));

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { StripeSubscriptionService } from '../../src/services/stripe-subscription.service';
import { CtPaymentCreationService } from '../../src/services/ct-payment-creation.service';
import { paymentSDK } from '../../src/payment-sdk';
import { mockGetSubscriptionCartWithVariant } from '../utils/mock-cart-data';
import { lineItemStripeSubscriptionIdField } from '../../src/custom-types/custom-types';
import Stripe from 'stripe';
import { Cart } from '@commercetools/connect-payments-sdk';
import { BasicSubscriptionData } from '../../src/services/types/stripe-subscription.type';
import * as Config from '../../src/config/config';

jest.mock('../../src/libs/logger', () => ({
  log: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../src/payment-sdk', () => ({
  paymentSDK: {
    ctCartService: {},
    ctPaymentService: {},
    ctOrderService: {},
    ctAPI: {
      carts: jest.fn(() => ({
        withId: jest.fn(() => ({
          get: jest.fn(() => Promise.resolve({ body: mockGetSubscriptionCartWithVariant(1) })),
        })),
      })),
    },
  },
}));

jest.mock('../../src/libs/logger');

jest.mock('../../src/services/commerce-tools/cart-client', () => ({
  getCartExpanded: jest.fn(() => Promise.resolve(mockGetSubscriptionCartWithVariant(1))),
  freezeCart: jest.fn(() => Promise.resolve()),
  updateCartById: jest.fn(() => Promise.resolve()),
}));

interface FlexibleConfig {
  [key: string]: string | number | boolean | Config.PaymentFeatures;
}

function setupMockConfig(keysAndValues: Record<string, string>) {
  const mockConfig: FlexibleConfig = {};
  Object.keys(keysAndValues).forEach((key) => {
    mockConfig[key] = keysAndValues[key];
  });

  jest.spyOn(Config, 'getConfig').mockReturnValue(mockConfig as ReturnType<typeof Config.getConfig>);
}

const baseConfig = {
  projectKey: 'test-project-key',
  stripeCollectBillingAddress: 'auto',
  stripeSecretKey: 'sk_test_123',
  subscriptionPaymentHandling: 'createOrder',
};

// Builds a prepareSubscriptionData result for a given cart + priceId.
function prepareDataFor(cart: Cart, priceId = 'price_123'): BasicSubscriptionData {
  return {
    cart,
    stripeCustomerId: 'cus_123',
    subscriptionParams: { customer: 'cus_123' },
    billingAddress: '123 Main St',
    merchantReturnUrl: 'http://example.com',
    lineItemAmount: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
    amountPlanned: { centAmount: 1000, currencyCode: 'USD', fractionDigits: 2 },
    priceId,
    shippingPriceId: undefined,
  } as unknown as BasicSubscriptionData;
}

// Attaches an existing Stripe subscription id to the subscription line item's custom fields.
function cartWithExistingSubscriptionId(subscriptionId: string): Cart {
  const cart = mockGetSubscriptionCartWithVariant(1);
  cart.lineItems = cart.lineItems.map((li) => ({
    ...li,
    custom: {
      type: { typeId: 'type', id: 'line-item-type-id' },
      fields: { [lineItemStripeSubscriptionIdField]: subscriptionId },
    },
  }));
  return cart;
}

describe('stripe-subscription.service idempotency (SB3-226)', () => {
  const opts = {
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
    ctOrderService: paymentSDK.ctOrderService,
  };
  const service = new StripeSubscriptionService(opts);

  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();

    Stripe.prototype.prices = {
      search: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    } as unknown as Stripe.PricesResource;
    Stripe.prototype.subscriptions = {
      create: jest.fn(),
      retrieve: jest.fn(),
      update: jest.fn(),
      list: jest.fn(),
      cancel: jest.fn(),
    } as unknown as Stripe.SubscriptionsResource;
    Stripe.prototype.setupIntents = {
      create: jest.fn(),
      retrieve: jest.fn(),
    } as unknown as Stripe.SetupIntentsResource;
    Stripe.prototype.invoices = {
      sendInvoice: jest.fn(),
    } as unknown as Stripe.InvoicesResource;
    Stripe.prototype.coupons = { list: jest.fn() } as unknown as Stripe.CouponsResource;

    setupMockConfig(baseConfig);

    jest.spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation').mockResolvedValue('payment_ref_123');
    jest.spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId').mockResolvedValue();
    // No one-time items — keep the create payload simple and avoid extra Stripe calls.
    jest.spyOn(StripeSubscriptionService.prototype, 'getAllLineItemPrices').mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createdSubscription = {
    id: 'sub_mock_id',
    status: 'active',
    latest_invoice: {
      id: 'in_123',
      confirmation_secret: {
        client_secret: 'pi_3MtwBwLkdIwHu7ix28a3tqPa_secret_YrKJUKribcBjcG8HVhfZluoGH',
        type: 'payment_intent',
      },
    },
  } as unknown as Stripe.Response<Stripe.Subscription>;

  describe('createSubscription — derived idempotency key', () => {
    test('two sequential calls with the SAME cart pass the SAME derived key to subscriptions.create', async () => {
      const cart = mockGetSubscriptionCartWithVariant(1); // stable id + version across both calls
      jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue(prepareDataFor(cart));
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue(createdSubscription);

      await service.createSubscription();
      await service.createSubscription();

      const expectedKey = `subscription-${cart.id}-${cart.version}`;
      expect(createSpy).toHaveBeenCalledTimes(2);
      expect((createSpy.mock.calls[0][1] as Stripe.RequestOptions).idempotencyKey).toBe(expectedKey);
      expect((createSpy.mock.calls[1][1] as Stripe.RequestOptions).idempotencyKey).toBe(expectedKey);
    });

    test('SB3-226 fix 2: the key stays the SAME for one cart id+version even if the resolved priceId differs', async () => {
      const cart = mockGetSubscriptionCartWithVariant(1);
      const prepareSpy = jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData');
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue(createdSubscription);

      // Same cart, but a retry resolves a brand-new Stripe Price (prices.create minted a fresh id).
      prepareSpy.mockResolvedValueOnce(prepareDataFor(cart, 'price_first'));
      await service.createSubscription();
      prepareSpy.mockResolvedValueOnce(prepareDataFor(cart, 'price_second_minted_on_retry'));
      await service.createSubscription();

      const expectedKey = `subscription-${cart.id}-${cart.version}`;
      expect((createSpy.mock.calls[0][1] as Stripe.RequestOptions).idempotencyKey).toBe(expectedKey);
      expect((createSpy.mock.calls[1][1] as Stripe.RequestOptions).idempotencyKey).toBe(expectedKey);
    });

    test('a genuinely different cart yields a DIFFERENT idempotency key', async () => {
      const cartA = mockGetSubscriptionCartWithVariant(1);
      const cartB = mockGetSubscriptionCartWithVariant(1); // different random id
      const prepareSpy = jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData');
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue(createdSubscription);

      prepareSpy.mockResolvedValueOnce(prepareDataFor(cartA));
      await service.createSubscription();
      prepareSpy.mockResolvedValueOnce(prepareDataFor(cartB));
      await service.createSubscription();

      const keyA = (createSpy.mock.calls[0][1] as Stripe.RequestOptions).idempotencyKey;
      const keyB = (createSpy.mock.calls[1][1] as Stripe.RequestOptions).idempotencyKey;
      expect(keyA).toBe(`subscription-${cartA.id}-${cartA.version}`);
      expect(keyB).toBe(`subscription-${cartB.id}-${cartB.version}`);
      expect(keyA).not.toBe(keyB);
    });
  });

  describe('createSubscription — pre-create guard', () => {
    test('when the line item already has a subscription id, subscriptions.create is NOT called and the existing sub is returned', async () => {
      const cart = cartWithExistingSubscriptionId('sub_existing');
      jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue(prepareDataFor(cart));
      const retrieveSpy = jest.spyOn(Stripe.prototype.subscriptions, 'retrieve').mockResolvedValue({
        id: 'sub_existing',
        status: 'incomplete',
        customer: 'cus_123',
        metadata: { ct_payment_id: 'pay_existing', cart_id: cart.id },
        latest_invoice: {
          id: 'in_existing',
          confirmation_secret: { client_secret: 'pi_existing_secret_abc', type: 'payment_intent' },
        },
      } as unknown as Stripe.Response<Stripe.Subscription>);
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create');

      const result = await service.createSubscription();

      expect(retrieveSpy).toHaveBeenCalledWith('sub_existing', { expand: ['latest_invoice.confirmation_secret'] });
      expect(createSpy).not.toHaveBeenCalled();
      expect(result.subscriptionId).toBe('sub_existing');
      expect(result.paymentReference).toBe('pay_existing');
    });

    test('a canceled existing subscription is treated as absent — create IS called with the derived key', async () => {
      const cart = cartWithExistingSubscriptionId('sub_canceled');
      jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue(prepareDataFor(cart));
      jest.spyOn(Stripe.prototype.subscriptions, 'retrieve').mockResolvedValue({
        id: 'sub_canceled',
        status: 'canceled',
        customer: 'cus_123',
        // metadata.cart_id matches so the cart-binding check passes and the test actually
        // reaches the canceled/incomplete_expired status branch (not the cart-binding short-circuit).
        metadata: { cart_id: cart.id },
      } as unknown as Stripe.Response<Stripe.Subscription>);
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue(createdSubscription);

      const result = await service.createSubscription();

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect((createSpy.mock.calls[0][1] as Stripe.RequestOptions).idempotencyKey).toBe(
        `subscription-${cart.id}-${cart.version}`,
      );
      expect(result.subscriptionId).toBe('sub_mock_id');
    });

    test('SB3-226 fix 1: an existing sub whose metadata.cart_id is a DIFFERENT cart (replicated/reorder) is ignored — create IS called even though the customer matches', async () => {
      const cart = cartWithExistingSubscriptionId('sub_from_original_cart');
      jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue(prepareDataFor(cart)); // cart customer = cus_123
      jest.spyOn(Stripe.prototype.subscriptions, 'retrieve').mockResolvedValue({
        id: 'sub_from_original_cart',
        status: 'active',
        customer: 'cus_123', // same customer (reorder keeps it)
        metadata: { ct_payment_id: 'pay_original', cart_id: 'a-different-original-cart-id' },
        latest_invoice: {
          id: 'in_original',
          confirmation_secret: { client_secret: 'pi_original_secret', type: 'payment_intent' },
        },
      } as unknown as Stripe.Response<Stripe.Subscription>);
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue(createdSubscription);

      const result = await service.createSubscription();

      // The replicated cart must NOT reconcile onto the old subscription; a fresh one is created.
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(result.subscriptionId).toBe('sub_mock_id');
    });

    test('SB3-226 fix 1: an existing sub whose metadata.cart_id matches this cart still reconciles (no create)', async () => {
      const cart = cartWithExistingSubscriptionId('sub_same_cart');
      jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue(prepareDataFor(cart));
      jest.spyOn(Stripe.prototype.subscriptions, 'retrieve').mockResolvedValue({
        id: 'sub_same_cart',
        status: 'active',
        customer: 'cus_123',
        metadata: { ct_payment_id: 'pay_same_cart', cart_id: cart.id },
        latest_invoice: { id: 'in_same_cart' },
      } as unknown as Stripe.Response<Stripe.Subscription>);
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create');

      const result = await service.createSubscription();

      expect(createSpy).not.toHaveBeenCalled();
      expect(result.subscriptionId).toBe('sub_same_cart');
      expect(result.paymentReference).toBe('pay_same_cart');
    });
  });

  describe('createSubscriptionFromSetupIntent — derived idempotency key + guard', () => {
    beforeEach(() => {
      jest.spyOn(Stripe.prototype.setupIntents, 'retrieve').mockResolvedValue({
        payment_method: 'pm_123',
      } as Stripe.Response<Stripe.SetupIntent>);
    });

    test('same cart + setup intent produces a deterministic key including the setup intent id', async () => {
      const cart = mockGetSubscriptionCartWithVariant(1);
      jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue(prepareDataFor(cart));
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue({
        id: 'sub_123',
        status: 'active',
        latest_invoice: { id: 'in_123' },
      } as unknown as Stripe.Response<Stripe.Subscription>);

      await service.createSubscriptionFromSetupIntent('setup_intent_123');
      await service.createSubscriptionFromSetupIntent('setup_intent_123');

      const expectedKey = `subscription-${cart.id}-${cart.version}-setup_intent_123`;
      expect((createSpy.mock.calls[0][1] as Stripe.RequestOptions).idempotencyKey).toBe(expectedKey);
      expect((createSpy.mock.calls[1][1] as Stripe.RequestOptions).idempotencyKey).toBe(expectedKey);
    });

    test('a different setup intent id yields a different key for the same cart', async () => {
      const cart = mockGetSubscriptionCartWithVariant(1);
      jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue(prepareDataFor(cart));
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue({
        id: 'sub_123',
        status: 'active',
        latest_invoice: { id: 'in_123' },
      } as unknown as Stripe.Response<Stripe.Subscription>);

      await service.createSubscriptionFromSetupIntent('seti_a');
      await service.createSubscriptionFromSetupIntent('seti_b');

      const keyA = (createSpy.mock.calls[0][1] as Stripe.RequestOptions).idempotencyKey;
      const keyB = (createSpy.mock.calls[1][1] as Stripe.RequestOptions).idempotencyKey;
      expect(keyA).toBe(`subscription-${cart.id}-${cart.version}-seti_a`);
      expect(keyB).toBe(`subscription-${cart.id}-${cart.version}-seti_b`);
      expect(keyA).not.toBe(keyB);
    });

    test('pre-create guard: existing subscription id short-circuits create and reconciles', async () => {
      const cart = cartWithExistingSubscriptionId('sub_existing_si');
      jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue(prepareDataFor(cart));
      const retrieveSpy = jest.spyOn(Stripe.prototype.subscriptions, 'retrieve').mockResolvedValue({
        id: 'sub_existing_si',
        status: 'active',
        customer: 'cus_123',
        metadata: { ct_payment_id: 'pay_existing_si', cart_id: cart.id },
        latest_invoice: { id: 'in_existing_si' },
      } as unknown as Stripe.Response<Stripe.Subscription>);
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create');

      const result = await service.createSubscriptionFromSetupIntent('setup_intent_123');

      expect(retrieveSpy).toHaveBeenCalledWith('sub_existing_si', { expand: ['latest_invoice'] });
      expect(createSpy).not.toHaveBeenCalled();
      expect(result.subscriptionId).toBe('sub_existing_si');
      expect(result.paymentReference).toBe('pay_existing_si');
    });
  });

  // SB3-226 validation hardening — five defects found in the reconcile branch.
  describe('reconcile-branch hardening', () => {
    test('defect 1 (IDOR): a subscription owned by a different Stripe customer is ignored, create IS called', async () => {
      const cart = cartWithExistingSubscriptionId('sub_victim');
      jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue(prepareDataFor(cart)); // cart customer = cus_123
      jest.spyOn(Stripe.prototype.subscriptions, 'retrieve').mockResolvedValue({
        id: 'sub_victim',
        status: 'active',
        customer: 'cus_ATTACKER_VICTIM', // belongs to someone else
        latest_invoice: {
          id: 'in_victim',
          confirmation_secret: { client_secret: 'pi_victim_secret_leak', type: 'payment_intent' },
        },
      } as unknown as Stripe.Response<Stripe.Subscription>);
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue(createdSubscription);

      const result = await service.createSubscription();

      // Victim's subscription must NOT be returned; a fresh one is created for the caller instead.
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(result.subscriptionId).toBe('sub_mock_id');
      expect(result.clientSecret).not.toBe('pi_victim_secret_leak');
    });

    test('defect 2: reconcile reuses the existing CT payment — handleCtPaymentCreation is NOT called again', async () => {
      const cart = cartWithExistingSubscriptionId('sub_existing');
      jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue(prepareDataFor(cart));
      jest.spyOn(Stripe.prototype.subscriptions, 'retrieve').mockResolvedValue({
        id: 'sub_existing',
        status: 'active',
        customer: 'cus_123',
        metadata: { ct_payment_id: 'pay_existing', cart_id: cart.id },
        latest_invoice: { id: 'in_existing' },
      } as unknown as Stripe.Response<Stripe.Subscription>);
      const createPaymentSpy = jest.spyOn(CtPaymentCreationService.prototype, 'handleCtPaymentCreation');
      jest.spyOn(Stripe.prototype.subscriptions, 'create');

      const result = await service.createSubscription();

      expect(createPaymentSpy).not.toHaveBeenCalled();
      expect(result.paymentReference).toBe('pay_existing');
    });

    test('defect 3: a transient retrieve error does NOT create a subscription and propagates', async () => {
      const cart = cartWithExistingSubscriptionId('sub_existing');
      jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue(prepareDataFor(cart));
      // 5xx / network-style error — not resource_missing.
      jest
        .spyOn(Stripe.prototype.subscriptions, 'retrieve')
        .mockRejectedValue(Object.assign(new Error('Stripe is down'), { statusCode: 500, type: 'api_error' }));
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue(createdSubscription);

      await expect(service.createSubscription()).rejects.toBeDefined();
      expect(createSpy).not.toHaveBeenCalled();
    });

    test('defect 3b: a resource_missing retrieve error DOES fall through to a fresh create', async () => {
      const cart = cartWithExistingSubscriptionId('sub_deleted');
      jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue(prepareDataFor(cart));
      jest
        .spyOn(Stripe.prototype.subscriptions, 'retrieve')
        .mockRejectedValue(
          Object.assign(new Error('No such subscription'), { code: 'resource_missing', statusCode: 404 }),
        );
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue(createdSubscription);

      const result = await service.createSubscription();

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(result.subscriptionId).toBe('sub_mock_id');
    });

    test('defect 4: reconcile in send_invoice mode does NOT call sendInvoice', async () => {
      const cart = cartWithExistingSubscriptionId('sub_existing_si');
      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        ...prepareDataFor(cart),
        subscriptionParams: { customer: 'cus_123', collection_method: 'send_invoice' },
      } as unknown as BasicSubscriptionData);
      jest.spyOn(Stripe.prototype.setupIntents, 'retrieve').mockResolvedValue({
        payment_method: 'pm_123',
      } as Stripe.Response<Stripe.SetupIntent>);
      jest.spyOn(Stripe.prototype.subscriptions, 'retrieve').mockResolvedValue({
        id: 'sub_existing_si',
        status: 'active',
        customer: 'cus_123',
        metadata: { ct_payment_id: 'pay_existing_si', cart_id: cart.id },
        latest_invoice: { id: 'in_existing_si' },
      } as unknown as Stripe.Response<Stripe.Subscription>);
      const sendInvoiceSpy = jest.spyOn(Stripe.prototype.invoices, 'sendInvoice');
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create');

      const result = await service.createSubscriptionFromSetupIntent('setup_intent_123');

      expect(createSpy).not.toHaveBeenCalled();
      expect(sendInvoiceSpy).not.toHaveBeenCalled();
      expect(result.subscriptionId).toBe('sub_existing_si');
    });

    test('SB3-226 fix 3 residual: reconcile in send_invoice mode with a DRAFT invoice DOES send it (recovers a failed original send)', async () => {
      const cart = cartWithExistingSubscriptionId('sub_draft_si');
      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        ...prepareDataFor(cart),
        subscriptionParams: { customer: 'cus_123', collection_method: 'send_invoice' },
      } as unknown as BasicSubscriptionData);
      jest.spyOn(Stripe.prototype.setupIntents, 'retrieve').mockResolvedValue({
        payment_method: 'pm_123',
      } as Stripe.Response<Stripe.SetupIntent>);
      jest.spyOn(Stripe.prototype.subscriptions, 'retrieve').mockResolvedValue({
        id: 'sub_draft_si',
        status: 'active',
        customer: 'cus_123',
        metadata: { ct_payment_id: 'pay_draft_si', cart_id: cart.id },
        latest_invoice: { id: 'in_draft_si', status: 'draft' }, // never sent
      } as unknown as Stripe.Response<Stripe.Subscription>);
      const sendInvoiceSpy = jest
        .spyOn(Stripe.prototype.invoices, 'sendInvoice')
        .mockResolvedValue({ status: 'open' } as unknown as Stripe.Response<Stripe.Invoice>);
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create');

      const result = await service.createSubscriptionFromSetupIntent('setup_intent_123');

      expect(createSpy).not.toHaveBeenCalled();
      expect(sendInvoiceSpy).toHaveBeenCalledWith('in_draft_si');
      expect(result.subscriptionId).toBe('sub_draft_si');
      expect(result.paymentReference).toBe('pay_draft_si'); // still reuses the original CT payment
    });

    test('SB3-226 fix 3 residual: reconcile in send_invoice mode with an OPEN (already-sent) invoice does NOT re-send', async () => {
      const cart = cartWithExistingSubscriptionId('sub_open_si');
      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        ...prepareDataFor(cart),
        subscriptionParams: { customer: 'cus_123', collection_method: 'send_invoice' },
      } as unknown as BasicSubscriptionData);
      jest.spyOn(Stripe.prototype.setupIntents, 'retrieve').mockResolvedValue({
        payment_method: 'pm_123',
      } as Stripe.Response<Stripe.SetupIntent>);
      jest.spyOn(Stripe.prototype.subscriptions, 'retrieve').mockResolvedValue({
        id: 'sub_open_si',
        status: 'active',
        customer: 'cus_123',
        metadata: { ct_payment_id: 'pay_open_si', cart_id: cart.id },
        latest_invoice: { id: 'in_open_si', status: 'open' }, // already sent
      } as unknown as Stripe.Response<Stripe.Subscription>);
      const sendInvoiceSpy = jest.spyOn(Stripe.prototype.invoices, 'sendInvoice');
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create');

      const result = await service.createSubscriptionFromSetupIntent('setup_intent_123');

      expect(createSpy).not.toHaveBeenCalled();
      expect(sendInvoiceSpy).not.toHaveBeenCalled();
      expect(result.subscriptionId).toBe('sub_open_si');
    });

    test('defect 5: an active reconciled sub returns a success response without re-validating a confirmation secret', async () => {
      const cart = cartWithExistingSubscriptionId('sub_active');
      jest
        .spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData')
        .mockResolvedValue(prepareDataFor(cart));
      // active sub, latest_invoice with NO confirmation_secret — old validateSubscription would throw.
      jest.spyOn(Stripe.prototype.subscriptions, 'retrieve').mockResolvedValue({
        id: 'sub_active',
        status: 'active',
        customer: 'cus_123',
        metadata: { ct_payment_id: 'pay_active', cart_id: cart.id },
        latest_invoice: { id: 'in_active' },
      } as unknown as Stripe.Response<Stripe.Subscription>);
      const createSpy = jest.spyOn(Stripe.prototype.subscriptions, 'create');

      const result = await service.createSubscription();

      expect(createSpy).not.toHaveBeenCalled();
      expect(result.subscriptionId).toBe('sub_active');
      expect(result.paymentReference).toBe('pay_active');
      expect(result.clientSecret).toBe(''); // no secret to confirm on an already-active sub
    });
  });

  // SB3-226 fix 3 — persist the subscription id BEFORE the fragile sendInvoice call so a shopper retry
  // after a sendInvoice throw hits the guard instead of minting a second subscription.
  describe('createSubscriptionFromSetupIntent — persist order vs sendInvoice (SB3-226 fix 3)', () => {
    beforeEach(() => {
      jest.spyOn(Stripe.prototype.setupIntents, 'retrieve').mockResolvedValue({
        payment_method: 'pm_123',
      } as Stripe.Response<Stripe.SetupIntent>);
    });

    test('saveSubscriptionId runs before sendInvoice in send_invoice mode', async () => {
      const cart = mockGetSubscriptionCartWithVariant(1); // no existing subscription id → fresh create
      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        ...prepareDataFor(cart),
        subscriptionParams: { customer: 'cus_123', collection_method: 'send_invoice' },
      } as unknown as BasicSubscriptionData);
      jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue({
        id: 'sub_fresh_si',
        status: 'active',
        latest_invoice: { id: 'in_fresh_si' },
      } as unknown as Stripe.Response<Stripe.Subscription>);
      const saveSpy = jest.spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId').mockResolvedValue();
      const sendInvoiceSpy = jest
        .spyOn(Stripe.prototype.invoices, 'sendInvoice')
        .mockResolvedValue({ status: 'open' } as unknown as Stripe.Response<Stripe.Invoice>);

      await service.createSubscriptionFromSetupIntent('setup_intent_123');

      expect(saveSpy).toHaveBeenCalledWith(cart, 'sub_fresh_si');
      expect(sendInvoiceSpy).toHaveBeenCalled();
      expect(saveSpy.mock.invocationCallOrder[0]).toBeLessThan(sendInvoiceSpy.mock.invocationCallOrder[0]);
    });

    test('a sendInvoice rejection still leaves the subscription id persisted (guard can catch a retry)', async () => {
      const cart = mockGetSubscriptionCartWithVariant(1);
      jest.spyOn(StripeSubscriptionService.prototype, 'prepareSubscriptionData').mockResolvedValue({
        ...prepareDataFor(cart),
        subscriptionParams: { customer: 'cus_123', collection_method: 'send_invoice' },
      } as unknown as BasicSubscriptionData);
      jest.spyOn(Stripe.prototype.subscriptions, 'create').mockResolvedValue({
        id: 'sub_fresh_si',
        status: 'active',
        latest_invoice: { id: 'in_fresh_si' },
      } as unknown as Stripe.Response<Stripe.Subscription>);
      const saveSpy = jest.spyOn(StripeSubscriptionService.prototype, 'saveSubscriptionId').mockResolvedValue();
      jest
        .spyOn(Stripe.prototype.invoices, 'sendInvoice')
        .mockRejectedValue(Object.assign(new Error('Invoice already sent'), { statusCode: 400 }));

      await expect(service.createSubscriptionFromSetupIntent('setup_intent_123')).rejects.toBeDefined();

      expect(saveSpy).toHaveBeenCalledWith(cart, 'sub_fresh_si');
    });
  });
});
