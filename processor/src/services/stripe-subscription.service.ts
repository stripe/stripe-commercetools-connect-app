import Stripe from 'stripe';
import { randomUUID } from 'crypto';
import {
  Cart,
  CommercetoolsCartService,
  CommercetoolsOrderService,
  CommercetoolsPaymentService,
  Errorx,
  LineItem,
  Money,
  Payment,
} from '@commercetools/connect-payments-sdk';
import {
  CartDraft,
  CartSetLineItemCustomFieldAction,
  CartSetLineItemCustomTypeAction,
  CartUpdateAction,
  CustomLineItem,
  Customer,
  Order,
  Product,
  ProductVariant,
  ShippingInfo,
} from '@commercetools/platform-sdk';
import { PaymentAmount } from '@commercetools/connect-payments-sdk/dist/commercetools/types/payment.type';
import { getConfig } from '../config/config';
import {
  BasicSubscriptionData,
  CreateSetupIntentProps,
  CreateStripePriceProps,
  CreateStripeShippingPriceProps,
  ExtendedPaymentAmount,
  FullSubscriptionData,
  GetCurrentPaymentProps,
  StripeInvoiceExpanded,
  StripeSubscriptionServiceOptions,
  SubscriptionAttributes,
  UpdateSubscriptionMetadataProps,
} from './types/stripe-subscription.type';
import {
  ConfigElementResponseSchemaDTO,
  ConfirmSubscriptionRequestSchemaDTO,
  SetupIntentResponseSchemaDTO,
  SubscriptionFromSetupIntentResponseSchemaDTO,
  SubscriptionModifyResponseSchemaDTO,
  SubscriptionOutcome,
  SubscriptionResponseSchemaDTO,
} from '../dtos/stripe-payment.dto';
import { getMerchantReturnUrlFromContext } from '../libs/fastify/context/context';
import { stripeApi, wrapStripeError } from '../clients/stripe.client';
import { log } from '../libs/logger';
import { StripeCustomerService } from './stripe-customer.service';
import {
  getLocalizedString,
  paidAmountMatchesTotal,
  isRetryableCtError,
  isTransientStripeError,
  redactError,
  RETRYABLE_CT_ERROR,
  transformVariantAttributes,
} from '../utils';
import {
  lineItemStripeSubscriptionIdField,
  productTypeSubscription,
  stripeCustomerIdFieldName,
  typeLineItem,
} from '../custom-types/custom-types';
import { getSubscriptionAttributes, getSubscriptionUpdateAttributes } from '../mappers/subscription-mapper';
import { CtPaymentCreationService } from './ct-payment-creation.service';
import {
  createCartFromDraft,
  getCartExpanded,
  updateCartById,
  freezeCart,
  isCartFrozen,
  unfreezeCart,
} from './commerce-tools/cart-client';
import { setPaymentStatusInterface } from './commerce-tools/payment-client';
import { getCustomFieldUpdateActions } from './commerce-tools/custom-type-helper';
import {
  METADATA_CART_ID_FIELD,
  METADATA_CART_TOTAL_AMOUNT,
  METADATA_CART_TOTAL_CURRENCY,
  METADATA_CUSTOMER_ID_FIELD,
  METADATA_PAYMENT_ID_FIELD,
  METADATA_PRICE_ID_FIELD,
  METADATA_PRODUCT_ID_FIELD,
  METADATA_SHIPPING_PRICE_AMOUNT,
  METADATA_VARIANT_SKU_FIELD,
  METADATA_PROJECT_KEY_FIELD,
  METADATA_ORDER_BLOCKED_REASON,
  METADATA_ORDER_BLOCKED_INVOICE,
  PAYMENT_STATUS_SUBSCRIPTION_ORDER_BLOCKED,
} from '../constants';
import { StripePaymentService } from './stripe-payment.service';
import { StripeCouponService } from './stripe-coupon.service';
import { getCustomerById } from './commerce-tools/customer-client';
import { getProductById, getProductMasterPrice, getPriceFromProduct } from './commerce-tools/price-client';
import { createCartWithProduct } from './commerce-tools/cart-client';
import { SubscriptionEventConverter } from './converters/subscriptionEventConverter';
import { PaymentTransactions } from '../dtos/operations/payment-intents.dto';
import { OrderPaymentState, PaymentStatus, StripeEventUpdatePayment } from './types/stripe-payment.type';

const stripe = stripeApi();

/**
 * ADR-027: the Stripe call that holds a blocked first cycle failed. The webhook handlers re-throw it out of
 * their catch so the route answers non-2xx and Stripe redelivers — otherwise the subscription would keep
 * renewing with no order, which is what the hold exists to stop. Redelivery is safe: the transactions match by
 * interaction id, the cart is still not Ordered, the guard blocks again and the pause is idempotent. Raised for a
 * transient Stripe failure of the pause and for a transient commercetools failure of the flag that follows it.
 */
export class SubscriptionHoldFailedError extends Error {
  readonly originalError: unknown;

  constructor(message: string, originalError: unknown) {
    super(message);
    this.name = 'SubscriptionHoldFailedError';
    this.originalError = originalError;
  }
}

// which subscription-webhook handler failures are worth re-raising so the route returns
// non-2xx and Stripe redelivers. Only transient/retryable CT-write failures — a permanent error
// (auth, not-found, validation) would just redeliver in vain (a retry storm). Redelivery is safe:
// order creation is guarded by cartState:Ordered and transaction writes are idempotent via
// changeTransactionState. The RETRYABLE_CT_ERROR regex is shared from ../utils (ADR-015) so the
// one-time payment_intent.succeeded path classifies "retryable" the same way.

export class StripeSubscriptionService {
  private customerService: StripeCustomerService;
  private ctCartService: CommercetoolsCartService;
  private ctPaymentService: CommercetoolsPaymentService;
  private ctOrderService: CommercetoolsOrderService;
  private paymentCreationService: CtPaymentCreationService;
  private paymentService: StripePaymentService;
  private stripeCouponService: StripeCouponService;
  private subscriptionEventConverter: SubscriptionEventConverter;

  constructor(opts: StripeSubscriptionServiceOptions) {
    this.ctCartService = opts.ctCartService;
    this.ctPaymentService = opts.ctPaymentService;
    this.ctOrderService = opts.ctOrderService;
    this.paymentService = new StripePaymentService(opts);
    this.customerService = new StripeCustomerService(opts.ctCartService);
    this.paymentCreationService = new CtPaymentCreationService({
      ctCartService: opts.ctCartService,
      ctPaymentService: opts.ctPaymentService,
    });
    this.stripeCouponService = new StripeCouponService();
    this.subscriptionEventConverter = new SubscriptionEventConverter();
  }

  public async createSetupIntent(): Promise<SetupIntentResponseSchemaDTO> {
    try {
      const {
        cart,
        stripeCustomerId,
        subscriptionParams: { off_session },
        billingAddress,
        merchantReturnUrl,
      } = await this.prepareSubscriptionData({ basicData: true });

      const setupIntent = await this.createStripeSetupIntent({ stripeCustomerId, cart, offSession: off_session });

      return {
        clientSecret: setupIntent.clientSecret,
        merchantReturnUrl,
        billingAddress,
      };
    } catch (error) {
      throw this.passOwnRefusal(error);
    }
  }

  public async createSubscription(): Promise<SubscriptionResponseSchemaDTO> {
    try {
      const {
        cart,
        amountPlanned,
        priceId,
        stripeCustomerId,
        subscriptionParams,
        billingAddress,
        merchantReturnUrl,
        shippingPriceId,
      } = await this.prepareSubscriptionData();

      const oneTimeItems = await this.getAllLineItemPrices(cart);

      // never create a second Stripe Subscription for a cart that already has one. The
      // derived idempotency key below collapses retries that still share the same cart version
      // (Stripe dedups identical keys); this guard covers the retry-AFTER-persist case where the cart
      // was re-versioned/frozen so the derived key would differ. A canceled/incomplete_expired
      // existing subscription is treated as absent, falling through to create a fresh one.
      const existingSubscription = await this.findExistingSubscriptionForCart(cart, stripeCustomerId, [
        'latest_invoice.confirmation_secret',
      ]);

      if (existingSubscription) {
        return this.reconcileSubscriptionResponse({
          cart,
          subscription: existingSubscription,
          amountPlanned,
          merchantReturnUrl,
          billingAddress,
        });
      }

      const subscription = await stripe.subscriptions.create(
        {
          ...subscriptionParams,
          customer: stripeCustomerId!,
          items: [
            { price: priceId, quantity: this.findSubscriptionLineItem(cart).quantity || 1 },
            ...(shippingPriceId ? [{ price: shippingPriceId }] : []),
          ],
          add_invoice_items: oneTimeItems,
          payment_behavior: 'default_incomplete',
          payment_settings: { save_default_payment_method: 'on_subscription' },
          expand: ['latest_invoice.confirmation_secret'],
          metadata: this.sealCartTotal(cart, this.paymentCreationService.getPaymentMetadata(cart)),
          discounts: await this.stripeCouponService.getStripeCoupons(cart),
        },
        { idempotencyKey: this.buildSubscriptionIdempotencyKey(cart) },
      );

      const { clientSecret, paymentIntentId } = this.validateSubscription(subscription);
      // Subscription transactions are keyed by the Stripe invoice id (in_), consistent with the
      // invoice.paid webhook and the SetupIntent flow. This keeps a single, invoice-referenced set of
      // transactions on the CT payment (no pi_/in_ split that would duplicate them).
      const invoiceId = typeof subscription.latest_invoice === 'object' ? subscription.latest_invoice?.id : undefined;

      log.info('Stripe Subscription created.', {
        ctCartId: cart.id,
        stripeSubscriptionId: subscription.id,
        stripePaymentIntentId: paymentIntentId,
        stripeInvoiceId: invoiceId,
      });

      await this.saveSubscriptionId(cart, subscription.id);

      const paymentReference = await this.paymentCreationService.handleCtPaymentCreation({
        subscriptionId: subscription.id,
        interactionId: invoiceId || paymentIntentId,
        // Keep updating the Stripe PaymentIntent metadata against the real pi_ even though CT
        // transactions are keyed by the invoice id (in_).
        paymentIntentId,
        amountPlanned,
        cart,
      });

      // Freeze cart after subscription creation to prevent modifications
      // Get the updated cart to ensure we have the correct version after payment creation
      try {
        const updatedCart = await this.ctCartService.getCart({ id: cart.id });
        await freezeCart(updatedCart);
        log.info(`Cart frozen after Subscription creation.`, {
          ctCartId: updatedCart.id,
          stripeSubscriptionId: subscription.id,
        });
      } catch (error) {
        log.error(`Error freezing cart after Subscription creation.`, {
          errorMessage: error instanceof Error ? error.message : String(error),
          ctCartId: cart.id,
          stripeSubscriptionId: subscription.id,
        });
        // Continue - do not break the subscription flow if freeze fails
      }

      return {
        subscriptionId: subscription.id,
        cartId: cart.id,
        clientSecret,
        paymentReference,
        merchantReturnUrl,
        billingAddress,
      };
    } catch (error) {
      throw this.passOwnRefusal(error);
    }
  }

  public async createSubscriptionFromSetupIntent(
    setupIntentId: string,
  ): Promise<SubscriptionFromSetupIntentResponseSchemaDTO> {
    try {
      const { cart, priceId, stripeCustomerId, subscriptionParams, amountPlanned, shippingPriceId } =
        await this.prepareSubscriptionData();
      const { payment_method: paymentMethodId } = await stripe.setupIntents.retrieve(setupIntentId);
      const { hasFreeAnchorDays, isSendInvoice } = this.getSubscriptionTypes(subscriptionParams);

      if (!paymentMethodId || typeof paymentMethodId !== 'string') {
        throw new Error('Failed to create Subscription. Invalid setup intent.');
      }

      const oneTimeItems = await this.getAllLineItemPrices(cart);

      // same idempotency guard as createSubscription — reconcile an already-persisted
      // subscription instead of creating a duplicate on retry; the derived key handles the
      // retry-before-persist / concurrent case.
      const existingSubscription = await this.findExistingSubscriptionForCart(cart, stripeCustomerId, [
        'latest_invoice',
      ]);

      if (existingSubscription) {
        return this.reconcileSubscriptionFromSetupIntent(existingSubscription, {
          cart,
          amountPlanned,
          isSendInvoice,
          hasFreeAnchorDays,
        });
      }

      const subscription = await stripe.subscriptions.create(
        {
          ...subscriptionParams,
          customer: stripeCustomerId,
          default_payment_method: paymentMethodId,

          items: [
            { price: priceId, quantity: this.findSubscriptionLineItem(cart).quantity || 1 },
            ...(shippingPriceId ? [{ price: shippingPriceId }] : []),
          ],
          add_invoice_items: oneTimeItems,
          expand: ['latest_invoice'],
          payment_settings: { save_default_payment_method: 'on_subscription' },
          metadata: this.sealCartTotal(cart, this.paymentCreationService.getPaymentMetadata(cart)),
          discounts: await this.stripeCouponService.getStripeCoupons(cart),
        },
        { idempotencyKey: this.buildSubscriptionIdempotencyKey(cart, setupIntentId) },
      );

      log.info('Stripe Subscription from Setup Intent created.', {
        ctCartId: cart.id,
        stripeSubscriptionId: subscription.id,
        stripeSetupIntentId: setupIntentId,
      });

      const invoiceId = (subscription.latest_invoice as Stripe.Invoice)?.id;

      // persist the subscription id BEFORE the fragile sendInvoice call. If sendInvoice
      // throws (e.g. the invoice was already sent/paid in send_invoice mode), the id is still on the
      // line item, so the pre-create guard catches a shopper retry (which would otherwise mint a new
      // SetupIntent → new key → a second subscription) instead of creating a duplicate.
      await this.saveSubscriptionId(cart, subscription.id);

      if (isSendInvoice && invoiceId) {
        await this.sendSubscriptionInvoiceAndLog(invoiceId);
      }

      const ctPaymentId = await this.paymentCreationService.handleCtPaymentCreation({
        cart,
        amountPlanned,
        subscriptionId: subscription.id,
        interactionId: !hasFreeAnchorDays && invoiceId ? invoiceId : subscription.id,
      });

      // Freeze cart after subscription creation to prevent modifications
      // Get the updated cart to ensure we have the correct version after payment creation
      try {
        const updatedCart = await this.ctCartService.getCart({ id: cart.id });
        await freezeCart(updatedCart);
        log.info(`Cart frozen after Subscription from Setup Intent creation.`, {
          ctCartId: updatedCart.id,
          stripeSubscriptionId: subscription.id,
        });
      } catch (error) {
        log.error(`Error freezing cart after Subscription from Setup Intent creation.`, {
          errorMessage: error instanceof Error ? error.message : String(error),
          ctCartId: cart.id,
          stripeSubscriptionId: subscription.id,
        });
        // Continue - do not break the subscription flow if freeze fails
      }

      return { subscriptionId: subscription.id, paymentReference: ctPaymentId };
    } catch (error) {
      throw this.passOwnRefusal(error);
    }
  }

  /**
   * reconcile an already-persisted subscription (found by the pre-create idempotency guard)
   * instead of creating a duplicate on retry. Sends the invoice only when it is still a draft (a
   * fresh-create whose sendInvoice threw lands here and must still email it; an open/paid invoice was
   * already sent and must not be re-sent), reuses the original CT payment, and returns its reference.
   */
  private async reconcileSubscriptionFromSetupIntent(
    existingSubscription: Stripe.Subscription,
    {
      cart,
      amountPlanned,
      isSendInvoice,
      hasFreeAnchorDays,
    }: { cart: Cart; amountPlanned: PaymentAmount; isSendInvoice: boolean; hasFreeAnchorDays: boolean },
  ): Promise<SubscriptionFromSetupIntentResponseSchemaDTO> {
    const reconciledInvoice = existingSubscription.latest_invoice as Stripe.Invoice | undefined;
    const reconciledInvoiceId = reconciledInvoice?.id;

    if (isSendInvoice && reconciledInvoiceId && reconciledInvoice?.status === 'draft') {
      await this.sendSubscriptionInvoiceAndLog(reconciledInvoiceId);
    }

    // Do NOT create a second CT payment — reuse the one from the original run.
    const paymentReference = await this.resolveReconciledPaymentReference({
      cart,
      subscription: existingSubscription,
      amountPlanned,
      interactionId: !hasFreeAnchorDays && reconciledInvoiceId ? reconciledInvoiceId : existingSubscription.id,
    });
    log.info('Reconciled existing Stripe Subscription from Setup Intent.', {
      ctCartId: cart.id,
      stripeSubscriptionId: existingSubscription.id,
      ctPaymentReference: paymentReference,
    });
    return { subscriptionId: existingSubscription.id, paymentReference };
  }

  /**
   * Sends a subscription invoice and logs the outcome by resulting status. Shared by the fresh-create
   * and the reconcile paths so both classify open/paid/other identically.
   */
  private async sendSubscriptionInvoiceAndLog(invoiceId: string): Promise<void> {
    const invoiceSent = await stripe.invoices.sendInvoice(invoiceId);
    if (invoiceSent.status === 'open') {
      log.info('Stripe Subscription invoice was sent.');
    } else if (invoiceSent.status === 'paid') {
      log.info('Stripe Subscription invoice is paid.');
    } else {
      log.warn('Stripe Subscription invoice was not sent.');
    }
  }

  prepareSubscriptionData(): Promise<FullSubscriptionData>;
  prepareSubscriptionData(options: { basicData: true }): Promise<BasicSubscriptionData>;
  public async prepareSubscriptionData({ basicData }: { basicData?: boolean } = {}): Promise<
    BasicSubscriptionData | FullSubscriptionData
  > {
    const config = getConfig();
    const merchantReturnUrl = getMerchantReturnUrlFromContext() || config.merchantReturnUrl;
    const cart = await getCartExpanded();

    this.assertSingleSubscriptionLineItem(cart);
    this.assertNoNegativeCustomLineItem(cart);
    this.assertSupportedSubscriptionDiscounts(cart);

    const subscriptionLineItem = this.findSubscriptionLineItem(cart);
    const subscriptionParams = getSubscriptionAttributes(subscriptionLineItem.variant.attributes);
    this.assertCodeBillableOnSubscriptionTiming(cart, subscriptionParams);

    const customer = await this.customerService.getCtCustomer(cart.customerId!);
    const stripeCustomerId: string = customer?.custom?.fields?.[stripeCustomerIdFieldName];
    const billingAddress =
      config.stripeCollectBillingAddress !== 'auto' ? this.customerService.getBillingAddress(cart) : undefined;

    if (basicData) {
      return { cart, stripeCustomerId, subscriptionParams, billingAddress, merchantReturnUrl };
    }

    const amountPlanned = await this.ctCartService.getPaymentAmount({ cart });
    const lineItemAmount = this.getSubscriptionPaymentAmount(cart);
    const priceId = await this.getCreateSubscriptionPriceId(cart, lineItemAmount);
    const shippingPriceId = await this.getSubscriptionShippingPriceId(cart);

    return {
      cart,
      lineItemAmount,
      amountPlanned,
      priceId,
      stripeCustomerId,
      subscriptionParams,
      billingAddress,
      merchantReturnUrl,
      shippingPriceId,
    };
  }

  public validateSubscription(subscription: Stripe.Subscription) {
    const latestInvoice = subscription.latest_invoice as StripeInvoiceExpanded | string | null;

    if (typeof latestInvoice === 'string' || !latestInvoice) {
      throw new Error('Failed to create Subscription, missing Payment Intent.');
    }

    const confirmationSecret = latestInvoice.confirmation_secret;

    if (!confirmationSecret?.client_secret) {
      throw new Error('Failed to create Subscription, missing Payment Intent.');
    }

    const clientSecret = confirmationSecret.client_secret;
    const paymentIntentId = clientSecret.split('_secret_')[0];

    return { paymentIntentId, clientSecret };
  }

  /**
   * deterministic Stripe idempotency key for subscription creation. Derived purely from
   * stable CT identifiers (cart id + cart version, plus the setup intent id when the SetupIntent
   * flow is used) — NO timestamp or random component — so an identical retry produces the same key
   * and Stripe dedups it instead of creating a second subscription. The price id is deliberately NOT
   * part of the key: it is not stable across a retry (a brand-new Stripe Price minted inside the
   * retry window would change it and defeat dedup), while within one cart.version the subscription
   * price is already fixed by the line item. Mirrors the derived refund key precedent in
   * stripe-payment.service.ts (`refund-${payment.id}-${amount}-${seq}`).
   */
  private buildSubscriptionIdempotencyKey(cart: Cart, setupIntentId?: string): string {
    const base = `subscription-${cart.id}-${cart.version}`;
    return setupIntentId ? `${base}-${setupIntentId}` : base;
  }

  /**
   * Pre-create guard. If the subscription line item already carries a Stripe subscription id
   * (persisted by a prior, possibly-retried request), retrieve that subscription instead of creating
   * a new one. A canceled/incomplete_expired subscription is no longer valid, so it is treated as
   * absent (returns null) and the caller creates a fresh one. Only a genuinely missing subscription
   * (resource_missing / 404) is treated as absent; a transient retrieval error is rethrown to avoid
   * creating a duplicate.
   */
  private async findExistingSubscriptionForCart(
    cart: Cart,
    stripeCustomerId: string | undefined,
    expand: string[],
  ): Promise<Stripe.Subscription | null> {
    const existingId = this.findSubscriptionLineItem(cart).custom?.fields?.[lineItemStripeSubscriptionIdField];
    if (!existingId || typeof existingId !== 'string') {
      return null;
    }

    let existing: Stripe.Subscription;
    try {
      existing = await stripe.subscriptions.retrieve(existingId, { expand });
    } catch (error) {
      // Only a genuinely missing subscription (deleted / bad id) may fall through to a fresh create.
      // A transient failure (network, 5xx, rate-limit) must NOT create a second subscription: on a
      // retry-after-persist the cart was re-versioned, so the derived idempotency key differs and a
      // fresh create would duplicate. Fail safe by rethrowing so the client can retry the same call.
      // Classify on the Stripe error's structured fields, never on message text.
      const stripeError = error as { code?: string; statusCode?: number };
      const isNotFound = stripeError?.code === 'resource_missing' || stripeError?.statusCode === 404;
      if (isNotFound) {
        log.warn('Subscription referenced on cart no longer exists in Stripe; creating a new one.', {
          ctCartId: cart.id,
          stripeSubscriptionId: existingId,
        });
        return null;
      }
      log.error('Transient error retrieving existing Stripe Subscription; aborting to avoid a duplicate.', {
        ctCartId: cart.id,
        stripeSubscriptionId: existingId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    // IDOR: `stripeConnector_stripeSubscriptionId` on the line item is client-writable, so a
    // caller could plant a victim's sub_... to harvest it (including the latest_invoice client_secret).
    // Only reconcile a subscription that belongs to THIS cart's Stripe customer; otherwise treat it as
    // absent and create a fresh one. Mirrors the ownership binding in confirmSubscriptionPayment /
    // validateCustomerSubscription.
    const existingCustomer = typeof existing.customer === 'string' ? existing.customer : existing.customer?.id;
    if (!stripeCustomerId || existingCustomer !== stripeCustomerId) {
      log.warn('Subscription on cart does not belong to the cart customer; ignoring (ownership guard).', {
        ctCartId: cart.id,
        stripeSubscriptionId: existingId,
      });
      return null;
    }

    // the guard must bind to THIS cart, not just to the customer. `replicateCart` (reorder)
    // copies the `stripeConnector_stripeSubscriptionId` line-item field AND keeps the customer, so a
    // genuinely separate (replicated) cart would otherwise reconcile onto the OLD subscription and
    // break the new purchase. The subscription metadata carries the originating cart id (written at
    // creation via sealCartTotal(getPaymentMetadata(cart))). Strict equality is the fail-safe: the
    // legitimate same-cart retry matches and still reconciles; a different/replicated cart (or an
    // absent metadata field) does not, so the caller creates a fresh subscription.
    if (existing.metadata?.[METADATA_CART_ID_FIELD] !== cart.id) {
      log.warn('Subscription on cart belongs to a different cart; ignoring (cart-binding guard).', {
        ctCartId: cart.id,
        stripeSubscriptionId: existingId,
        subscriptionCartId: existing.metadata?.[METADATA_CART_ID_FIELD],
      });
      return null;
    }

    if (existing.status === 'canceled' || existing.status === 'incomplete_expired') {
      log.warn('Existing Stripe Subscription on cart is no longer valid; creating a new one.', {
        ctCartId: cart.id,
        stripeSubscriptionId: existingId,
        status: existing.status,
      });
      return null;
    }

    log.info('Reusing existing Stripe Subscription for cart (duplicate-create guard).', {
      ctCartId: cart.id,
      stripeSubscriptionId: existingId,
      status: existing.status,
    });
    return existing;
  }

  /**
   * Reconcile branch for createSubscription (default_incomplete flow). The subscription
   * already exists, so we must NOT create a second Stripe subscription NOR a second CT payment. We
   * return the same response shape pointing at the existing subscription and its already-created CT
   * payment. An already-active subscription has no confirmation secret to confirm, so clientSecret is
   * empty; a still-incomplete one returns its real client secret so the client can finish paying.
   */
  private async reconcileSubscriptionResponse({
    cart,
    subscription,
    amountPlanned,
    merchantReturnUrl,
    billingAddress,
  }: {
    cart: Cart;
    subscription: Stripe.Subscription;
    amountPlanned: PaymentAmount;
    merchantReturnUrl: string;
    billingAddress?: string;
  }): Promise<SubscriptionResponseSchemaDTO> {
    const latestInvoice = subscription.latest_invoice as StripeInvoiceExpanded | string | null;
    const invoiceId = typeof latestInvoice === 'object' ? latestInvoice?.id : undefined;

    // An active subscription has no confirmation_secret — calling validateSubscription would throw
    // "missing Payment Intent". Only a still-incomplete sub carries a resumable client secret.
    let clientSecret = '';
    let paymentIntentId: string | undefined;
    const hasConfirmationSecret =
      typeof latestInvoice === 'object' && !!latestInvoice?.confirmation_secret?.client_secret;
    if (hasConfirmationSecret) {
      ({ clientSecret, paymentIntentId } = this.validateSubscription(subscription));
    }

    const paymentReference = await this.resolveReconciledPaymentReference({
      cart,
      subscription,
      amountPlanned,
      interactionId: invoiceId || paymentIntentId,
      paymentIntentId,
    });

    log.info('Reconciled existing Stripe Subscription; skipped duplicate create.', {
      ctCartId: cart.id,
      stripeSubscriptionId: subscription.id,
      ctPaymentReference: paymentReference,
      status: subscription.status,
    });

    return {
      subscriptionId: subscription.id,
      cartId: cart.id,
      clientSecret,
      paymentReference,
      merchantReturnUrl,
      billingAddress,
    };
  }

  /**
   * Recover the CT payment already created for a reconciled subscription instead of creating
   * a duplicate. Preference order: the payment id Stripe stored on the subscription metadata (written
   * at original creation via updatePaymentMetadata), then any payment already attached to the cart,
   * and only if neither exists (the original run never got that far) create one now — which is not a
   * duplicate because none was ever persisted.
   */
  private async resolveReconciledPaymentReference({
    cart,
    subscription,
    amountPlanned,
    interactionId,
    paymentIntentId,
  }: {
    cart: Cart;
    subscription: Stripe.Subscription;
    amountPlanned: PaymentAmount;
    interactionId?: string;
    paymentIntentId?: string;
  }): Promise<string> {
    const fromMetadata = subscription.metadata?.[METADATA_PAYMENT_ID_FIELD];
    if (fromMetadata) {
      return fromMetadata;
    }

    const attachedPayments = cart.paymentInfo?.payments ?? [];
    const fromCart = attachedPayments[attachedPayments.length - 1]?.id;
    if (fromCart) {
      return fromCart;
    }

    log.warn('Reconciled subscription has no associated CT payment; creating one (no duplicate exists).', {
      ctCartId: cart.id,
      stripeSubscriptionId: subscription.id,
    });
    return this.paymentCreationService.handleCtPaymentCreation({
      cart,
      amountPlanned,
      subscriptionId: subscription.id,
      interactionId: interactionId ?? subscription.id,
      paymentIntentId,
    });
  }

  public async getCreateSubscriptionPriceId(cart: Cart, amount: PaymentAmount): Promise<string> {
    const product = this.findSubscriptionLineItem(cart);
    const attributes = transformVariantAttributes<SubscriptionAttributes>(product.variant.attributes);
    const stripePrice = await this.getStripePriceByMetadata(product);

    if (stripePrice.data.length && stripePrice.data[0].id) {
      const price = stripePrice.data[0];
      const isActive = price.active;
      const hasSamePrice = price.unit_amount === amount.centAmount;
      const hasSameInterval = price.recurring?.interval === attributes.recurring_interval;
      const hasSameIntervalCount = price.recurring?.interval_count === attributes.recurring_interval_count;

      if (isActive && hasSamePrice && hasSameInterval && hasSameIntervalCount) {
        log.info(`Found existing price ID: "${price.id}"`);
        return price.id;
      } else {
        await this.disableStripePrice(price, product);
      }
    }

    log.info('A new Stripe Price will be created.');
    const stripeProductId = await this.getStripeProduct({ product });
    return await this.createStripePrice({ amount, product, stripeProductId, attributes });
  }

  public async getSubscriptionShippingPriceId(cart: Cart): Promise<string | undefined> {
    const product = this.findSubscriptionLineItem(cart);
    const attributes = transformVariantAttributes<SubscriptionAttributes>(product.variant.attributes);
    const shippingInfo = cart.shippingInfo;
    if (!shippingInfo) {
      log.info('No shipping method found in cart.');
      return undefined;
    }

    const stripeProductId = await this.getStripeProduct({ shipping: shippingInfo });
    const stripePrice = await this.getStripeShippingPriceByMetadata(shippingInfo);

    if (stripePrice.data.length && stripePrice.data[0].id) {
      const price = stripePrice.data[0];
      const isActive = price.active;

      if (isActive) {
        log.info(`Found existing price ID: "${price.id}"`);
        return price.id;
      }
    }

    log.info('A new Stripe Shipping Price will be created.');
    return await this.createStripeShippingPrice({ shipping: shippingInfo, stripeProductId, attributes });
  }

  private async getLineItemPriceId(lineItem: LineItem): Promise<string> {
    // Use the effective per-unit price: a product sale price (price.discounted) is the real amount
    // charged, so it belongs in the Stripe Price unit_amount. Cart-level coupons stay in the
    // subscription `discounts` field. Falling back to price.value keeps undiscounted items unchanged.
    const effectiveUnitAmount = lineItem.price.discounted?.value.centAmount ?? lineItem.price.value.centAmount;
    const amount: ExtendedPaymentAmount = {
      centAmount: effectiveUnitAmount,
      totalCentAmount: effectiveUnitAmount * lineItem.quantity,
      currencyCode: lineItem.price.value.currencyCode,
      fractionDigits: lineItem.price.value.fractionDigits,
    };

    const stripePrice = await this.getStripePriceByMetadata(lineItem);
    if (stripePrice.data.length && stripePrice.data[0].id) {
      const price = stripePrice.data[0];
      const isActive = price.active;
      const hasSamePrice = price.unit_amount === amount.centAmount;

      if (isActive && hasSamePrice) {
        log.info(`Found existing price ID for line item: "${price.id}"`);
        return price.id;
      } else {
        await this.disableStripePrice(price, lineItem);
      }
    }

    const stripeProductId = await this.getStripeProduct({ product: lineItem });
    const price = await stripe.prices.create(
      {
        currency: amount.currencyCode,
        product: stripeProductId,
        unit_amount: amount.centAmount,
        metadata: {
          [METADATA_VARIANT_SKU_FIELD]: lineItem.variant.sku!,
          [METADATA_PRICE_ID_FIELD]: lineItem.price.id,
        },
        nickname: getLocalizedString(lineItem.name),
      },
      { idempotencyKey: randomUUID() },
    );

    log.info(`Stripe price created for line item.`, {
      ctProductId: lineItem.productId,
      ctPriceAmount: amount.centAmount,
      stripePriceId: price.id,
      stripeProductId,
    });

    return price.id;
  }

  /**
   * Build the `add_invoice_items` for the subscription's first invoice: every one-time charge in the
   * cart EXCEPT the subscription line item itself. That is the regular one-time line items AND the
   * cart's custom line items (ad-hoc fees / service charges).
   *
   * Custom line items were previously omitted here, so on a cart that mixed a subscription
   * product, a custom line item and a discount code the first invoice undercharged by the
   * custom-line-item amount while a Paid order was still minted at the cart total (the amount guard was
   * then exempt on a discounted invoice; that exemption is removed under ADR-026). Including them closes the gap.
   * @param cart - The cart EXPANDED to get the line item prices for
   * @returns `add_invoice_items` entries for `stripe.subscriptions.create`
   */
  private async getAllLineItemPrices(cart: Cart): Promise<Stripe.SubscriptionCreateParams.AddInvoiceItem[]> {
    const invoiceItems: Stripe.SubscriptionCreateParams.AddInvoiceItem[] = [];

    for (const lineItem of cart.lineItems) {
      if (lineItem.productType.obj?.name === productTypeSubscription.name) {
        continue;
      }

      const priceId = await this.getLineItemPriceId(lineItem);
      invoiceItems.push({
        price: priceId,
        quantity: lineItem.quantity || 1,
      });
    }

    // Custom line items carry no productId / variant.sku / price.id, so getLineItemPriceId cannot price
    // them. They are billed via `price_data` with a Stripe Product reused per slug and no `tax_behavior`
    // (the invoice stays tax-free and comparable to the cart total). Each is billed at its `totalPrice`
    // as a single unit. By the time this runs, assertSupportedSubscriptionDiscounts (ADR-026) has refused
    // every subscription cart whose discount is not a cart-total discount, and a direct (code-less) discount
    // of any kind — so the only discount that can coexist with a fee here is a total-price code, which lives
    // in `cart.discountOnTotalPrice`, NOT in the fee's `totalPrice`; the invoice-wide Stripe coupon applies
    // it once over the whole invoice, so billing the fee at its `totalPrice` neither double-counts nor drops
    // it. A negative (credit) custom line item was also refused upstream.
    for (const customLineItem of cart.customLineItems ?? []) {
      const unitAmount = customLineItem.totalPrice.centAmount;
      if (unitAmount <= 0) {
        // Nothing to bill (a zero item; a credit was already rejected in prepareSubscriptionData).
        continue;
      }

      const stripeProductId = await this.getStripeProductForCustomLineItem(customLineItem);
      invoiceItems.push({
        price_data: {
          currency: customLineItem.money.currencyCode.toLowerCase(),
          product: stripeProductId,
          unit_amount: unitAmount,
        },
        quantity: 1,
      });
    }

    return invoiceItems;
  }

  /**
   * Find or create a Stripe Product for a custom line item, keyed by its slug so repeated checkouts
   * of the same fee reuse one Product instead of creating a new one each time (mirrors getStripeProduct
   * for regular products, which key on productId).
   */
  private async getStripeProductForCustomLineItem(customLineItem: CustomLineItem): Promise<string> {
    const existing = await this.findStripeProductById(customLineItem.slug);
    if (existing?.id) {
      return existing.id;
    }

    const newProduct = await stripe.products.create(
      {
        name: getLocalizedString(customLineItem.name),
        metadata: {
          [METADATA_PRODUCT_ID_FIELD]: customLineItem.slug,
        },
      },
      { idempotencyKey: randomUUID() },
    );

    log.info('Stripe product created for custom line item.', {
      customLineItemSlug: customLineItem.slug,
      stripeProductId: newProduct.id,
    });
    return newProduct.id;
  }

  public async getStripePriceByMetadata(product: LineItem) {
    return await stripe.prices.search({
      query: `metadata['${METADATA_VARIANT_SKU_FIELD}']:'${product.variant.sku}' AND
              metadata['${METADATA_PRICE_ID_FIELD}']:'${product.price.id}'`,
    });
  }

  public async getStripeShippingPriceByMetadata(shipping: ShippingInfo) {
    return await stripe.prices.search({
      query: `metadata['${METADATA_VARIANT_SKU_FIELD}']:'${shipping.shippingMethod?.id}' AND
              metadata['${METADATA_SHIPPING_PRICE_AMOUNT}']:'${shipping.price.centAmount}'`,
    });
  }

  public async disableStripePrice(price: Stripe.Price, product: LineItem) {
    await stripe.prices.update(
      price.id,
      {
        nickname: price.nickname ? `DEPRECATED - ${price.nickname}` : 'DEPRECATED PRICE',
        active: false,
        metadata: {
          [METADATA_VARIANT_SKU_FIELD]: `deprecated_${product.variant.sku}`,
          [METADATA_PRICE_ID_FIELD]: `deprecated_${product.price.id}`,
        },
      },
      { idempotencyKey: randomUUID() },
    );
    log.warn(`Existing Stripe Price "${price.id}" has been updated to deprecated.`);
  }

  getStripeProduct(options: { product: LineItem }): Promise<string>;
  getStripeProduct(options: { shipping: ShippingInfo }): Promise<string>;
  public async getStripeProduct(options: { product?: LineItem; shipping?: ShippingInfo }): Promise<string> {
    const { product, shipping } = options;
    const idProduct = product?.productId;
    const idShipping = shipping?.shippingMethod?.id;
    if (!idProduct && !idShipping) {
      throw new Error('Either product or shipping must be provided');
    }

    const idSearch = idProduct ?? idShipping;
    if (!idSearch) {
      throw new Error('Either product.id or shipping.shippingMethod.id must be provided');
    }

    const stripeProduct = await this.findStripeProductById(idSearch);
    if (stripeProduct && stripeProduct.id) {
      return stripeProduct.id;
    }

    log.info(`No stripe product found was found with metadata specified. A new one will be created.`);
    if (product) {
      return await this.createStripeProduct({ product });
    } else {
      return await this.createStripeProduct({ shipping: shipping! });
    }
  }

  /**
   * Finds a Stripe product by searching its metadata for a specific ID
   * @param idSearch - The ID to search for in the product metadata
   * @returns The Stripe product ID if found, undefined otherwise
   */
  private async findStripeProductById(idSearch: string): Promise<Stripe.Product | undefined> {
    const stripeProducts = await stripe.products.search({
      query: `metadata['${METADATA_PRODUCT_ID_FIELD}']:'${idSearch}'`,
    });

    if (stripeProducts.data.length && stripeProducts.data[0].id) {
      const stripeProduct = stripeProducts.data[0];
      log.info(`Found existing product ID: ${stripeProduct.id}`);
      return stripeProduct;
    }

    return undefined;
  }

  createStripeProduct(options: { product: LineItem }): Promise<string>;
  createStripeProduct(options: { shipping: ShippingInfo }): Promise<string>;
  public async createStripeProduct(options: { product?: LineItem; shipping?: ShippingInfo }): Promise<string> {
    const { product, shipping } = options;

    if (!product && !shipping) {
      throw new Error('Either product or shipping must be provided');
    }

    const name = shipping ? shipping.shippingMethodName : getLocalizedString(product!.name);
    const id = shipping ? shipping.shippingMethod?.id || 'Shipping Method Mock' : product!.productId;

    const newProduct = await stripe.products.create(
      {
        name: name,
        metadata: {
          [METADATA_PRODUCT_ID_FIELD]: id,
        },
      },
      { idempotencyKey: randomUUID() },
    );

    log.info(`Stripe ${shipping ? 'shipping' : 'product'} created.`, {
      ctProductId: id,
      stripeProductId: newProduct.id,
    });
    return newProduct.id;
  }

  public async createStripePrice({ amount, product, stripeProductId, attributes }: CreateStripePriceProps) {
    const price = await stripe.prices.create(
      {
        currency: amount.currencyCode,
        product: stripeProductId,
        unit_amount: amount.centAmount,
        metadata: {
          [METADATA_VARIANT_SKU_FIELD]: product.variant.sku!,
          [METADATA_PRICE_ID_FIELD]: product.price.id,
        },
        recurring: {
          interval: attributes.recurring_interval,
          interval_count: attributes.recurring_interval_count,
        },
        nickname: attributes.description,
      },
      { idempotencyKey: randomUUID() },
    );

    log.info(`Stripe price created. 
      ctProductId: ${product.productId},
      ctPriceAmount: ${amount.centAmount},
      stripePriceId: ${price.id},
      stripeProductId: ${stripeProductId},
    }`);

    return price.id;
  }

  public async createStripeShippingPrice({ shipping, stripeProductId, attributes }: CreateStripeShippingPriceProps) {
    const price = await stripe.prices.create(
      {
        currency: shipping.price.currencyCode,
        product: stripeProductId,
        unit_amount: shipping.price.centAmount,
        active: true,
        recurring: {
          interval: attributes.recurring_interval,
          interval_count: attributes.recurring_interval_count,
        },
        metadata: {
          [METADATA_VARIANT_SKU_FIELD]: shipping.shippingMethod?.id ?? '',
          [METADATA_SHIPPING_PRICE_AMOUNT]: shipping.price.centAmount,
        },
        nickname: shipping.shippingMethodName,
      },
      { idempotencyKey: randomUUID() },
    );

    log.info(`Stripe Shipping price created.`, {
      ctProductId: shipping.shippingMethod?.id,
      ctPriceAmount: shipping.price.centAmount,
      stripePriceId: price.id,
      stripeProductId,
    });

    return price.id;
  }

  public async createStripeSetupIntent({ stripeCustomerId, cart, offSession }: CreateSetupIntentProps) {
    const setupIntent = await stripe.setupIntents.create(
      {
        customer: stripeCustomerId,
        usage: offSession ? 'off_session' : 'on_session',
        metadata: this.paymentCreationService.getPaymentMetadata(cart),
      },
      { idempotencyKey: randomUUID() },
    );

    if (!setupIntent.client_secret) {
      throw new Error('Failed to create Setup Intent.');
    }

    log.info(`Stripe Setup Intent created.`, { stripeSetupIntentId: setupIntent.id });
    return { id: setupIntent.id, clientSecret: setupIntent.client_secret };
  }

  public async saveSubscriptionId(cart: Cart, subscriptionId: string): Promise<void> {
    const subscriptionLineItem = this.findSubscriptionLineItem(cart);
    const lineItemId = subscriptionLineItem.id;
    const updateFieldActions = await getCustomFieldUpdateActions<
      CartSetLineItemCustomFieldAction | CartSetLineItemCustomTypeAction
    >({
      fields: { [lineItemStripeSubscriptionIdField]: subscriptionId },
      customFields: cart.custom,
      customType: typeLineItem,
      idValue: { lineItemId },
      prefix: 'LineItem',
    });
    await updateCartById(cart, updateFieldActions);

    log.info(`Stripe Subscription ID saved to line item in Cart.`, {
      ctCartId: cart.id,
      ctLineItemId: lineItemId,
      stripeSubscriptionId: subscriptionId,
    });
  }

  public async confirmSubscriptionPayment({
    subscriptionId,
    paymentReference,
    paymentIntentId,
  }: ConfirmSubscriptionRequestSchemaDTO): Promise<void> {
    try {
      const cart = await getCartExpanded();

      // Layer 1 — ownership binding (IDOR): a caller may only confirm a payment
      // that is attached to their own cart. paymentInfo.payments[] carries reference ids even
      // on the unexpanded cart, so match by .id (never .obj). Placed before both the hasNoInvoice
      // getPayment and the getCurrentPayment path, so this single check covers both branches.
      const ownsPayment = cart.paymentInfo?.payments?.some((p) => p.id === paymentReference) ?? false;
      if (!ownsPayment) {
        log.warn('Rejected subscription confirm: paymentReference not attached to caller cart.', {
          ctCartId: cart.id,
          paymentReference,
        });
        throw new Error('Payment reference does not belong to the current cart.');
      }

      const subscriptionLineItem = this.findSubscriptionLineItem(cart);
      const subscriptionParams = getSubscriptionAttributes(subscriptionLineItem.variant.attributes!);
      const { hasNoInvoice, isSendInvoice, hasTrial } = this.getSubscriptionTypes(subscriptionParams);

      if (hasNoInvoice) {
        const payment = await this.ctPaymentService.getPayment({ id: paymentReference });
        // Layer 2 — mode-aware defense-in-depth: no invoice exists in this mode.
        this.assertPaymentInterfaceMatches(payment, [paymentIntentId, subscriptionId], cart.id, paymentReference);
        await this.paymentCreationService.updateSubscriptionPaymentTransactions({
          interactionId: subscriptionId,
          payment: { ...payment, amountPlanned: { ...payment.amountPlanned, centAmount: 0 } },
          subscriptionId,
        });
      } else {
        const invoice = await this.getInvoiceFromSubscription(subscriptionId);
        const payment = await this.getCurrentPayment({ paymentReference, invoice, subscriptionParams });
        // Layer 2 — mode-aware defense-in-depth: invoice-backed modes may carry in_/sub_/pi_ in interfaceId.
        this.assertPaymentInterfaceMatches(
          payment,
          [paymentIntentId, invoice?.id, subscriptionId],
          cart.id,
          paymentReference,
        );

        // Async methods (ACH us_bank_account) leave the PaymentIntent `processing` at confirm time —
        // settlement lands later via invoice.paid / invoice.payment_failed. Write Charge/Pending (not
        // Success) so the payment is not marked paid before it settles, mirroring the one-time flow.
        // succeeded/requires_capture => synchronous card success. requires_action (microdeposit
        // verification — out of scope) / requires_payment_method must not be marked paid either.
        // send_invoice/trial are already Pending by type, so the PaymentIntent status is not consulted.
        let isAsyncProcessing = false;
        if (!isSendInvoice && !hasTrial && paymentIntentId) {
          const { status } = await stripe.paymentIntents.retrieve(paymentIntentId);
          if (status === 'processing') {
            isAsyncProcessing = true;
          } else if (status !== 'succeeded' && status !== 'requires_capture') {
            throw new Error(
              `Subscription payment is not settled (PaymentIntent status: ${status}); microdeposit verification is out of scope.`,
            );
          }
        }

        await this.paymentCreationService.updateSubscriptionPaymentTransactions({
          // Key by the invoice id (in_) so the confirm transaction matches the checkout/webhook
          // transactions and deduplicates instead of creating a parallel pi_-keyed set.
          interactionId: invoice?.id || paymentIntentId || subscriptionId,
          payment,
          subscriptionId,
          isPending: isSendInvoice || hasTrial || isAsyncProcessing,
        });
      }
    } catch (error) {
      throw wrapStripeError(error);
    }
  }

  /**
   * Layer 2 defense-in-depth for subscription confirm. Rejects when the CT payment's interfaceId
   * matches none of the server-derived references for the subscription being confirmed. Uses
   * membership (not single-value equality) so setup-intent / trial / no-invoice modes — whose
   * interfaceId carries in_/sub_ rather than pi_ — are not falsely rejected. Secondary to the
   * Layer 1 ownership binding, which is what actually closes the IDOR.
   */
  private assertPaymentInterfaceMatches(
    payment: Payment,
    validReferences: (string | undefined)[],
    ctCartId: string,
    paymentReference: string,
  ): void {
    const refs = validReferences.filter((r): r is string => Boolean(r));
    if (payment.interfaceId && !refs.includes(payment.interfaceId)) {
      log.warn('Subscription confirm: payment.interfaceId does not match any server-derived reference.', {
        ctCartId,
        paymentReference,
        interfaceId: payment.interfaceId,
      });
      throw new Error('Payment does not match the subscription being confirmed.');
    }
  }

  public async getInvoiceFromSubscription(subscriptionId: string) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['latest_invoice.payment_intent'],
    });

    if (!subscription.latest_invoice || typeof subscription.latest_invoice === 'string') {
      throw new Error(`Subscription with ID "${subscriptionId}" does not have an invoice.`);
    }

    return subscription.latest_invoice;
  }

  public async getCurrentPayment({
    paymentReference,
    invoice,
    subscriptionParams,
  }: GetCurrentPaymentProps): Promise<Payment> {
    const payment = await this.ctPaymentService.getPayment({ id: paymentReference });
    const { hasFreeAnchorDays, hasProrations, hasTrial, isSendInvoice } = this.getSubscriptionTypes(subscriptionParams);

    if (!hasTrial && !hasFreeAnchorDays && !hasProrations) {
      return payment;
    }

    let price: number = payment.amountPlanned.centAmount;

    if (hasTrial || hasFreeAnchorDays) {
      price = 0;
    } else if (hasProrations && isSendInvoice) {
      price = invoice.amount_due;
    } else if (hasProrations && !isSendInvoice) {
      price = invoice.amount_paid;
    }

    return {
      ...payment,
      amountPlanned: { ...payment.amountPlanned, centAmount: price },
    };
  }

  public getPaymentMode(cart: Cart): ConfigElementResponseSchemaDTO['paymentMode'] {
    try {
      const subscriptionLineItem = this.findSubscriptionLineItem(cart);
      const subscriptionParams = getSubscriptionAttributes(subscriptionLineItem.variant.attributes);
      const { hasTrial, hasFreeAnchorDays, isSendInvoice } = this.getSubscriptionTypes(subscriptionParams);
      if (hasTrial || hasFreeAnchorDays || isSendInvoice) {
        log.info('Subscription type is Setup Intent.');
        return 'setup';
      }

      return 'subscription';
    } catch (error) {
      log.error('Error getting payment mode', { errorMessage: error instanceof Error ? error.message : String(error) });
      return 'payment';
    }
  }

  public getSubscriptionTypes(attributes: Stripe.SubscriptionCreateParams) {
    const {
      billing_cycle_anchor,
      billing_cycle_anchor_config,
      trial_end,
      trial_period_days,
      proration_behavior,
      collection_method,
    } = attributes;
    const hasTrial = !!(trial_period_days || trial_end);
    const hasAnchorDays = !!(billing_cycle_anchor || billing_cycle_anchor_config);
    const hasFreeAnchorDays = !!(hasAnchorDays && proration_behavior === 'none');
    // Any anchor that is not free prorates its first invoice: `create_prorations` (the mapper's default) and
    // `always_invoice` alike — measured in Stripe test mode (ADR-026 addendum, E4a / E18). Until 2026-11-10 this
    // read `create_prorations` only, so an `always_invoice` anchor was treated as an ordinary subscription: the
    // confirm recorded the cart total as the planned amount though Stripe charged the prorated one.
    const hasProrations = !!(hasAnchorDays && !hasFreeAnchorDays);
    const isSendInvoice = collection_method === 'send_invoice';

    return {
      hasTrial,
      hasAnchorDays,
      hasFreeAnchorDays,
      hasProrations,
      isSendInvoice,
      //Free anchor days doesn't create an invoice
      hasNoInvoice: hasFreeAnchorDays,
    };
  }

  /**
   * A cart may carry at most one subscription line item. The create flow bills only
   * the first (`findSubscriptionLineItem`), and `getAllLineItemPrices` excludes every subscription item
   * from `add_invoice_items`, so a second subscription product is never sent to Stripe — yet it stays in
   * the cart the order is minted from. The cart-drift guard cannot fire on a cart that never changed, and
   * before ADR-026 a discount code also switched the first-cycle amount guard off, so the order was minted
   * Paid for goods Stripe never billed (the amount guard now runs on discounted invoices too, but on its own
   * it would only stop such an order after payment — this refusal fails before any money moves). The documented
   * rule (`business-rules/mixed-carts.md` Rule 4) has always assumed exactly one subscription item; this
   * enforces it before any Stripe object is created — the single point every create entry (createSetupIntent,
   * createSubscription, createSubscriptionFromSetupIntent) shares through `prepareSubscriptionData`.
   * Supporting several subscriptions per cart is a separate product decision, not a silent drop.
   */
  private assertSingleSubscriptionLineItem(cart: Cart): void {
    const subscriptionLineItems = cart.lineItems.filter(
      (item) => item.productType.obj?.name === productTypeSubscription.name,
    );

    if (subscriptionLineItems.length > 1) {
      // Surface the rejection server-side: a multi-subscription cart is a financial-integrity attempt
      // (pre-fix it minted a Paid order for an unbilled item), so operators should
      // see a storefront submitting one. Mirrors the reconcile guard's logging.
      log.warn('Subscription creation rejected: cart carries more than one subscription line item.', {
        ctCartId: cart.id,
        subscriptionLineItemCount: subscriptionLineItems.length,
      });
      throw new Errorx({
        code: 'MultipleSubscriptionsNotSupported',
        message:
          'A cart may contain at most one subscription item. Remove the additional subscription product(s) and try again.',
        httpErrorStatus: 400,
        fields: { ctCartId: cart.id, subscriptionLineItemCount: subscriptionLineItems.length },
      });
    }
  }

  /**
   * A negative (credit) custom line item is not billed on the subscription first invoice — billing credits is
   * a separate decision — and dropping it would leave the invoice above the cart
   * total (an overcharge). Reject the cart here — before any Stripe Price or Product is created — rather
   * than fail mid-way through subscription creation and leave orphaned Stripe objects behind. (Not because
   * Stripe cannot take it: measured 2026-11-10, a negative `add_invoice_items` amount is accepted and an
   * invoice-wide coupon discounts it exactly, so supporting credits needs no new Stripe mechanism.)
   */
  private assertNoNegativeCustomLineItem(cart: Cart): void {
    const negative = (cart.customLineItems ?? []).find((item) => item.money.centAmount < 0);
    if (!negative) {
      return;
    }

    log.warn('Subscription creation rejected: cart carries a negative (credit) custom line item.', {
      ctCartId: cart.id,
      customLineItemSlug: negative.slug,
      unitAmount: negative.money.centAmount,
    });
    throw new Errorx({
      code: 'NegativeCustomLineItemNotSupported',
      message:
        'A credit (negative custom line item) cannot be billed on a subscription first invoice. ' +
        'Remove the negative custom line item and try again.',
      httpErrorStatus: 400,
      fields: { ctCartId: cart.id, customLineItemSlug: negative.slug, unitAmount: negative.money.centAmount },
    });
  }

  /**
   * The subscription rule (ADR-026): on **every** subscription cart, what Stripe collects on the first
   * invoice must equal `cart.totalPrice`; a cart whose discounts cannot be guaranteed to satisfy that is
   * refused here, before any Stripe object is created, next to the single-subscription and negative-credit
   * assertions.
   *
   * The Stripe coupon this connector attaches is **invoice-wide** — it discounts every line of the first
   * invoice. It therefore stands in faithfully only for a commercetools discount that applies to the whole
   * cart total (`target: 'totalPrice'`): that lands in `cart.discountOnTotalPrice`, not in any item's price,
   * so the invoice-wide coupon reproduces it exactly once. A discount that targets some line items, shipping,
   * a multi-buy set or a pattern reduces a different scope, and the line items are billed at their own
   * `price.discounted ?? price.value` (the product sale price, never a cart-level line discount), so Stripe
   * would collect a different amount than `cart.totalPrice`. The one exception is a cart whose first invoice
   * holds a single line: there a relative line-item code reduces the same scope as the coupon (ADR-026
   * addendum, 2026-11-10; the coupon service's `isSingleLineRelativeCode`).
   *
   * Refused (the decided rule, 2026-11-04, amended 2026-11-10):
   *   1. a **coded** discount commercetools applies that an invoice-wide coupon cannot reproduce on this cart
   *      (`!translatesToWholeInvoiceCoupon`, owned by the coupon service — ADR-018);
   *   2. **more than one** code — Stripe applies its `discounts` array in order while
   *      commercetools stacks by `sortOrder`, so two codes can total differently (sorting to match is a follow-up);
   *   3. any **applied cart discount that is not the accepted code's** — an automatic (config-driven) or a
   *      direct (code-less) discount — landing on the cart total, a line item or shipping. commercetools
   *      records every applied discount on the cart, so these ARE detectable: in
   *      `discountOnTotalPrice.includedDiscounts`,
   *      `lineItems[].discountedPricePerQuantity[].discountedPrice.includedDiscounts` and
   *      `shippingInfo.discountedPrice.includedDiscounts`. A discount landing **only on custom line items** is
   *      allowed — the fee is billed at its already-discounted `totalPrice`, so it bills correctly. (A product
   *      discount, `price.discounted`, is not a cart discount and does not appear in these portions.)
   *
   * Each applied portion is matched against the accepted code's own cart discount(s), not refused on mere
   * presence, so a normal one-total-price-code cart stays billable even if commercetools surfaced that code's
   * own discount on an item portion (a staging `GET` of such a cart is on the ADR-026 certification gate).
   *
   * A discount the connector cannot reproduce is refused before payment. Where the first-cycle amount guard
   * applies (first invoice, `charge_automatically`, no trial, not prorated, amount billed > 0), a mismatch
   * that still occurs — anything unforeseen — blocks the order (paid, no order, collection held per ADR-027,
   * reconciled by hand).
   * Outside it (trial, `send_invoice`, zero or prorated first invoice) a mismatch is created and logged. So
   * this refusal exists to fail *before* money moves. Timing-driven refusals (trial, prorated anchor) are in
   * `assertCodeBillableOnSubscriptionTiming`.
   */
  private assertSupportedSubscriptionDiscounts(cart: Cart): void {
    const appliedCodes = cart.discountCodes.filter((code) => code.state === 'MatchesCart');

    // 1. A code commercetools applies that an invoice-wide coupon cannot reproduce on this cart (or whose target
    //    cannot be read) — the coupon service decides, for this path and for getStripeCoupons alike.
    const nonTotalCode = appliedCodes.find(
      (code) => !this.stripeCouponService.translatesToWholeInvoiceCoupon(code, cart),
    );
    if (nonTotalCode) {
      this.refuseSubscriptionDiscount(cart, {
        reason: 'unsupported-code-target',
        ctDiscountCodeId: nonTotalCode.discountCode.id,
      });
    }

    // 2. More than one code — unsafe stacking order between Stripe and commercetools.
    if (appliedCodes.length > 1) {
      this.refuseSubscriptionDiscount(cart, { reason: 'multiple-codes', codeCount: appliedCodes.length });
    }

    // 3. Any applied cart discount that is not the accepted code's own, on the total / line items / shipping.
    const acceptedDiscountIds = new Set(
      appliedCodes.flatMap((code) => (code.discountCode.obj?.cartDiscounts ?? []).map((cd) => cd.id)),
    );
    const foreignDiscountId = this.findUnrepresentedCartDiscount(cart, acceptedDiscountIds);
    if (foreignDiscountId) {
      this.refuseSubscriptionDiscount(cart, { reason: 'unrepresented-cart-discount', ctDiscountId: foreignDiscountId });
    }
  }

  /**
   * The id of the first applied cart discount this connector does not represent on the first invoice: one on
   * the cart total, a line item or shipping whose id is not the accepted code's. Custom-line-item portions
   * are excluded (the fee carries its discount in its own `totalPrice`). `undefined` when every applied
   * discount is either the accepted code's or lands only on custom line items.
   */
  private findUnrepresentedCartDiscount(cart: Cart, acceptedDiscountIds: Set<string>): string | undefined {
    const appliedDiscountIds: string[] = [
      ...(cart.discountOnTotalPrice?.includedDiscounts ?? []).map((portion) => portion.discount.id),
      ...cart.lineItems.flatMap((lineItem) =>
        (lineItem.discountedPricePerQuantity ?? []).flatMap((perQuantity) =>
          perQuantity.discountedPrice.includedDiscounts.map((portion) => portion.discount.id),
        ),
      ),
      ...(cart.shippingInfo?.discountedPrice?.includedDiscounts ?? []).map((portion) => portion.discount.id),
    ];
    return appliedDiscountIds.find((id) => !acceptedDiscountIds.has(id));
  }

  /**
   * ADR-026 addendum (2026-11-10): a code Stripe cannot bill as the cart says *because of when the subscription
   * bills*, whatever the code's target. Measured in test mode on the connector's API version:
   *
   *   - **prorated anchor** (`hasProrations`: a billing anchor that is not free — `create_prorations`, the mapper's
   *     default when an anchor is set, or `always_invoice`): the `once` coupon is spent on the prorated first
   *     invoice and Stripe discounts neither
   *     the proration line nor the next cycle — it reaches only one-time lines, or nothing;
   *   - **trial with something billed during the trial** (a one-time line item or a positive fee, both billed as
   *     `add_invoice_items` on the trial invoice): the coupon is spent on that invoice, so the first paid cycle
   *     is billed in full, and an absolute coupon's remainder is lost.
   *
   * Accepted, because Stripe bills the quote: a trial cart with only the subscription (and shipping, which is a
   * subscription item — free during the trial like the subscription), where the coupon lands on the first paid
   * cycle; and a free anchor (`proration_behavior: none`), where everything is billed, discounted, at the anchor.
   * Supporting the refused shapes (item-level coupons that survive a trial) is a follow-up.
   */
  private assertCodeBillableOnSubscriptionTiming(cart: Cart, subscriptionParams: Stripe.SubscriptionCreateParams) {
    const appliedCodes = cart.discountCodes.filter((code) => code.state === 'MatchesCart');
    if (!appliedCodes.length) {
      return;
    }

    const { hasTrial, hasProrations } = this.getSubscriptionTypes(subscriptionParams);
    if (hasProrations) {
      this.refuseSubscriptionDiscount(cart, { reason: 'code-on-prorated-anchor' });
    }

    const billsDuringTrial =
      cart.lineItems.some((item) => item.productType.obj?.name !== productTypeSubscription.name) ||
      (cart.customLineItems ?? []).some((item) => item.totalPrice.centAmount > 0);
    if (hasTrial && billsDuringTrial) {
      this.refuseSubscriptionDiscount(cart, { reason: 'code-on-trial-with-one-time-charges' });
    }
  }

  private refuseSubscriptionDiscount(cart: Cart, detail: { reason: string } & Record<string, unknown>): never {
    // The ids stay here, in the server log; the response carries the code and the reason only.
    log.warn('Subscription creation rejected: the cart carries a discount Stripe cannot bill as the cart says.', {
      ctCartId: cart.id,
      ...detail,
    });
    throw StripeCouponService.unsupportedSubscriptionDiscountError(detail.reason);
  }

  /**
   * The create paths' catch: a refusal of our own (an `Errorx` thrown before or between Stripe calls) passes
   * through untouched; anything else goes to `wrapStripeError`. The HTTP response is unchanged — the wrapper
   * already returned non-Stripe errors as they were — but a refusal no longer logs "Unexpected error calling
   * Stripe API", which sent an operator to the wrong system (same shortcut as `stripe-payment.service.ts`).
   */
  private passOwnRefusal(error: unknown): Error {
    if (error instanceof Errorx) {
      return error;
    }
    return wrapStripeError(error);
  }

  private findSubscriptionLineItem(cart: Cart): LineItem {
    const subscriptionLineItem = cart.lineItems.find((item) => {
      const isSubscription = item.productType.obj?.name === productTypeSubscription.name;
      if (isSubscription) {
        return item;
      }
    });

    if (!subscriptionLineItem) {
      throw new Error('No subscription product found in cart.');
    }

    return subscriptionLineItem;
  }

  public getSubscriptionPaymentAmount(cart: Cart): ExtendedPaymentAmount {
    const product = this.findSubscriptionLineItem(cart);
    const { currencyCode, fractionDigits } = product.price.value;

    // Prefer the product sale price (price.discounted) so the recurring Stripe Price reflects the
    // real amount charged. Without a discount this equals price.value (unchanged behavior).
    const centAmount = product.price.discounted?.value.centAmount ?? product.price.value.centAmount;
    const totalCentAmount = centAmount * product.quantity;

    return { centAmount, totalCentAmount, currencyCode, fractionDigits };
  }

  async getCustomerSubscriptions(customerId: string): Promise<Stripe.Subscription[]> {
    const customer = await getCustomerById(customerId);

    const stripeCustomerId = customer?.custom?.fields?.[stripeCustomerIdFieldName];
    if (!stripeCustomerId) {
      log.warn(`No Stripe customer ID found for customer ${customerId}`);
      throw new Error(`No Stripe customer ID found for customer ${customerId}`);
    }

    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: stripeCustomerId,
        expand: ['data.latest_invoice', 'data.default_payment_method'],
      });

      log.info(`Retrieved ${subscriptions.data.length} subscriptions for customer ${customerId}`);
      return subscriptions.data;
    } catch (error) {
      log.error(`Failed to retrieve subscriptions for customer ${customerId}`, {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Failed to retrieve subscriptions for customer ${customerId}: ${error}`);
    }
  }

  async cancelSubscription({
    customerId,
    subscriptionId,
  }: {
    customerId: string;
    subscriptionId: string;
  }): Promise<SubscriptionModifyResponseSchemaDTO> {
    await this.validateCustomerSubscription(customerId, subscriptionId);

    try {
      const canceledSubscription = await stripe.subscriptions.cancel(
        subscriptionId,
        {
          invoice_now: false,
          prorate: true,
        },
        { idempotencyKey: randomUUID() },
      );

      log.info(`Successfully canceled subscription ${subscriptionId} for customer ${customerId}`);

      //TODO cancel the subscription in commercetools. Get the cart associated with this subscription (if available from metadata)
      /*const cartId = canceledSubscription.metadata?.cartId;
      let merchantReturnUrl = getConfig().merchantReturnUrl;*/

      return {
        id: canceledSubscription.id,
        status: canceledSubscription.status,
        outcome: SubscriptionOutcome.CANCELED,
        message: `Subscription ${subscriptionId} has been successfully canceled.`,
      };
    } catch (error) {
      log.error(`Failed to cancel subscription ${subscriptionId}`, {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw wrapStripeError(error);
    }
  }

  async updateSubscription({
    customerId,
    subscriptionId,
    newSubscriptionVariantId,
    newSubscriptionPriceId,
    newSubscriptionVariantPosition,
  }: {
    customerId: string;
    subscriptionId: string;
    newSubscriptionVariantId: string;
    newSubscriptionPriceId: string;
    newSubscriptionVariantPosition: number;
  }): Promise<Stripe.Subscription> {
    await this.validateCustomerSubscription(customerId, subscriptionId);

    try {
      // Get the current subscription from Stripe to ensure it exists
      const currentSubscription = await stripe.subscriptions.retrieve(subscriptionId);

      if (!currentSubscription.items?.data?.length) {
        throw new Error(`Subscription ${subscriptionId} has no items to update`);
      }

      const subscriptionItem = currentSubscription.items.data[0];
      const currentPrice = subscriptionItem.price;

      // Get the product by ID
      const newVariantProduct = await getProductById(newSubscriptionVariantId);
      if (!newVariantProduct) {
        throw new Error(`Product with ID ${newSubscriptionVariantId} not found in commercetools`);
      }

      // Get the variant by position (1 = master variant, other = variants array)
      const newVariant = this.getVariantByPosition(
        newVariantProduct,
        newSubscriptionVariantPosition,
        newSubscriptionVariantId,
      );

      // Check for subscription attributes on the selected variant
      if (!newVariant.attributes) {
        throw new Error(
          `No subscription attributes found on variant ${newSubscriptionVariantPosition} in product ${newSubscriptionVariantId}`,
        );
      }

      // Get the specific commercetools price by ID from the product
      const ctPrice = getPriceFromProduct(newVariantProduct, newSubscriptionPriceId);
      if (!ctPrice) {
        throw new Error(`No price found with ID ${newSubscriptionPriceId} in product ${newSubscriptionVariantId}`);
      }
      log.debug(`Retrieved price: ${ctPrice.centAmount} ${ctPrice.currencyCode}`);
      // Create a proper cart with the actual product variant and price
      const cart = await createCartWithProduct(
        newVariantProduct,
        newVariant,
        ctPrice,
        newSubscriptionPriceId,
        subscriptionId,
        subscriptionItem.quantity || 1,
      );
      log.debug(`Cart created: ${cart.id} with ${cart.lineItems.length} line items`);
      // Use the existing method to get or create the Stripe price
      const stripePriceId = await this.getCreateSubscriptionPriceId(cart, ctPrice);
      log.debug(`Stripe price ID: ${stripePriceId}`);
      // Update the subscription with the Stripe price ID and new configuration
      const subscriptionParams = getSubscriptionUpdateAttributes(newVariant.attributes);
      const updatedSubscription = await stripe.subscriptions.update(
        subscriptionId,
        {
          items: [
            {
              id: subscriptionItem.id,
              price: stripePriceId, // Use the Stripe price ID we found/created
              quantity: subscriptionItem.quantity || 1, // Use current subscription quantity
            },
          ],
          // Apply the new subscription configuration from the selected variant attributes
          ...subscriptionParams,
        },
        { idempotencyKey: randomUUID() },
      );

      log.info(`Successfully updated subscription ${subscriptionId} for customer ${customerId}`, {
        updatedSubscriptionId: updatedSubscription.id,
        oldPriceId: currentPrice.id,
        newPriceId: newSubscriptionPriceId,
        oldAmount: currentPrice.unit_amount,
        newAmount: 'Using provided price ID',
        newConfiguration: {
          ...subscriptionParams,
          productId: newSubscriptionVariantId,
          variantPosition: newSubscriptionVariantPosition,
          variantType: newSubscriptionVariantPosition === 1 ? 'masterVariant' : 'variant',
          quantity: subscriptionItem.quantity || 1,
        },
      });

      return updatedSubscription;
    } catch (error) {
      log.error(`Failed to update subscription ${subscriptionId}`, {
        errorMessage: error instanceof Error ? error.message : String(error),
        customerId,
        newVariantId: newSubscriptionVariantId,
        newPriceId: newSubscriptionPriceId,
        variantPosition: newSubscriptionVariantPosition,
      });
      throw wrapStripeError(error);
    }
  }

  /**
   * Retrieves a product variant by its position (1 for master variant, other values for variants array).
   * @param product - The commercetools product containing the variants
   * @param variantPosition - The position of the variant (1 = master variant)
   * @param productId - The product ID for error messages
   * @returns The product variant at the specified position
   * @throws Error if no variant is found at the specified position
   */
  private getVariantByPosition(product: Product, variantPosition: number, productId: string): ProductVariant {
    let variant;
    if (variantPosition === 1) {
      variant = product.masterData?.current?.masterVariant;
      log.warn(`Using master variant: ${variant?.id || 'Not found'}, sku: ${variant?.sku || 'Unknown'}`);
    } else {
      variant = product.masterData?.current?.variants?.find((v) => v.id === variantPosition);
      log.warn(`Found variant: ${variant?.id || 'Not found'}, sku: ${variant?.sku || 'Unknown'}`);
    }
    log.warn(`newVariant: ${JSON.stringify(variant, null, 2)}`);

    if (!variant) {
      throw new Error(`No variant found with ID ${variantPosition} in product ${productId}`);
    }

    return variant;
  }

  async patchSubscription({
    customerId,
    subscriptionId,
    params,
    options,
  }: {
    customerId: string;
    subscriptionId: string;
    params?: Stripe.SubscriptionUpdateParams;
    options?: Stripe.RequestOptions;
  }): Promise<Stripe.Subscription> {
    const idempotencyKey = options?.idempotencyKey || randomUUID();
    await this.validateCustomerSubscription(customerId, subscriptionId);

    try {
      // Never forward the caller-supplied `options` object into the SDK request options: on
      // stripe-node <22 a caller-controlled `host` redirects this secret-bearing request to an
      // untrusted host. Only the derived idempotencyKey is passed through. (idempotencyKey is
      // still sourced from options?.idempotencyKey above.)
      const updatedSubscription = await stripe.subscriptions.update(subscriptionId, params, {
        idempotencyKey: idempotencyKey,
      });
      log.info(
        `Successfully updated subscription ${subscriptionId} for customer ${customerId}`,
        {
          updatedSubscriptionId: updatedSubscription.id,
          changes: JSON.stringify(params),
        },
        { idempotencyKey: idempotencyKey },
      );

      return updatedSubscription;
    } catch (error) {
      log.error(`Failed to update subscription ${subscriptionId}`, {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw wrapStripeError(error);
    }
  }

  public async updateSubscriptionMetadata({
    subscriptionId,
    cart,
    ctPaymentId,
    customerId,
  }: UpdateSubscriptionMetadataProps): Promise<void> {
    if (!subscriptionId) {
      log.warn('No subscription ID provided for metadata update. Skipping update.');
      return;
    }

    try {
      const metadata: Record<string, string> = {};

      if (cart) {
        metadata[METADATA_CART_ID_FIELD] = cart.id;
        metadata[METADATA_PROJECT_KEY_FIELD] = getConfig().projectKey;
        if (cart.customerId) {
          metadata[METADATA_CUSTOMER_ID_FIELD] = cart.customerId;
        }
      }

      if (ctPaymentId) {
        metadata[METADATA_PAYMENT_ID_FIELD] = ctPaymentId;
      }

      if (customerId) {
        metadata[METADATA_CUSTOMER_ID_FIELD] = customerId;
      }

      if (Object.keys(metadata).length === 0) {
        log.warn('No metadata fields to update. Skipping subscription metadata update.');
        return;
      }

      await stripe.subscriptions.update(subscriptionId, { metadata }, { idempotencyKey: randomUUID() });

      log.info(`Subscription metadata updated successfully for subscription ${subscriptionId}`, {
        subscriptionId,
        metadataFields: Object.keys(metadata),
        metadataValues: metadata,
      });
    } catch (error) {
      log.error(`Failed to update subscription metadata for subscription ${subscriptionId}`, {
        errorMessage: error instanceof Error ? error.message : String(error),
        subscriptionId,
        ctPaymentId,
        customerId,
        cartId: cart?.id,
      });
      throw wrapStripeError(error);
    }
  }

  async validateCustomerSubscription(customerId: string, subscriptionId: string): Promise<void> {
    const subscriptions = await this.getCustomerSubscriptions(customerId);
    const subscription = subscriptions.find((sub) => sub.id === subscriptionId);

    if (!subscription) {
      throw new Error(`Subscription ${subscriptionId} does not belong to customer ${customerId}`);
    }
    log.info(`Subscription ${subscriptionId} is valid for customer ${customerId}`, {
      subscriptionStatus: subscription.status,
    });
  }

  public async processSubscriptionEventPaid(event: Stripe.Event): Promise<void> {
    log.info('Processing subscription processSubscriptionEventPaid notification', {
      event: JSON.stringify(event.id),
    });

    try {
      const dataInvoiceId = (event.data.object as Stripe.Invoice).id;
      if (!dataInvoiceId) {
        log.error('Cannot process event: Missing invoice ID in event data.');
        return;
      }

      const invoiceExpanded = await this.paymentCreationService.getStripeInvoiceExpanded(dataInvoiceId);

      const subscription = invoiceExpanded.parent?.subscription_details?.subscription as Stripe.Subscription;
      const invoicePaymentIntent = invoiceExpanded.payment_intent as Stripe.PaymentIntent;
      const paymentId = await this.resolvePaymentIdFromSubscription(subscription, dataInvoiceId);
      if (!paymentId) {
        log.error(
          `Cannot process invoice with ID: ${invoiceExpanded.id}. Missing payment ID in subscription metadata.`,
        );
        return;
      }

      let payment = await this.ctPaymentService.getPayment({
        id: paymentId,
      });
      if (!payment) {
        log.error(`Cannot process invoice with ID: ${invoiceExpanded.id}. Missing Payment can be trial days.`);
        return;
      }
      const failedPaymentIntent = !invoicePaymentIntent
        ? []
        : await this.ctPaymentService.findPaymentsByInterfaceId({
            interfaceId: invoicePaymentIntent.id,
          });
      const isPaymentFailed = failedPaymentIntent.length > 0;
      if (failedPaymentIntent.length > 0) {
        payment = failedPaymentIntent[0];
      }
      const isPaymentChargePending = this.ctPaymentService.hasTransactionInState({
        payment,
        transactionType: PaymentTransactions.CHARGE,
        states: [PaymentStatus.PENDING],
      });
      const isFirstSubscriptionCycle = invoiceExpanded.billing_reason === 'subscription_create';
      const updateData = this.subscriptionEventConverter.convert(
        event,
        invoiceExpanded,
        isPaymentChargePending,
        payment,
      );
      const shouldContinue = await this.handleOrderProcessingForPaidEvent(
        subscription,
        invoiceExpanded,
        payment,
        updateData,
        isPaymentChargePending,
        isPaymentFailed,
        isFirstSubscriptionCycle,
      );
      if (!shouldContinue) {
        return;
      }
      for (const tx of updateData.transactions) {
        const updatedPayment = await this.ctPaymentService.updatePayment({
          ...updateData,
          transaction: tx,
        });

        log.info('Subscription payment updated after processing the notification', {
          paymentId: updatedPayment.id,
          version: updatedPayment.version,
          pspReference: updateData.pspReference,
          paymentMethod: updateData.paymentMethod,
          transaction: JSON.stringify(tx),
        });
      }

      if (isPaymentChargePending || isPaymentFailed || isFirstSubscriptionCycle) {
        await this.createSubscriptionOrderFromCart({
          paymentId: payment.id,
          charge: invoiceExpanded.charge as Stripe.Charge,
          paymentIntentId: updateData.pspReference,
          invoice: invoiceExpanded,
          subscription,
          paymentState: OrderPaymentState.PAID,
        });
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : JSON.stringify(e);
      log.error(`Error processing Subscription processSubscriptionEventPaid notification: ${errorMessage}`);
      if (e instanceof SubscriptionHoldFailedError || RETRYABLE_CT_ERROR.test(errorMessage)) {
        // transient CT-write failure, or ADR-027: the hold on a blocked first cycle failed transiently
        // (its Stripe pause, or the CT flag after it) — let Stripe redeliver instead of a silent 200.
        throw e;
      }
      return;
    }
  }

  /**
   * Handles order processing for paid subscription events.
   * Runs only when the payment is not pending and not failed; then determines whether to create
   * a new order or add payment to existing order based on configuration.
   * @param subscription - The Stripe subscription
   * @param invoiceExpanded - The expanded Stripe invoice
   * @param payment - The commercetools payment
   * @param updateData - The payment update data (mutated if new order is created)
   * @param isPaymentChargePending - Whether payment charge is pending
   * @param isPaymentFailed - Whether payment has failed
   * @param isFirstSubscriptionCycle - Whether the invoice belongs to the first billing cycle (`billing_reason: subscription_create`)
   * @returns True if processing should continue, false if caller should return early
   */
  private async handleOrderProcessingForPaidEvent(
    subscription: Stripe.Subscription,
    invoiceExpanded: StripeInvoiceExpanded,
    payment: Payment,
    updateData: StripeEventUpdatePayment,
    isPaymentChargePending: boolean,
    isPaymentFailed: boolean,
    isFirstSubscriptionCycle: boolean,
  ): Promise<boolean> {
    if (!isPaymentChargePending && !isPaymentFailed) {
      if (isFirstSubscriptionCycle) {
        // First cycle: no previous order exists to clone or attach to — the caller
        // creates the order from the frozen cart via createSubscriptionOrderFromCart.
        log.info(`First subscription cycle for payment ${updateData.id}, order will be created from the frozen cart`, {
          invoiceId: invoiceExpanded.id,
        });
        return true;
      }
      const config = getConfig();
      const shouldCreateNewOrder = config.subscriptionPaymentHandling === 'createOrder';
      if (shouldCreateNewOrder) {
        log.info(
          `Creating new order for subscription payment ${updateData.id} (config: ${config.subscriptionPaymentHandling})`,
        );
        updateData.id = await this.handleSubscriptionPaymentCreateNewOrder(
          subscription,
          invoiceExpanded,
          updateData,
          OrderPaymentState.PAID,
        );
        log.info(`New order created successfully for subscription payment ${updateData.id}`);
      } else {
        log.info(
          `Adding payment to existing order for subscription payment ${updateData.id} (config: ${config.subscriptionPaymentHandling})`,
        );
        const success = await this.handlePaidSubscriptionPaymentWithCart(
          invoiceExpanded,
          subscription,
          payment,
          updateData,
        );
        if (!success) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Seals the cart total onto the Stripe Subscription at creation time.
   *
   * This is the anchor the first-cycle guard compares against. It has to live on a Stripe-owned
   * object: the whole point is that the cart is mutable by the shopper between pricing
   * and `invoice.paid`, so the cart cannot be its own witness. Once written, only the connector's
   * own API key can change it.
   *
   * Stored as the NET `totalPrice`, matching what the invoice is assembled from (see the comparison
   * base note in `createSubscriptionOrderFromCart`), and alongside its currency so a currency change
   * cannot pass as an equal amount.
   */
  private sealCartTotal(cart: Cart, metadata: Record<string, string>): Record<string, string> {
    return {
      ...metadata,
      [METADATA_CART_TOTAL_AMOUNT]: String(cart.totalPrice.centAmount),
      [METADATA_CART_TOTAL_CURRENCY]: cart.totalPrice.currencyCode,
    };
  }

  /**
   * True when the cart the order would be minted from is no longer the cart the subscription was
   * priced from. Compares against the total sealed into the subscription's metadata at creation.
   *
   * This asks a strictly narrower question than the amount check, with no Stripe arithmetic in it: "is
   * this the same cart". The amount check asks "does what Stripe collected equal the cart total"; under
   * ADR-026 it now runs on discounted invoices too, and only a single total-price coupon can reach it, so
   * its translation is exact within the per-line rounding tolerance. This drift check complements it for
   * the shapes the amount guard still exempts (a trial or zero first invoice on an enlarged cart): a
   * translation gap cannot make it false, and enlarging the cart cannot make it true.
   *
   * Returns false when the seal is absent — subscriptions created before this shipped keep exactly
   * their previous behaviour rather than being blocked wholesale on their first renewal.
   */
  private cartDriftedFromPricedTotal(
    cart: Cart,
    subscription: Stripe.Subscription | undefined,
  ): { drifted: boolean; pricedAmount?: number; pricedCurrency?: string } {
    const sealedAmount = subscription?.metadata?.[METADATA_CART_TOTAL_AMOUNT];
    const sealedCurrency = subscription?.metadata?.[METADATA_CART_TOTAL_CURRENCY];
    if (sealedAmount === undefined || sealedCurrency === undefined) {
      return { drifted: false };
    }

    const pricedAmount = Number(sealedAmount);
    if (!Number.isInteger(pricedAmount)) {
      // A malformed seal is not evidence of an attack; fall back rather than block a real order.
      log.warn('Subscription carries a non-numeric sealed cart total — drift check skipped.', {
        stripeSubscriptionId: subscription?.id,
        sealedAmount,
      });
      return { drifted: false };
    }

    const drifted =
      cart.totalPrice.centAmount !== pricedAmount ||
      cart.totalPrice.currencyCode.toLowerCase() !== sealedCurrency.toLowerCase();

    return { drifted, pricedAmount, pricedCurrency: sealedCurrency };
  }

  /**
   * True only for the exact configuration in which the first subscription invoice MUST equal the cart
   * total, so a divergence is provably an amount shortfall rather than a supported billing shape. Every
   * condition is read from Stripe-owned data (the invoice and the subscription), never from the cart,
   * because the cart is precisely what an untrusted caller mutates.
   *
   * Outside this configuration a first invoice legitimately differs from the cart total, so the caller
   * logs and still creates the order rather than rejecting honest business:
   *   - trial / free anchor days → first invoice is zero or amount_due-based, not the cart total
   *   - `send_invoice` → the invoice is paid out of band, later, against a cart that has moved on
   *   - recurring cycles (`billing_reason !== 'subscription_create'`) → priced from the subscription
   *     items, not from this cart at all
   *
   *   - a prorated first invoice (a billing anchor that is not free: `create_prorations` or `always_invoice`) → Stripe bills the part of the
   *     period up to the anchor, not the cart's full price (ADR-026 addendum, 2026-11-10)
   *
   * A discounted first invoice is NO LONGER exempt (ADR-026). The subscription rule refuses every discount
   * the invoice-wide coupon cannot reproduce before any Stripe object is created, so a discounted first
   * invoice must still total `cart.totalPrice` — within the 1-minor-unit rounding tolerance the comparison
   * applies. The old exemption existed only while an unverified coupon translation could reject a legitimate
   * order (a false-positive failure mode); the refusal plus the tolerance remove that risk, and dropping the
   * exemption closes the hole where adding any discount code switched the amount guard off.
   *
   * `total > 0` additionally excludes the zero-invoice shapes (free anchor days, zero trial invoice) without
   * needing `proration_behavior`, which Stripe does not persist on the Subscription. It reads the invoice
   * total, not `amount_paid`, so an invoice paid in part from the customer's credit balance is still checked.
   */
  private isFirstCycleAmountGuardApplicable(
    invoice: StripeInvoiceExpanded,
    subscription: Stripe.Subscription | undefined,
  ): boolean {
    // A missing/unexpanded subscription means the trial shape cannot be ruled out — log-only, since
    // this object comes from Stripe and is not something a shopper can suppress to escape the guard.
    if (!subscription) {
      return false;
    }

    const isFirstCycle = invoice.billing_reason === 'subscription_create';
    const isChargeAutomatically = invoice.collection_method === 'charge_automatically';
    const hasTrial = !!subscription.trial_end;
    const billsRealMoney = invoice.total > 0;

    return (
      isFirstCycle &&
      isChargeAutomatically &&
      !hasTrial &&
      billsRealMoney &&
      !this.isProratedFirstInvoice(invoice, subscription)
    );
  }

  /**
   * A first invoice Stripe prorated up to a billing anchor (ADR-026 addendum, 2026-11-10, A3). Both signals are
   * Stripe-owned — set by the product's anchor attributes, never by the shopper's cart — and either suffices:
   * a line Stripe marks as a proration (`parent.subscription_item_details.proration`), or an anchor that is not
   * the start date — whatever the proration behaviour, and as the subscription is when `invoice.paid` runs.
   * Measured in test mode: anchor +10 d with `create_prorations` (or `always_invoice`) bills 968 for a 3000 item and
   * marks its line `proration: true`. Exempting it from the amount comparison does not open a discount hole:
   * a code on a prorated anchor is refused before payment (assertCodeBillableOnSubscriptionTiming), and the
   * cart-drift guard still runs.
   */
  private isProratedFirstInvoice(invoice: StripeInvoiceExpanded, subscription: Stripe.Subscription): boolean {
    const hasProrationLine = (invoice.lines?.data ?? []).some(
      (line) => line.parent?.subscription_item_details?.proration === true,
    );
    const anchoredAwayFromStart =
      !!subscription.billing_cycle_anchor &&
      !!subscription.start_date &&
      subscription.billing_cycle_anchor !== subscription.start_date;
    return hasProrationLine || anchoredAwayFromStart;
  }

  /**
   * Shared method for subscription order creation that replaces duplicated tail blocks.
   * Checks cart state, warns on unfrozen carts, updates address, validates the amount actually
   * collected against the cart the order is minted from, and creates the order with a defensive
   * try/catch for concurrent-write conditions (e.g., invoice.paid vs charge.succeeded).
   * @param params.paymentId - The commercetools payment ID to look up the cart
   * @param params.charge - The Stripe charge for address update
   * @param params.paymentIntentId - The PSP reference for the order
   * @param params.invoice - The expanded Stripe invoice (amount actually collected + logging)
   * @param params.subscription - The Stripe subscription, when available (guard applicability)
   * @param params.paymentState - The payment state for the order
   * @returns True if order was created, false if skipped or failed gracefully
   */
  private async createSubscriptionOrderFromCart(params: {
    paymentId: string;
    charge: Stripe.Charge;
    paymentIntentId: string;
    invoice: StripeInvoiceExpanded;
    subscription?: Stripe.Subscription;
    paymentState?: OrderPaymentState;
  }): Promise<boolean> {
    const { paymentId, charge, paymentIntentId, invoice, subscription, paymentState = OrderPaymentState.PAID } = params;
    const invoiceId = invoice.id;

    const cart = await this.ctCartService.getCartByPaymentId({ paymentId });
    if (cart.cartState === 'Ordered') {
      log.info('Cart already ordered, skipping subscription order creation', {
        ctCartId: cart.id,
        invoiceId,
      });
      return false;
    }

    if (!isCartFrozen(cart)) {
      log.warn(
        'Processing subscription order for unfrozen cart — payment may not have originated from this connector.',
        {
          ctCartId: cart.id,
          paymentId,
          invoiceId,
        },
      );
    }

    const isPaidOrder = paymentState === OrderPaymentState.PAID;
    // Cart-drift guard. Deliberately NOT subject to isFirstCycleAmountGuardApplicable's exemptions (trial,
    // send_invoice, recurring cycle, zero invoice): those exist because a first invoice may legitimately
    // differ from the cart TOTAL, which is a statement about arithmetic. Drift is a statement about identity
    // — whether this is still the cart that was priced — and no billing shape makes an enlarged cart
    // legitimate. It is defence in depth alongside the amount guard, which under ADR-026 now runs on
    // discounted invoices too, so a discount code no longer switches the amount check off (the hole the
    // chain reached). This guard still matters for the shapes the amount guard exempts (a trial or
    // zero first invoice on an enlarged cart).
    //
    // Evaluated on the cart as read at webhook time, BEFORE updateCartAddress, so an address-driven shipping
    // change is not read as drift. For a cart that ships, commercetools required a shipping address before a
    // shipping method, so the seal already had one; this compares the pre-address snapshot either way. The
    // post-address snapshot is what the amount check below validates.
    const drift = isPaidOrder ? this.cartDriftedFromPricedTotal(cart, subscription) : { drifted: false };
    if (drift.drifted) {
      log.error(
        'invoice.paid: the cart no longer matches the total the subscription was priced from — order NOT created (cart drift guard).',
        {
          ctCartId: cart.id,
          paymentId,
          invoiceId,
          pricedCartTotal: drift.pricedAmount,
          pricedCurrency: drift.pricedCurrency,
          currentCartTotal: cart.totalPrice.centAmount,
          currentCurrency: cart.totalPrice.currencyCode,
          stripeAmountPaid: invoice.amount_paid,
          billingReason: invoice.billing_reason,
          hasInvoiceDiscount: (invoice.discounts?.length ?? 0) > 0,
        },
      );
      await this.holdBlockedFirstCycle({ invoice, subscription, paymentId, cartId: cart.id, reason: 'cart-drift' });
      return false;
    }

    log.info('Updating cart address after processing the notification', {
      ctCartId: cart.id,
      invoiceId,
    });

    // ADR-026 addendum (2026-11-10, A2): keep a complete shipping address the shopper entered at checkout, as the
    // one-time path does. Overwriting it with the card's billing address could move the shipping
    // rate and the cart total after payment, so the amount guard below would block an honest order; and the
    // goods would ship to the billing address. A cart with no complete address still gets the charge address.
    const updatedCart = await this.paymentService.updateCartAddress(charge, cart, { preserveExistingAddress: true });

    // Subscription amount guard. The equivalent control on the one-time path
    // (handlePaymentIntentSucceededFlow, Rule 5) can never run here by construction: the webhook
    // dispatcher deliberately drops subscription-invoice payment_intent.succeeded / charge.* events
    // because invoice.paid is the single source of truth for subscription money. So this path minted a
    // Paid order from whatever the cart contained at webhook time, with nothing comparing it to what
    // Stripe actually collected — while /shipping-methods/remove unfreezes the cart and never re-freezes.
    //
    // Validated against the POST-updateCartAddress cart because that is the snapshot the order is
    // minted from, and the address is shopper-controlled. Compared against `totalPrice`, NOT
    // `taxedPrice.totalGross`: the invoice is assembled from Stripe Prices built off the line items'
    // own price values plus the shipping price, and this connector sets neither `automatic_tax` nor a
    // Stripe Tax calculation on the subscription path, so the invoice carries no tax. Using
    // `totalGross` here would reject every legitimate order in a tax-on-top configuration. (That the
    // tax never reaches the subscription invoice at all is a separate, pre-existing defect —
    // which this guard neither masks nor worsens.)
    //
    // Only the configuration in which the two figures MUST be equal is blocked; everything else is
    // logged and proceeds. A block never creates the order: the Charge/Success is already persisted
    // upstream, so the outcome is a paid-without-order state surfaced for manual reconciliation —
    // the hub rule forbids auto-correction, so there is no auto-refund here. Collection is held (ADR-027)
    // so the subscription does not keep renewing with no order while a human resolves it.
    // Applies to PAID orders only: the FAILED path creates an order precisely to record that no money
    // was collected, so there is nothing to validate an amount against.
    const guardApplies = isPaidOrder && this.isFirstCycleAmountGuardApplicable(invoice, subscription);

    if (isPaidOrder && this.shouldBlockOnAmountMismatch({ invoice, updatedCart, paymentId, guardApplies })) {
      await this.holdBlockedFirstCycle({
        invoice,
        subscription,
        paymentId,
        cartId: cart.id,
        reason: 'amount-mismatch',
      });
      return false;
    }

    try {
      await this.paymentService.createOrder({
        cart: updatedCart,
        paymentIntentId,
        paymentState,
        // Pin the version only where the guard actually validated this snapshot, so a cart that moved
        // after validation cannot still mint an order (commercetools returns 409 → the catch below
        // treats it as the race it is). Elsewhere keep the legacy re-read: pinning a version this
        // method never validated would only add 409s that drop legitimate paid orders.
        expectedVersion: guardApplies ? updatedCart.version : undefined,
      });
      return true;
    } catch (e: unknown) {
      const conflictMessage = this.getVersionConflictMessage(e);
      if (conflictMessage !== undefined) {
        log.info(
          'Subscription order creation skipped due to version conflict (likely race condition with another handler)',
          {
            ctCartId: updatedCart.id,
            invoiceId,
            errorMessage: conflictMessage,
          },
        );
        return false;
      }
      throw e;
    }
  }

  /**
   * ADR-027: hold a paid first cycle that a guard blocked from becoming an order. Without it the Stripe
   * subscription stays active and renews every month with no order in commercetools.
   *
   * A hold, not a correction (library domain rule: divergence is surfaced, never auto-corrected, because a
   * correction overwrites the record a human needs). No financial record is changed and nothing is refunded —
   * the paid invoice, the payment's amounts and transactions, and the cart stay as they are; only the payment's
   * status-interface fields are written (step 2) — and it is reversible:
   *   1. Stripe first, because it stops the money: `pause_collection: keep_as_draft` (renewals are created as
   *      drafts and not collected; measured in test mode, repeating the call is harmless, and unsetting it does
   *      not collect the paused drafts by itself), plus metadata naming the reason and the invoice. A
   *      **transient** failure (connection, Stripe 5xx, 429, 409 — `isTransientStripeError`) raises
   *      `SubscriptionHoldFailedError`, so the webhook answers non-2xx and Stripe redelivers. A **permanent** one
   *      (an invalid request: a canceled or missing subscription — measured) is logged and the flag is still
   *      written: redelivering for days cannot succeed (the ADR-015 split, applied to the Stripe call). The key
   *      is fixed, so within Stripe's 24 h idempotency window a redelivery replays the stored answer; later ones
   *      are fresh attempts.
   *   2. Then the commercetools flag: `paymentStatus.interfaceCode = subscription_order_blocked`, the same native
   *      field the ACH late-return handler uses — no custom type; a later late-return mark replaces it. When the
   *      pause succeeded, the Stripe metadata is the durable record; when Stripe refused it, the flag (or, if the
   *      flag fails too, the error log) is the only one. A transient CT failure (`isRetryableCtError`) raises
   *      `SubscriptionHoldFailedError`, so the redelivery repeats the idempotent pause and writes the flag; a
   *      permanent one is logged.
   * Only for a first cycle (`subscription_create`) with the subscription at hand. Resolution is manual
   * (the runbook in ADR-027).
   */
  private async holdBlockedFirstCycle(params: {
    invoice: StripeInvoiceExpanded;
    subscription: Stripe.Subscription | undefined;
    paymentId: string;
    cartId: string;
    reason: 'cart-drift' | 'amount-mismatch';
  }): Promise<void> {
    const { invoice, subscription, paymentId, cartId, reason } = params;
    if (!subscription?.id || invoice.billing_reason !== 'subscription_create') {
      return;
    }

    const logDetail = { ctCartId: cartId, paymentId, invoiceId: invoice.id, stripeSubscriptionId: subscription.id };
    let paused = true;
    try {
      await stripe.subscriptions.update(
        subscription.id,
        {
          pause_collection: { behavior: 'keep_as_draft' },
          metadata: { [METADATA_ORDER_BLOCKED_REASON]: reason, [METADATA_ORDER_BLOCKED_INVOICE]: invoice.id ?? '' },
        },
        // Derived from platform and provider identity, so a redelivery repeats the same request.
        { idempotencyKey: `hold-${cartId}-${invoice.id}-${reason}` },
      );
    } catch (error) {
      if (isTransientStripeError(error)) {
        log.error(
          'Blocked first cycle: pausing collection in Stripe failed (transient) — the webhook will be redelivered.',
          {
            ...logDetail,
            error: redactError(error),
          },
        );
        throw new SubscriptionHoldFailedError('Failed to pause collection on a blocked subscription.', error);
      }
      paused = false;
      log.error(
        'Blocked first cycle: Stripe refused to pause collection (permanent) — resolve by hand (ADR-027 runbook).',
        {
          ...logDetail,
          error: redactError(error),
        },
      );
    }

    if (paused) {
      log.error('Blocked first cycle: collection paused in Stripe — resolve by hand (ADR-027 runbook).', {
        ...logDetail,
        reason,
      });
    }

    try {
      const payment = await this.ctPaymentService.getPayment({ id: paymentId });
      await setPaymentStatusInterface(
        payment,
        PAYMENT_STATUS_SUBSCRIPTION_ORDER_BLOCKED,
        paused
          ? `First cycle paid, no order (${reason}); collection paused in Stripe — resolve by hand`
          : `First cycle paid, no order (${reason}); Stripe refused the pause — check the subscription, resolve by hand`,
      );
    } catch (error) {
      // ADR-015: a transient CT failure is redelivered; the pause above is idempotent, so it is safe to repeat.
      // Classified on the structured fields (a real commercetools 409 carries `ConcurrentModification` / 409 in
      // `code` and `statusCode`, not in its message — isRetryableCtError), and wrapped so the handler's catch,
      // which re-raises SubscriptionHoldFailedError, does not have to re-classify it.
      if (isRetryableCtError(error)) {
        log.error(
          'Blocked first cycle: flagging the commercetools payment failed (transient) — the webhook will be redelivered.',
          {
            ...logDetail,
            error: redactError(error),
          },
        );
        throw new SubscriptionHoldFailedError(
          'Failed to flag the commercetools payment of a blocked subscription.',
          error,
        );
      }
      log.error(
        paused
          ? 'Blocked first cycle: flagging the commercetools payment failed (the Stripe metadata records it).'
          : 'Blocked first cycle: flagging the commercetools payment failed and Stripe refused the pause — this log is the only record; resolve by hand.',
        { ...logDetail, error: redactError(error) },
      );
    }
  }

  /**
   * Compares the amount Stripe actually collected on a paid invoice against the cart total the order
   * is minted from. A mismatch blocks the order only when the amount guard applies;
   * otherwise it is logged for reconciliation and the order proceeds.
   * @param params.invoice - The expanded Stripe invoice (amount actually collected)
   * @param params.updatedCart - The post-updateCartAddress cart the order is minted from
   * @param params.paymentId - The commercetools payment ID (logging only)
   * @param params.guardApplies - Whether this billing configuration requires both figures to match
   * @returns True if the order must NOT be created, false otherwise
   */
  private shouldBlockOnAmountMismatch(params: {
    invoice: StripeInvoiceExpanded;
    updatedCart: Cart;
    paymentId: string;
    guardApplies: boolean;
  }): boolean {
    const { invoice, updatedCart, paymentId, guardApplies } = params;

    // A discounted invoice (ADR-026) carries one coupon. Stripe rounds a percentage coupon ONCE, half-up, on
    // the invoice subtotal (then spreads it over the lines); commercetools rounds with the project's
    // priceRoundingMode, HalfEven by default. The two meet within one minor unit (measured in test mode:
    // 10 % of 2925 → Stripe 293, HalfEven 292), whatever the number of lines — so the tolerance is a constant
    // 1, not one per line. An amount-off coupon is exact, so an honest amount-off invoice never needs the unit —
    // it still admits a 1-unit difference there, which is the bound of what any discounted invoice can slip.
    // No discount → exact equality.
    const isDiscountedInvoice =
      (invoice.discounts?.length ?? 0) > 0 || (invoice.total_discount_amounts?.length ?? 0) > 0;
    const toleranceMinorUnits = isDiscountedInvoice ? 1 : 0;

    // ADR-026 addendum (2026-11-10, A7): compare what Stripe BILLED (`total`, after discounts) with the cart, not
    // what it collected: `amount_paid` also moves with the customer's credit or debt balance, which is not part
    // of this checkout (measured: a −500 credit leaves `total` 2000 and `amount_paid` 1500). The divergence is
    // still surfaced, below. The CT payment keeps recording what Stripe collected.
    const rawDifference = invoice.total - updatedCart.totalPrice.centAmount;
    if (invoice.amount_paid !== invoice.total) {
      log.warn('invoice.paid: amount collected differs from the invoice total (customer balance applied).', {
        ctCartId: updatedCart.id,
        paymentId,
        invoiceId: invoice.id,
        stripeTotal: invoice.total,
        stripeAmountPaid: invoice.amount_paid,
        stripeStartingBalance: invoice.starting_balance,
        stripeEndingBalance: invoice.ending_balance,
      });
    }
    const mismatchDetail = {
      ctCartId: updatedCart.id,
      paymentId,
      invoiceId: invoice.id,
      stripeTotal: invoice.total,
      stripeAmountPaid: invoice.amount_paid,
      stripeCurrency: invoice.currency,
      cartTotalCentAmount: updatedCart.totalPrice.centAmount,
      cartCurrency: updatedCart.totalPrice.currencyCode,
      billingReason: invoice.billing_reason,
      collectionMethod: invoice.collection_method,
      toleranceMinorUnits,
      rawDifference,
    };

    if (paidAmountMatchesTotal(invoice.total, invoice.currency, updatedCart.totalPrice, toleranceMinorUnits)) {
      // Within tolerance. A non-zero rounding difference is accepted but never swallowed — the domain rule is
      // that a provider/platform divergence is logged and surfaced, even when it does not block the order.
      if (rawDifference !== 0) {
        log.warn(
          'invoice.paid: invoice total differs from the cart total within the rounding tolerance — order created, difference logged.',
          mismatchDetail,
        );
      }
      return false;
    }

    if (guardApplies) {
      log.error(
        'invoice.paid: collected amount does not match the cart total — order NOT created (subscription underpayment guard).',
        mismatchDetail,
      );
      return true;
    }
    log.warn(
      'invoice.paid: collected amount does not match the cart total, but this billing configuration allows a first invoice to differ — order created, flagged for reconciliation.',
      mismatchDetail,
    );
    return false;
  }

  /**
   * Classifies an order-creation error as a commercetools version conflict (e.g., invoice.paid racing
   * charge.succeeded for the same cart).
   * @param e - The error thrown by order creation
   * @returns The error message when it is a version conflict, undefined otherwise
   */
  private getVersionConflictMessage(e: unknown): string | undefined {
    const errorMessage = e instanceof Error ? e.message : JSON.stringify(e);
    const isVersionConflict =
      errorMessage.includes('ConcurrentModification') ||
      errorMessage.includes('version') ||
      errorMessage.includes('409');
    return isVersionConflict ? errorMessage : undefined;
  }

  /**
   * Resolves the payment ID from subscription metadata or by searching for payments by invoice ID.
   * For setup intent subscriptions, waits briefly for payment creation before searching.
   * @param subscription - The Stripe subscription to get payment ID from
   * @param invoiceId - The invoice ID to search payments by if not in metadata
   * @returns The payment ID if found, undefined otherwise
   */
  private async resolvePaymentIdFromSubscription(
    subscription: Stripe.Subscription,
    invoiceId: string,
  ): Promise<string | undefined> {
    if (subscription.metadata?.[METADATA_PAYMENT_ID_FIELD]) {
      return subscription.metadata[METADATA_PAYMENT_ID_FIELD];
    }

    // When the event comes from a setup intent subscription, we need to wait for the payment to be created
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const payments = await this.ctPaymentService.findPaymentsByInterfaceId({
      interfaceId: invoiceId,
    });

    if (payments.length > 0) {
      return payments[0].id;
    }

    return undefined;
  }

  /**
   * Handles a paid subscription payment by creating a payment and adding it to an existing cart and order.
   * Similar to handleSubscriptionPaymentWithCart but uses amount_paid instead of amount_due.
   * @param invoiceExpanded - The expanded Stripe invoice containing payment details
   * @param subscription - The Stripe subscription associated with the payment
   * @param payment - The existing commercetools payment to update
   * @param updateData - The subscription event data used for updating the payment
   * @returns True if processing was successful, false if cart ID is missing in invoice metadata
   */
  private async handlePaidSubscriptionPaymentWithCart(
    invoiceExpanded: StripeInvoiceExpanded,
    subscription: Stripe.Subscription,
    payment: Payment,
    updateData: StripeEventUpdatePayment,
  ): Promise<boolean> {
    const eventCartId = invoiceExpanded.parent?.subscription_details?.metadata?.[METADATA_CART_ID_FIELD];
    if (!eventCartId) {
      log.error(`Cannot process invoice with ID: ${invoiceExpanded.id}. Missing cart.`);
      return false;
    }

    const amountPlanned: Money = {
      currencyCode: invoiceExpanded.currency.toUpperCase(),
      centAmount: invoiceExpanded.amount_paid,
    };

    const cart = await this.ctCartService.getCart({ id: eventCartId });
    const createdPayment = await this.paymentCreationService.handleCtPaymentSubscription({
      cart,
      amountPlanned,
      interactionId: updateData.pspReference || '',
    });

    await this.handleSubscriptionPaymentAddToOrder(cart, createdPayment, subscription, payment, updateData);
    return true;
  }

  /**
   * @deprecated No longer wired for subscription payments. As of the duplicate-payment fix, the
   * webhook dispatch ignores charge.succeeded / payment_intent.* events that come from a
   * subscription invoice, because Stripe also emits invoice.paid for the same charge and routing
   * both created duplicate CT payments/orders. `processSubscriptionEventPaid` (invoice.paid) is now
   * the single source of truth for subscription payments; `processSubscriptionEventFailed`
   * (invoice.payment_failed) for failures. Kept for reference / potential reuse — pending team
   * decision on full removal. Do not re-wire without restoring first-cycle guards.
   */
  public async processSubscriptionEventCharged(event: Stripe.Event): Promise<void> {
    log.info('Processing subscription processSubscriptionEventCharged notification', {
      event: JSON.stringify(event.id),
    });
    try {
      const chargeData = event.data.object as Stripe.Charge & { invoice?: string | Stripe.Invoice | null };
      const dataInvoiceId = typeof chargeData.invoice === 'string' ? chargeData.invoice : chargeData.invoice?.id;
      if (!dataInvoiceId) {
        log.error('Cannot process event: Missing invoice ID in charge data.');
        return;
      }

      const invoiceExpanded = await this.paymentCreationService.getStripeInvoiceExpanded(dataInvoiceId);

      const subscription = invoiceExpanded.parent?.subscription_details?.subscription as Stripe.Subscription;
      const paymentId = await this.resolvePaymentIdFromSubscription(subscription, dataInvoiceId);
      if (!paymentId) {
        log.error(
          `Cannot process invoice with ID: ${invoiceExpanded.id}. Missing payment ID in subscription metadata.`,
        );
        return;
      }

      const payment = await this.ctPaymentService.getPayment({
        id: paymentId,
      });
      if (!payment) {
        log.error(`Cannot process invoice with ID: ${invoiceExpanded.id}. Missing Payment can be trial days.`);
        return;
      }
      const isPaymentChargePending = this.ctPaymentService.hasTransactionInState({
        payment,
        transactionType: PaymentTransactions.CHARGE,
        states: [PaymentStatus.PENDING],
      });
      const updateData = this.subscriptionEventConverter.convert(
        event,
        invoiceExpanded,
        isPaymentChargePending,
        payment,
      );

      if (!isPaymentChargePending) {
        const shouldContinue = await this.handleRecurringChargeOrder(
          subscription,
          invoiceExpanded,
          payment,
          updateData,
        );
        if (!shouldContinue) {
          return;
        }
      }

      for (const tx of updateData.transactions) {
        const updatedPayment = await this.ctPaymentService.updatePayment({
          ...updateData,
          transaction: tx,
        });

        log.info(`Subscription payment updated after processing the notification ${updatedPayment.id}
          paymentId: ${updatedPayment.id}
          version: ${updatedPayment.version}
          pspReference: ${updateData.pspReference}
          paymentMethod: ${updateData.paymentMethod}
          transaction: ${JSON.stringify(tx)}
        `);
      }

      if (isPaymentChargePending) {
        // Same first-cycle cart and same exposure as the invoice.paid path, so it gets the same
        // amount guard — closing one branch of a handler and not the other is the defect class
        // this issue itself is an instance of.
        await this.createSubscriptionOrderFromCart({
          paymentId: payment.id,
          charge: invoiceExpanded.charge as Stripe.Charge,
          paymentIntentId: updateData.pspReference,
          invoice: invoiceExpanded,
          subscription,
          paymentState: OrderPaymentState.PAID,
        });
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : JSON.stringify(e);
      log.error(`Error processing Subscription processSubscriptionEventCharged notification: ${errorMessage}`);
      if (e instanceof SubscriptionHoldFailedError) {
        throw e; // ADR-027: the hold on a blocked first cycle failed transiently — let Stripe redeliver.
      }
      return;
    }
  }

  /**
   * Handles order processing for recurring charge.succeeded events based on config.
   * @returns True if processing should continue, false if caller should return early
   */
  private async handleRecurringChargeOrder(
    subscription: Stripe.Subscription,
    invoiceExpanded: StripeInvoiceExpanded,
    payment: Payment,
    updateData: StripeEventUpdatePayment,
  ): Promise<boolean> {
    const config = getConfig();
    const shouldCreateNewOrder = config.subscriptionPaymentHandling === 'createOrder';
    if (shouldCreateNewOrder) {
      log.info(
        `Creating new order for subscription charge ${updateData.id} (config: ${config.subscriptionPaymentHandling})`,
      );
      updateData.id = await this.handleSubscriptionPaymentCreateNewOrder(
        subscription,
        invoiceExpanded,
        updateData,
        OrderPaymentState.PAID,
      );
      log.info(`New order created successfully for subscription charge ${updateData.id}`);
    } else {
      log.info(
        `Adding payment to existing order for subscription charge ${updateData.id} (config: ${config.subscriptionPaymentHandling})`,
      );
      const success = await this.handlePaidSubscriptionPaymentWithCart(
        invoiceExpanded,
        subscription,
        payment,
        updateData,
      );
      if (!success) {
        return false;
      }
    }
    return true;
  }

  /**
   * Unfreezes the cart when a subscription is canceled (retries exhausted). The cart stays frozen for
   * the whole subscription lifecycle (subscription-lifecycle Rule 1/2), including during Stripe's
   * Smart-Retry window; only at terminal cancellation do we release it so the shopper can edit it and
   * retry with another payment method (which happens in Stripe). Best-effort: does not touch
   * payment/order state and never throws — a lingering frozen cart is not worth failing the webhook
   * and forcing Stripe to redeliver.
   */
  public async processSubscriptionEventDeleted(event: Stripe.Event): Promise<void> {
    log.info('Processing subscription processSubscriptionEventDeleted notification', {
      event: JSON.stringify(event.id),
    });
    try {
      const subscription = event.data.object as Stripe.Subscription;
      const paymentId = subscription.metadata?.[METADATA_PAYMENT_ID_FIELD];
      if (!paymentId) {
        log.warn('Cannot unfreeze cart on subscription cancellation: missing payment id in subscription metadata.', {
          subscriptionId: subscription.id,
        });
        return;
      }

      const cart = await this.ctCartService.getCartByPaymentId({ paymentId });
      if (!isCartFrozen(cart)) {
        return;
      }

      await unfreezeCart(cart);
      log.info('Cart unfrozen after subscription cancellation.', {
        ctCartId: cart.id,
        subscriptionId: subscription.id,
      });
    } catch (error) {
      log.error('Error unfreezing cart after subscription cancellation.', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Flags a CT payment when Stripe reports a subscription PaymentIntent failure AFTER the invoice was
   * already paid — an ACH late return (the bank reverses an already-settled debit, up to ~60 days
   * later). Stripe does not re-fire invoice.payment_failed in this case, so the invoice-driven handlers
   * never see it. Per the product decision the reversal is handled in the Stripe Dashboard (like
   * disputes); here we only leave a native paymentStatus mark (no custom fields, no transaction/order
   * state change) so the team is aware. Distinguished from an ordinary first-payment failure by an
   * existing Charge/Success (the money had settled) — a still-pending charge is a normal failure
   * handled by invoice.payment_failed and is ignored here. Best-effort, never throws.
   */
  public async processSubscriptionEventLateReturn(event: Stripe.Event): Promise<void> {
    try {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const paymentId = paymentIntent.metadata?.[METADATA_PAYMENT_ID_FIELD];
      if (!paymentId) {
        return;
      }

      const payment = await this.ctPaymentService.getPayment({ id: paymentId });
      const wasSettled = this.ctPaymentService.hasTransactionInState({
        payment,
        transactionType: PaymentTransactions.CHARGE,
        states: [PaymentStatus.SUCCESS],
      });
      if (!wasSettled) {
        return; // ordinary first-payment failure — resolved by invoice.payment_failed, not a late return
      }

      await setPaymentStatusInterface(
        payment,
        'ach_late_return',
        'ACH late return after settlement — handle in Stripe',
      );
      log.warn('Subscription payment flagged for an ACH late return (handled in the Stripe Dashboard).', {
        ctPaymentId: payment.id,
        paymentIntentId: paymentIntent.id,
      });
    } catch (error) {
      log.error('Error flagging subscription payment for a late ACH return.', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public async processSubscriptionEventFailed(event: Stripe.Event): Promise<void> {
    log.info('Processing subscription processSubscriptionEventFailed notification', {
      event: JSON.stringify(event.id),
    });
    try {
      const dataInvoiceId = (event.data.object as Stripe.Invoice).id;
      if (!dataInvoiceId) {
        log.error('Cannot process event: Missing invoice ID in event data.');
        return;
      }

      const invoiceExpanded = await this.paymentCreationService.getStripeInvoiceExpanded(dataInvoiceId);

      const subscription = invoiceExpanded.parent?.subscription_details?.subscription as Stripe.Subscription;
      const paymentId = subscription?.metadata?.[METADATA_PAYMENT_ID_FIELD];
      if (!paymentId) {
        log.error(
          `Cannot process invoice with ID: ${invoiceExpanded.id}. Missing payment ID in subscription metadata.`,
        );
        return;
      }

      let payment = await this.ctPaymentService.getPayment({
        id: paymentId,
      });
      if (!payment) {
        log.error(`Cannot process invoice with ID: ${invoiceExpanded.id}. Missing Payment can be trial days.`);
        return;
      }

      const { payment: resolvedPayment, isPaymentFailed } = await this.resolveFailedPayment(invoiceExpanded, payment);
      payment = resolvedPayment;

      const isPaymentChargePending = this.ctPaymentService.hasTransactionInState({
        payment,
        transactionType: PaymentTransactions.CHARGE,
        states: [PaymentStatus.PENDING],
      });
      const updateData = this.subscriptionEventConverter.convert(
        event,
        invoiceExpanded,
        isPaymentChargePending,
        payment,
      );

      if (!isPaymentFailed) {
        const shouldContinue = await this.handleFailedEventOrder(subscription, invoiceExpanded, payment, updateData);
        if (!shouldContinue) {
          return;
        }
      }

      for (const tx of updateData.transactions) {
        const updatedPayment = await this.ctPaymentService.updatePayment({
          ...updateData,
          transaction: tx,
        });

        log.info('Subscription payment updated after processing the notification', {
          paymentId: updatedPayment.id,
          version: updatedPayment.version,
          pspReference: updateData.pspReference,
          paymentMethod: updateData.paymentMethod,
          transaction: JSON.stringify(tx),
        });
      }

      if (isPaymentChargePending || isPaymentFailed) {
        // No amount guard here, deliberately: this order is created precisely to record that the
        // collection FAILED, so there is no collected amount to validate the cart against. The guard
        // is skipped on paymentState — `subscription` is therefore not passed.
        await this.createSubscriptionOrderFromCart({
          paymentId: payment.id,
          charge: invoiceExpanded.charge as Stripe.Charge,
          paymentIntentId: updateData.pspReference,
          invoice: invoiceExpanded,
          paymentState: OrderPaymentState.FAILED,
        });
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : JSON.stringify(e);
      log.error(`Error processing Subscription processSubscriptionEventFailed notification: ${errorMessage}`);
      if (RETRYABLE_CT_ERROR.test(errorMessage)) {
        throw e; // transient CT-write failure — let Stripe redeliver instead of a silent 200
      }
      return;
    }
  }

  /**
   * Resolves the payment from a failed invoice's payment intent, if one exists.
   */
  private async resolveFailedPayment(
    invoiceExpanded: StripeInvoiceExpanded,
    payment: Payment,
  ): Promise<{ payment: Payment; isPaymentFailed: boolean }> {
    const invoicePaymentIntent = invoiceExpanded.payment_intent as Stripe.PaymentIntent;
    if (!invoicePaymentIntent) {
      return { payment, isPaymentFailed: false };
    }
    const failedPayments = await this.ctPaymentService.findPaymentsByInterfaceId({
      interfaceId: invoicePaymentIntent.id,
    });
    if (failedPayments.length > 0) {
      return { payment: failedPayments[0], isPaymentFailed: true };
    }
    return { payment, isPaymentFailed: false };
  }

  /**
   * Handles order processing for failed subscription events based on config.
   * @returns True if processing should continue, false if caller should return early
   */
  private async handleFailedEventOrder(
    subscription: Stripe.Subscription,
    invoiceExpanded: StripeInvoiceExpanded,
    payment: Payment,
    updateData: StripeEventUpdatePayment,
  ): Promise<boolean> {
    const config = getConfig();
    const shouldCreateNewOrder = config.subscriptionPaymentHandling === 'createOrder';
    if (shouldCreateNewOrder) {
      await this.handleSubscriptionPaymentCreateNewOrder(
        subscription,
        invoiceExpanded,
        updateData,
        OrderPaymentState.FAILED,
      );
    } else {
      const success = await this.handleSubscriptionPaymentWithCart(invoiceExpanded, subscription, payment, updateData);
      if (!success) {
        return false;
      }
    }
    return true;
  }

  /**
   * Handles subscription payment by creating a payment and adding it to an existing cart and order.
   * This is used when the subscription payment handling is configured to add payments to existing orders
   * rather than creating new orders.
   * @param invoiceExpanded - The expanded Stripe invoice containing payment details
   * @param subscription - The Stripe subscription associated with the payment
   * @param payment - The existing commercetools payment to update
   * @param updateData - The subscription event data used for updating the payment
   * @returns True if processing was successful, false if cart ID is missing in invoice metadata
   */
  private async handleSubscriptionPaymentWithCart(
    invoiceExpanded: StripeInvoiceExpanded,
    subscription: Stripe.Subscription,
    payment: Payment,
    updateData: StripeEventUpdatePayment,
  ): Promise<boolean> {
    const eventCartId = invoiceExpanded.parent?.subscription_details?.metadata?.[METADATA_CART_ID_FIELD];
    if (!eventCartId) {
      log.error(`Cannot process invoice with ID: ${invoiceExpanded.id}. Missing cart.`);
      return false;
    }

    const amountPlanned: Money = {
      currencyCode: invoiceExpanded.currency.toUpperCase(),
      centAmount: invoiceExpanded.amount_due,
    };

    const cart = await this.ctCartService.getCart({ id: eventCartId });
    const createdPayment = await this.paymentCreationService.handleCtPaymentSubscription({
      cart,
      amountPlanned,
      interactionId: updateData.pspReference || '',
    });

    await this.handleSubscriptionPaymentAddToOrder(cart, createdPayment, subscription, payment, updateData);
    return true;
  }

  public async processSubscriptionEventUpcoming(event: Stripe.Event): Promise<void> {
    const config = getConfig();
    if (!config.subscriptionPriceSyncEnabled) {
      log.info(
        'Skipping upcoming subscription price synchronization because STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED is not set to true',
      );
      return;
    }

    try {
      const invoiceData = event.data.object as StripeInvoiceExpanded;
      const invoiceSubscription = invoiceData.parent?.subscription_details?.subscription;
      const subscriptionId = typeof invoiceSubscription === 'string' ? invoiceSubscription : invoiceSubscription?.id;

      if (!subscriptionId) {
        log.warn('Skipping upcoming subscription price synchronization: no subscription ID found in event');
        return;
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);

      await this.synchronizeSubscriptionPrice(subscription);
    } catch (e) {
      log.error(`Error processing upcoming subscription notification: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
  }

  /**
   * Synchronizes the Stripe subscription price with the current commercetools product price
   * @param subscription - The Stripe subscription to synchronize
   */
  private async synchronizeSubscriptionPrice(subscription: Stripe.Subscription): Promise<void> {
    try {
      if (!subscription.items?.data?.length) {
        log.warn('No subscription items found for price synchronization');
        return;
      }

      const subscriptionItem = subscription.items.data[0];
      const currentStripePrice = subscriptionItem.price;
      const productId = currentStripePrice.product as string;
      const productExpanded = await stripe.products.retrieve(productId);

      if (!currentStripePrice) {
        log.warn('No price found in subscription item');
        return;
      }

      const ctProductId = productExpanded.metadata?.[METADATA_PRODUCT_ID_FIELD];
      if (!ctProductId) {
        log.warn('No commercetools product ID found in subscription metadata');
        return;
      }

      const ctProductPrice = await this.getCommercetoolsProductPrice(ctProductId);
      if (!ctProductPrice) {
        log.warn('Could not retrieve commercetools product price');
        return;
      }

      log.info(`Comparing prices for synchronization - 
        stripePrice: ${currentStripePrice.unit_amount} 
        ctPrice: ${ctProductPrice.centAmount} 
        currency: ${ctProductPrice.currencyCode}
        subscriptionId: ${subscription.id}
        subscriptionItemId: ${subscriptionItem.id}
        `);

      if (currentStripePrice.unit_amount === ctProductPrice.centAmount) {
        log.info('Prices are already synchronized, no update needed');
        return;
      }

      const newPriceId = await this.getOrCreateStripePriceForProduct(ctProductId, ctProductPrice, subscription);

      await this.updateSubscriptionPrice(subscription.id, subscriptionItem, newPriceId);

      log.info(`Subscription price successfully synchronized - 
        subscriptionId: ${subscription.id}
        oldPrice: ${currentStripePrice.unit_amount}
        newPrice: ${ctProductPrice.centAmount}
        newPriceId: ${newPriceId}
        `);
    } catch (error) {
      log.error(
        `Error synchronizing subscription price ${subscription.id} ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Gets the current price of a commercetools product
   * @param productId - The commercetools product ID
   * @returns The current price or undefined if not found
   */
  private async getCommercetoolsProductPrice(productId: string): Promise<PaymentAmount | undefined> {
    try {
      const price = await getProductMasterPrice(productId);

      if (!price) {
        log.warn('No price found for commercetools product', { productId });
        return undefined;
      }

      log.info('Retrieved commercetools product price', {
        productId,
        centAmount: price.centAmount,
        currencyCode: price.currencyCode,
      });

      return price;
    } catch (error) {
      log.error('Error getting commercetools product price', {
        errorMessage: error instanceof Error ? error.message : String(error),
        productId,
      });
      return undefined;
    }
  }

  /**
   * Gets or creates a Stripe price for the given product and price
   * @param ctProductId - The commercetools product ID
   * @param ctPrice - The commercetools price
   * @param subscription - The subscription for context
   * @returns The Stripe price ID
   */
  private async getOrCreateStripePriceForProduct(
    ctProductId: string,
    ctPrice: PaymentAmount,
    subscription: Stripe.Subscription,
  ): Promise<string> {
    try {
      const existingPrice = await this.findStripePriceByProductAndPrice(ctProductId, ctPrice);

      if (existingPrice) {
        const subscriptionItem = subscription.items.data[0];
        const hasSameInterval = existingPrice.recurring?.interval === subscriptionItem.price.recurring?.interval;
        const hasSameIntervalCount =
          existingPrice.recurring?.interval_count === subscriptionItem.price.recurring?.interval_count;

        if (hasSameInterval && hasSameIntervalCount) {
          log.info('Found existing Stripe price with matching attributes', { priceId: existingPrice.id });
          return existingPrice.id;
        } else {
          log.info('Existing price found but attributes differ, will create new price');
        }
      }

      log.info('Creating new Stripe price for the updated amount');

      const stripeProduct = await this.findStripeProductById(ctProductId);
      if (!stripeProduct) {
        throw new Error(`Stripe product not found for commercetools product ${ctProductId}`);
      }

      const subscriptionItem = subscription.items.data[0];
      const attributes: SubscriptionAttributes = {
        recurring_interval: subscriptionItem.price.recurring?.interval || 'month',
        recurring_interval_count: subscriptionItem.price.recurring?.interval_count || 1,
        description: subscriptionItem.price.nickname || 'Subscription',
        off_session: false,
        collection_method: 'charge_automatically',
      };

      const newPrice = await stripe.prices.create(
        {
          currency: ctPrice.currencyCode.toLowerCase(),
          product: stripeProduct.id,
          unit_amount: ctPrice.centAmount,
          metadata: {
            [METADATA_VARIANT_SKU_FIELD]: ctProductId,
            [METADATA_PRICE_ID_FIELD]: `price_${Date.now()}`,
          },
          recurring: {
            interval: attributes.recurring_interval,
            interval_count: attributes.recurring_interval_count,
          },
          nickname: attributes.description,
        },
        { idempotencyKey: randomUUID() },
      );

      log.info('New Stripe price created for price synchronization', {
        priceId: newPrice.id,
        amount: ctPrice.centAmount,
        currency: ctPrice.currencyCode,
      });

      return newPrice.id;
    } catch (error) {
      log.error(
        `Error getting or creating Stripe price ${ctProductId} ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Finds a Stripe price by product and price metadata
   * @param ctProductId - The commercetools product ID
   * @param ctPrice - The commercetools price
   * @returns The Stripe price if found, undefined otherwise
   */
  private async findStripePriceByProductAndPrice(
    ctProductId: string,
    ctPrice: PaymentAmount,
  ): Promise<Stripe.Price | undefined> {
    try {
      const prices = await stripe.prices.search({
        query: `metadata['${METADATA_VARIANT_SKU_FIELD}']:'${ctProductId}' AND active:'true'`,
      });

      if (!prices.data.length) {
        log.info('No active Stripe prices found for the product', { ctProductId });
        return undefined;
      }

      const matchingPrice = prices.data.find(
        (price) => price.unit_amount === ctPrice.centAmount && price.currency === ctPrice.currencyCode.toLowerCase(),
      );

      if (matchingPrice) {
        log.info('Found matching Stripe price', {
          priceId: matchingPrice.id,
          amount: matchingPrice.unit_amount,
          currency: matchingPrice.currency,
        });
      } else {
        log.info('No matching Stripe price found for the amount and currency', {
          ctProductId,
          expectedAmount: ctPrice.centAmount,
          expectedCurrency: ctPrice.currencyCode,
        });
      }

      return matchingPrice || undefined;
    } catch (error) {
      log.error(
        `Error searching for existing Stripe price ${ctProductId} ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /**
   * Updates the subscription with a new price
   * @param subscriptionId - The subscription ID to update
   * @param itemId - The subscription item ID to update
   * @param newPriceId - The new price ID to use
   */
  private async updateSubscriptionPrice(
    subscriptionId: string,
    item: Stripe.SubscriptionItem,
    newPriceId: string,
  ): Promise<void> {
    try {
      await stripe.subscriptions.update(subscriptionId, {
        items: [
          {
            id: item.id,
            price: newPriceId,
            quantity: item.quantity || 1,
          },
        ],
        proration_behavior: 'none',
        billing_cycle_anchor: 'unchanged',
      });

      log.info(`Subscription price updated successfully - 
        subscriptionId: ${subscriptionId}
        itemId: ${item.id}
        newPriceId: ${newPriceId}
        `);
    } catch (error) {
      log.error('Error updating subscription price', {
        errorMessage: error instanceof Error ? error.message : String(error),
        subscriptionId,
        newPriceId,
      });
      throw error;
    }
  }

  /**
   * Handles subscription payment by adding it to the existing order
   */
  private async handleSubscriptionPaymentAddToOrder(
    cart: Cart,
    createdPayment: string,
    subscription: Stripe.Subscription,
    payment: Payment,
    updateData: StripeEventUpdatePayment,
  ): Promise<void> {
    log.info('Adding subscription payment to existing order', {
      cartId: cart.id,
      paymentId: createdPayment,
      subscriptionId: subscription.id,
    });

    await this.paymentService.addPaymentToOrder(payment.id, createdPayment);
    updateData.id = createdPayment;
  }

  /**
   * Handles subscription payment by creating a new order
   * @param subscription - The Stripe subscription
   * @param invoiceExpanded - The expanded Stripe invoice
   * @param updateData - The payment update data
   * @param paymentState - The payment state for the order
   */
  private async handleSubscriptionPaymentCreateNewOrder(
    subscription: Stripe.Subscription,
    invoiceExpanded: StripeInvoiceExpanded,
    updateData: StripeEventUpdatePayment,
    paymentState: OrderPaymentState = OrderPaymentState.PAID,
  ): Promise<string> {
    log.info('Creating new order for subscription payment', {
      paymentId: updateData.id,
      subscriptionId: subscription.id,
      invoiceId: invoiceExpanded.id,
      pspReference: updateData.pspReference,
    });

    // Idempotency guard: Stripe webhooks are at-least-once, so the same invoice.paid for a recurring
    // cycle can be redelivered. The new CT Payment is created with interfaceId = pspReference (the
    // invoice PaymentIntent, unique per cycle), so if a payment already exists for it we have already
    // processed this cycle — return it instead of cloning another order/payment. (First cycle is
    // guarded separately by createSubscriptionOrderFromCart.)
    const cyclePaymentIntentId = updateData.pspReference;
    if (cyclePaymentIntentId) {
      const existingPayments = await this.ctPaymentService.findPaymentsByInterfaceId({
        interfaceId: cyclePaymentIntentId,
      });
      if (existingPayments.length > 0) {
        log.info('Recurring subscription invoice already processed; skipping duplicate order/payment creation', {
          pspReference: cyclePaymentIntentId,
          invoiceId: invoiceExpanded.id,
          existingPaymentId: existingPayments[0].id,
        });
        return existingPayments[0].id;
      }
    }

    const originalOrder = await this.ctOrderService.getOrderByPaymentId({ paymentId: updateData.id });

    const customerId = invoiceExpanded.parent?.subscription_details?.metadata?.[METADATA_CUSTOMER_ID_FIELD];
    if (!customerId) {
      throw new Error('Customer ID not found in invoice metadata');
    }
    const customer = await getCustomerById(customerId);
    if (!customer) {
      log.error(`Customer not found ${customerId}`);
      throw new Error('Customer not found');
    }

    const newCart = await this.createCartFromOrder(originalOrder, customer, subscription);
    // A2: the renewal cart carries the original order's addresses (setCartAddresses); keep its shipping address
    // so every cycle ships where the first order did, instead of to the card's billing address.
    const updatedCart = await this.paymentService.updateCartAddress(invoiceExpanded.charge as Stripe.Charge, newCart, {
      preserveExistingAddress: true,
    });
    // Stripe (the financial provider) is the source of truth for the amount charged this cycle.
    // Using the cloned cart total would misreport recurring charges for multi-quantity / mixed carts
    // (e.g. a $225 cloned cart vs a $75 recurring invoice), leaving the Authorization amount out of
    // sync with the actual Charge. Base the payment on the invoice total; fall back to the cloned cart
    // total only if the invoice total is unavailable.
    const paymentAmount: PaymentAmount = {
      centAmount: invoiceExpanded.total || updatedCart.totalPrice?.centAmount || 0,
      currencyCode: updatedCart.totalPrice?.currencyCode || 'USD',
      fractionDigits: updatedCart.totalPrice?.fractionDigits || 2,
    };

    const paymentReference = await this.paymentCreationService.handleCtPaymentCreation({
      interactionId: updateData.pspReference || '',
      amountPlanned: paymentAmount,
      cart: updatedCart,
    });

    const latestCart = await this.ctCartService.getCart({ id: updatedCart.id });
    await this.paymentService.createOrder({
      cart: latestCart,
      paymentIntentId: updateData.pspReference,
      subscriptionId: subscription.id,
      paymentState,
    });

    await this.updateSubscriptionMetadata({
      subscriptionId: subscription.id,
      ctPaymentId: paymentReference,
      customerId: customer.id,
    });

    return paymentReference;
  }

  /**
   * Creates a new cart based on an existing order structure
   */
  private async createCartFromOrder(
    originalOrder: Order,
    customer: Customer,
    subscription: Stripe.Subscription,
  ): Promise<Cart> {
    try {
      const newCart = await this.createNewCartFromOrder(originalOrder, customer, subscription);

      log.info(`New cart created from order structure ${originalOrder.id} 
        newCartId: ${newCart.id} 
        customerId: ${customer.id} 
        lineItemsCount: ${originalOrder.lineItems?.length}
        subscriptionId: ${subscription.id}
        `);

      return newCart;
    } catch (error) {
      log.error(
        `Failed to create cart from order ${originalOrder.id} ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Creates a new cart using the commercetools API
   */
  private async createNewCartFromOrder(
    originalOrder: Order,
    customer: Customer,
    subscription: Stripe.Subscription,
  ): Promise<Cart> {
    const cartDraft: CartDraft = {
      currency: originalOrder.totalPrice?.currencyCode || 'USD',
      customerId: customer.id,
      customerEmail: customer.email,
      country: originalOrder.shippingAddress?.country || originalOrder.billingAddress?.country || 'US',
      taxMode: originalOrder.taxMode || 'Platform',
      taxRoundingMode: originalOrder.taxRoundingMode || 'HalfEven',
      taxCalculationMode: originalOrder.taxCalculationMode || 'LineItemLevel',
      priceRoundingMode: originalOrder.priceRoundingMode || 'HalfEven',
    };

    let newCart = await createCartFromDraft(cartDraft);

    if (originalOrder.lineItems?.length) {
      const subscriptionPrice = subscription.items.data[0].price;
      // Only the subscription's own line item(s) recur. One-time items are billed once on the first
      // invoice and must NOT be re-added to recurring cycles — Stripe already excludes them from the
      // recurring invoice. Previously every original line item was mapped onto the subscription SKU,
      // so a mixed cart (1 subscription + 2 one-time) produced a recurring cart of qty 3 (3 x $75 =
      // $225) while Stripe only charged $75. Keep the line item(s) belonging to THIS subscription,
      // identified by the subscription-id custom field (robust to price-sync) with product/price
      // matching as a fallback. Multiple distinct subscriptions per cart are not a supported scenario.
      const subscriptionLineItems = originalOrder.lineItems.filter(
        (item: LineItem) =>
          item.custom?.fields?.[lineItemStripeSubscriptionIdField] === subscription.id ||
          this.isMatchingSubscriptionItem(item, subscriptionPrice, subscription),
      );
      if (!subscriptionLineItems.length) {
        log.warn('No subscription line item identified in the original order; cloning all line items.', {
          orderId: originalOrder.id,
          subscriptionId: subscription.id,
        });
      }
      const itemsToClone = subscriptionLineItems.length ? subscriptionLineItems : originalOrder.lineItems;
      const lineItemActions: CartUpdateAction[] = itemsToClone.map((item: LineItem) =>
        this.buildLineItemAction(item, subscriptionPrice, subscription),
      );

      const newCartId = (await updateCartById(newCart, lineItemActions)).id;
      newCart = await getCartExpanded(newCartId);
      newCart = await this.updateSubscriptionPriceIfNeeded(newCart, subscription);
    }

    newCart = await this.setCartAddresses(newCart, originalOrder);

    return newCart;
  }

  /**
   * Builds a CartUpdateAction to add a line item based on subscription matching.
   * If the item matches the subscription product (by SKU and price ID), it uses the original
   * product and variant IDs. Otherwise, it uses the SKU from the subscription metadata.
   * @param item - The line item from the original order
   * @param subscriptionPrice - The Stripe price object from the subscription
   * @param subscription - The Stripe subscription
   * @returns A CartUpdateAction to add the line item to the cart
   */
  private buildLineItemAction(
    item: LineItem,
    subscriptionPrice: Stripe.Price,
    subscription: Stripe.Subscription,
  ): CartUpdateAction {
    const customFields = {
      type: {
        typeId: 'type' as const,
        key: typeLineItem.key,
      },
      fields: {
        [lineItemStripeSubscriptionIdField]: subscription.id,
      },
    };

    if (this.isMatchingSubscriptionItem(item, subscriptionPrice, subscription)) {
      return {
        action: 'addLineItem',
        productId: item.productId,
        variantId: item.variant?.id,
        quantity: item.quantity || 1,
        custom: customFields,
      };
    }

    return {
      action: 'addLineItem',
      sku: subscriptionPrice.metadata?.[METADATA_VARIANT_SKU_FIELD],
      quantity: item.quantity || 1,
      custom: customFields,
    };
  }

  /**
   * Checks if a line item matches the subscription product based on SKU and price ID.
   * @param item - The line item to check
   * @param subscriptionPrice - The Stripe price object containing the expected SKU in metadata
   * @param subscription - The Stripe subscription containing the expected price ID in metadata
   * @returns True if the item's SKU and price ID match the subscription metadata
   */
  private isMatchingSubscriptionItem(
    item: LineItem,
    subscriptionPrice: Stripe.Price,
    subscription: Stripe.Subscription,
  ): boolean {
    const skuMatches = item.variant.sku === subscriptionPrice.metadata?.[METADATA_VARIANT_SKU_FIELD];
    const priceIdMatches = item.price.id === subscription.metadata?.[METADATA_PRICE_ID_FIELD];
    return skuMatches && priceIdMatches;
  }

  /**
   * Updates the subscription price in commercetools and Stripe if the line item price
   * differs from the Stripe subscription price.
   * @param cart - The current cart with subscription line items
   * @param subscription - The Stripe subscription to sync prices with
   * @returns The updated cart, or the original cart if no price update was needed
   */
  private async updateSubscriptionPriceIfNeeded(cart: Cart, subscription: Stripe.Subscription): Promise<Cart> {
    const subscriptionPrice = subscription.items.data[0].price;
    const subscriptionLineItem = this.findSubscriptionLineItem(cart);

    if (subscriptionLineItem.price.value.centAmount === subscriptionPrice.unit_amount) {
      return cart;
    }

    //If the subscription price is different from the original order price, use the external
    // price to add the value charged to the client in the comercetools payment
    const updateItemActions: CartUpdateAction[] = [
      {
        action: 'setLineItemPrice',
        lineItemId: subscriptionLineItem.id,
        externalPrice: {
          centAmount: subscriptionPrice.unit_amount || 0,
          currencyCode: subscriptionPrice.currency.toUpperCase(),
          fractionDigits: 2,
        },
      },
    ];

    let newCart = await updateCartById(cart, updateItemActions);
    newCart = await getCartExpanded(newCart.id);

    try {
      const amountPlanned: PaymentAmount = {
        centAmount: subscriptionLineItem.price.value.centAmount || 0,
        currencyCode: subscriptionLineItem.price.value.currencyCode,
        fractionDigits: 2,
      };

      const subscriptionPriceId = await this.getCreateSubscriptionPriceId(newCart, amountPlanned);

      /* If using Stripe Test Clock, wait for 9 seconds to allow clock advancement in test environments.
      This helps ensure Stripe's test clock events are processed before updating the subscription.
      Uncomment this line for testing purposes when using Stripe Test Clock.
      await new Promise((resolve) => setTimeout(resolve, 9000));
      */

      await stripe.subscriptions.update(subscription.id, {
        items: [
          {
            id: subscription.items.data[0].id,
            price: subscriptionPriceId,
            quantity: subscriptionLineItem.quantity || 1,
          },
        ],
        proration_behavior: 'none',
        billing_cycle_anchor: 'unchanged',
      });
    } catch (error) {
      log.error(`Error getting subscription price ${error instanceof Error ? error.message : String(error)}`);
    }

    return newCart;
  }

  /**
   * Sets the shipping and billing addresses on a cart from the original order.
   * @param cart - The cart to update with addresses
   * @param originalOrder - The original order containing the addresses to copy
   * @returns The updated cart with addresses, or the original cart if no addresses were set
   */
  private async setCartAddresses(cart: Cart, originalOrder: Order): Promise<Cart> {
    const addressActions: CartUpdateAction[] = [];

    if (originalOrder.shippingAddress) {
      addressActions.push({
        action: 'setShippingAddress',
        address: originalOrder.shippingAddress,
      });
    }

    if (originalOrder.billingAddress) {
      addressActions.push({
        action: 'setBillingAddress',
        address: originalOrder.billingAddress,
      });
    }

    if (addressActions.length === 0) {
      return cart;
    }

    return updateCartById(cart, addressActions);
  }
}
