import Stripe from 'stripe';
import {
  Cart,
  CommercetoolsCartService,
  CommercetoolsPaymentService,
  LineItem,
  Money,
  Payment,
} from '@commercetools/connect-payments-sdk';
import { CartSetLineItemCustomFieldAction, CartSetLineItemCustomTypeAction } from '@commercetools/platform-sdk';
import { PaymentAmount } from '@commercetools/connect-payments-sdk/dist/commercetools/types/payment.type';
import { getConfig } from '../config/config';
import {
  BasicSubscriptionData,
  CreateSetupIntentProps,
  CreateStripePriceProps,
  FullSubscriptionData,
  GetCurrentPaymentProps,
  StripeSubscriptionServiceOptions,
  SubscriptionAttributes,
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
import { getCartIdFromContext, getMerchantReturnUrlFromContext } from '../libs/fastify/context/context';
import { stripeApi, wrapStripeError } from '../clients/stripe.client';
import { log } from '../libs/logger';
import { StripeCustomerService } from './stripe-customer.service';
import { getLocalizedString, transformVariantAttributes } from '../utils';
import {
  lineItemStripeSubscriptionIdField,
  productTypeSubscription,
  stripeCustomerIdFieldName,
  typeLineItem,
} from '../custom-types/custom-types';
import { getSubscriptionAttributes } from '../mappers/subscription-mapper';
import { CtPaymentCreationService } from './ct-payment-creation.service';
import { getCartExpanded, updateCartById } from './commerce-tools/cart-client';
import { getCustomFieldUpdateActions } from './commerce-tools/custom-type-helper';
import { METADATA_PRICE_ID_FIELD, METADATA_PRODUCT_ID_FIELD, METADATA_VARIANT_SKU_FIELD } from '../constants';
import { StripePaymentService } from './stripe-payment.service';
import { StripeCouponService } from './stripe-coupon.service';
import { getCustomerById } from './commerce-tools/customer-client';
import { SubscriptionEventConverter } from './converters/subscriptionEventConverter';
import { PaymentTransactions } from '../dtos/operations/payment-intents.dto';
import { PaymentStatus } from './types/stripe-payment.type';

const stripe = stripeApi();

export class StripeSubscriptionService {
  private customerService: StripeCustomerService;
  private ctCartService: CommercetoolsCartService;
  private ctPaymentService: CommercetoolsPaymentService;
  private paymentCreationService: CtPaymentCreationService;
  private paymentService: StripePaymentService;
  private stripeCouponService: StripeCouponService;
  private subscriptionEventConverter: SubscriptionEventConverter;

  constructor(opts: StripeSubscriptionServiceOptions) {
    this.ctCartService = opts.ctCartService;
    this.ctPaymentService = opts.ctPaymentService;
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
      throw wrapStripeError(error);
    }
  }

  public async createSubscription(): Promise<SubscriptionResponseSchemaDTO> {
    try {
      const { cart, amountPlanned, priceId, stripeCustomerId, subscriptionParams, billingAddress, merchantReturnUrl } =
        await this.prepareSubscriptionData();

      const subscription = await stripe.subscriptions.create({
        ...subscriptionParams,
        customer: stripeCustomerId!,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
        metadata: this.paymentCreationService.getPaymentMetadata(cart),
        discounts: await this.stripeCouponService.getStripeCoupons(cart),
      });

      const { clientSecret, paymentIntentId } = this.validateSubscription(subscription);

      log.info('Stripe Subscription created.', {
        ctCartId: cart.id,
        stripeSubscriptionId: subscription.id,
        stripePaymentIntentId: paymentIntentId,
      });

      await this.saveSubscriptionId(cart, subscription.id);

      const paymentReference = await this.paymentCreationService.handleCtPaymentCreation({
        subscriptionId: subscription.id,
        interactionId: paymentIntentId,
        amountPlanned,
        cart,
      });

      return {
        subscriptionId: subscription.id,
        cartId: cart.id,
        clientSecret,
        paymentReference,
        merchantReturnUrl,
        billingAddress,
      };
    } catch (error) {
      throw wrapStripeError(error);
    }
  }

  public async createSubscriptionFromSetupIntent(
    setupIntentId: string,
  ): Promise<SubscriptionFromSetupIntentResponseSchemaDTO> {
    try {
      const { cart, priceId, stripeCustomerId, subscriptionParams, amountPlanned } =
        await this.prepareSubscriptionData();
      const { payment_method: paymentMethodId } = await stripe.setupIntents.retrieve(setupIntentId);
      const { hasFreeAnchorDays, isSendInvoice } = this.getSubscriptionTypes(subscriptionParams);

      if (!paymentMethodId || typeof paymentMethodId !== 'string') {
        throw new Error('Failed to create Subscription. Invalid setup intent.');
      }

      const subscription = await stripe.subscriptions.create({
        ...subscriptionParams,
        customer: stripeCustomerId,
        default_payment_method: paymentMethodId,
        items: [{ price: priceId }],
        expand: ['latest_invoice'],
        payment_settings: { save_default_payment_method: 'on_subscription' },
        metadata: this.paymentCreationService.getPaymentMetadata(cart),
        discounts: await this.stripeCouponService.getStripeCoupons(cart),
      });

      log.info('Stripe Subscription from Setup Intent created.', {
        ctCartId: cart.id,
        stripeSubscriptionId: subscription.id,
        stripeSetupIntentId: setupIntentId,
      });

      const invoiceId = (subscription.latest_invoice as Stripe.Invoice)?.id;

      if (isSendInvoice && invoiceId) {
        const invoiceSent = await stripe.invoices.sendInvoice(invoiceId);
        if (invoiceSent.status === 'open') {
          log.info('Stripe Subscription invoice was sent.');
        } else if (invoiceSent.status === 'paid') {
          log.info('Stripe Subscription invoice is paid.');
        } else {
          log.warn('Stripe Subscription invoice was not sent.');
        }
      }

      await this.saveSubscriptionId(cart, subscription.id);

      const ctPaymentId = await this.paymentCreationService.handleCtPaymentCreation({
        cart,
        amountPlanned,
        subscriptionId: subscription.id,
        interactionId: !hasFreeAnchorDays ? invoiceId : subscription.id,
      });

      return { subscriptionId: subscription.id, paymentReference: ctPaymentId };
    } catch (error) {
      throw wrapStripeError(error);
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

    if (cart.lineItems.length > 1 || cart.lineItems[0].quantity > 1) {
      throw new Error('Only one line item is allowed in the cart for subscription. Please remove the others.');
    }

    const customer = await this.customerService.getCtCustomer(cart.customerId!);
    const stripeCustomerId: string = customer?.custom?.fields?.[stripeCustomerIdFieldName];
    const subscriptionParams = getSubscriptionAttributes(cart.lineItems[0].variant.attributes);
    const billingAddress =
      config.stripeCollectBillingAddress !== 'auto' ? this.customerService.getBillingAddress(cart) : undefined;

    if (basicData) {
      return { cart, stripeCustomerId, subscriptionParams, billingAddress, merchantReturnUrl };
    }

    const amountPlanned = await this.ctCartService.getPaymentAmount({ cart });
    const lineItemAmount = this.getSubscriptionPaymentAmount(cart);
    const priceId = await this.getSubscriptionPriceId(cart, lineItemAmount);

    return {
      cart,
      lineItemAmount,
      amountPlanned,
      priceId,
      stripeCustomerId,
      subscriptionParams,
      billingAddress,
      merchantReturnUrl,
    };
  }

  public validateSubscription(subscription: Stripe.Subscription) {
    if (
      typeof subscription.latest_invoice === 'string' ||
      typeof subscription.latest_invoice?.payment_intent === 'string' ||
      !subscription.latest_invoice?.payment_intent?.client_secret
    ) {
      throw new Error('Failed to create Subscription, missing Payment Intent.');
    }

    return {
      paymentIntentId: subscription.latest_invoice.payment_intent.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret,
    };
  }

  public async getSubscriptionPriceId(cart: Cart, amount: PaymentAmount): Promise<string> {
    const product = cart.lineItems[0];
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
    const stripeProductId = await this.getStripeProduct(product);
    return await this.createStripePrice({ amount, product, stripeProductId, attributes });
  }

  public async getStripePriceByMetadata(product: LineItem) {
    return await stripe.prices.search({
      query: `metadata['${METADATA_VARIANT_SKU_FIELD}']:'${product.variant.sku}' AND
              metadata['${METADATA_PRICE_ID_FIELD}']:'${product.price.id}'`,
    });
  }

  public async disableStripePrice(price: Stripe.Price, product: LineItem) {
    await stripe.prices.update(price.id, {
      nickname: price.nickname ? `DEPRECATED - ${price.nickname}` : 'DEPRECATED PRICE',
      active: false,
      metadata: {
        [METADATA_VARIANT_SKU_FIELD]: `deprecated_${product.variant.sku}`,
        [METADATA_PRICE_ID_FIELD]: `deprecated_${product.price.id}`,
      },
    });
    log.warn(`Existing Stripe Price "${price.id}" has been updated to deprecated.`);
  }

  public async getStripeProduct(product: LineItem): Promise<string> {
    const stripeProduct = await stripe.products.search({
      query: `metadata['${METADATA_PRODUCT_ID_FIELD}']:'${product.productId}'`,
    });

    if (stripeProduct.data.length && stripeProduct.data[0].id) {
      const stripeProductId = stripeProduct.data[0].id;
      log.info(`Found existing product ID: ${stripeProductId}`);
      return stripeProductId;
    }

    log.info(`No stripe product found was found with metadata specified. A new one will be created.`);
    return await this.createStripeProduct(product);
  }

  public async createStripeProduct(product: LineItem): Promise<string> {
    const newProduct = await stripe.products.create({
      name: getLocalizedString(product.name),
      metadata: {
        [METADATA_PRODUCT_ID_FIELD]: product.productId,
      },
    });

    log.info(`Stripe product created.`, {
      ctProductId: product.productId,
      stripeProductId: newProduct.id,
    });
    return newProduct.id;
  }

  public async createStripePrice({ amount, product, stripeProductId, attributes }: CreateStripePriceProps) {
    const price = await stripe.prices.create({
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
    });

    log.info(`Stripe price created.`, {
      ctProductId: product.productId,
      ctPriceAmount: amount.centAmount,
      stripePriceId: price.id,
      stripeProductId,
    });

    return price.id;
  }

  public async createStripeSetupIntent({ stripeCustomerId, cart, offSession }: CreateSetupIntentProps) {
    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      usage: offSession ? 'off_session' : 'on_session',
      metadata: this.paymentCreationService.getPaymentMetadata(cart),
    });

    if (!setupIntent.client_secret) {
      throw new Error('Failed to create Setup Intent.');
    }

    log.info(`Stripe Setup Intent created.`, { stripeSetupIntentId: setupIntent.id });
    return { id: setupIntent.id, clientSecret: setupIntent.client_secret };
  }

  public async saveSubscriptionId(cart: Cart, subscriptionId: string): Promise<void> {
    const lineItemId = cart.lineItems[0].id;
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
      const cart = await this.ctCartService.getCart({ id: getCartIdFromContext() });
      const subscriptionParams = getSubscriptionAttributes(cart.lineItems[0].variant.attributes!);
      const { hasNoInvoice, isSendInvoice, hasTrial } = this.getSubscriptionTypes(subscriptionParams);

      if (hasNoInvoice) {
        const payment = await this.ctPaymentService.getPayment({ id: paymentReference });
        await this.paymentCreationService.updateSubscriptionPaymentTransactions({
          interactionId: subscriptionId,
          payment: { ...payment, amountPlanned: { ...payment.amountPlanned, centAmount: 0 } },
          subscriptionId,
        });
      } else {
        const invoice = await this.getInvoiceFromSubscription(subscriptionId);
        const payment = await this.getCurrentPayment({ paymentReference, invoice, subscriptionParams });

        await this.paymentCreationService.updateSubscriptionPaymentTransactions({
          interactionId: paymentIntentId || invoice?.id || subscriptionId,
          payment,
          subscriptionId,
          isPending: isSendInvoice && !hasTrial ? true : false,
        });
      }
    } catch (error) {
      throw wrapStripeError(error);
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
    const isSubscription = cart.lineItems[0].productType.obj?.name === productTypeSubscription.name;
    if (!isSubscription) {
      return 'payment';
    }

    const subscriptionParams = getSubscriptionAttributes(cart.lineItems[0].variant.attributes);
    const { hasTrial, hasFreeAnchorDays, isSendInvoice } = this.getSubscriptionTypes(subscriptionParams);
    if (hasTrial || hasFreeAnchorDays || isSendInvoice) {
      log.info('Subscription type is Setup Intent.');
      return 'setup';
    }

    return 'subscription';
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
    const hasProrations = !!(hasAnchorDays && proration_behavior === 'create_prorations');
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

  public getSubscriptionPaymentAmount(cart: Cart): PaymentAmount {
    const product = cart.lineItems[0];
    const isSubscription = product.productType.obj?.name === productTypeSubscription.name;
    const { centAmount, currencyCode, fractionDigits } = product.price.value;

    if (!isSubscription) {
      throw new Error('Cart is not a subscription.');
    }

    return { centAmount, currencyCode, fractionDigits };
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
      log.error(`Failed to retrieve subscriptions for customer ${customerId}`, { error });
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
      const canceledSubscription = await stripe.subscriptions.cancel(subscriptionId, {
        invoice_now: false,
        prorate: true,
      });

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
      log.error(`Failed to cancel subscription ${subscriptionId}`, { error });
      throw wrapStripeError(error);
    }
  }

  async updateSubscription({
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
    await this.validateCustomerSubscription(customerId, subscriptionId);

    try {
      const updatedSubscription = await stripe.subscriptions.update(subscriptionId, params, options);
      log.info(`Successfully updated subscription ${subscriptionId} for customer ${customerId}`, {
        updatedSubscriptionId: updatedSubscription.id,
        changes: JSON.stringify(params),
      });

      return updatedSubscription;
    } catch (error) {
      log.error(`Failed to update subscription ${subscriptionId}`, { error });
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

  /**
   * Retrieves modified payment data based on the given Stripe event for subscriptions.
   *
   * @param {Stripe.Event} event - The Stripe event object to extract data from.
   * @return {ModifyPayment} - An object containing modified payment data.
   */
  public async processSubscriptionEvent(event: Stripe.Event): Promise<void> {
    log.info('Processing subscription notification', { event: JSON.stringify(event.id) });
    try {
      const dataInvoice = event.data.object as Stripe.Invoice;
      const invoiceExpanded = await this.paymentCreationService.getStripeInvoiceExpanded(dataInvoice.id);
      const subscription = invoiceExpanded.subscription as Stripe.Subscription;
      const invoicePaymentIntent = invoiceExpanded.payment_intent as Stripe.PaymentIntent;

      let payment = await this.ctPaymentService.getPayment({
        id: subscription.metadata?.ct_payment_id ?? '',
      });
      if (!payment) {
        log.error(`Cannot process invoice with ID: ${dataInvoice.id}. Missing Payment can be trial days.`);
        return;
      }

      const failedPaymentIntent = await this.ctPaymentService.findPaymentsByInterfaceId({
        interfaceId: invoicePaymentIntent.id,
      });
      const isPaymentFailed = failedPaymentIntent.length > 0;
      if (failedPaymentIntent.length > 0) {
        //Update a failed payment if it has a Failed transaction
        payment = failedPaymentIntent[0];
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

      if (!isPaymentChargePending && !isPaymentFailed) {
        log.info(`Subscription Payment ${payment} do not have Transaction in pending state`);
        const eventCartId = dataInvoice.subscription_details?.metadata?.cart_id;
        if (!eventCartId) {
          log.error(`Cannot process invoice with ID: ${dataInvoice.id}. Missing cart.`);
          return;
        }

        const cart = await this.ctCartService.getCart({ id: eventCartId });
        //If it is invoice.payment_failed the amount is the amount_due
        const isInvoicePaid = event.type.startsWith('invoice.paid');
        const amountPlanned: Money = {
          currencyCode: dataInvoice.currency.toUpperCase(),
          centAmount: isInvoicePaid ? dataInvoice.amount_paid : dataInvoice.amount_due,
        };
        const createdPayment = await this.paymentCreationService.handleCtPaymentSubscription({
          cart,
          amountPlanned,
          interactionId: updateData.pspReference,
        });

        await this.paymentService.addPaymentToOrder(payment.id, createdPayment);
        updateData.id = createdPayment;
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

      const cart = await this.ctCartService.getCartByPaymentId({ paymentId: payment.id });
      if (cart.cartState !== 'Ordered') {
        log.info('Updating cart address after processing the notification', {
          ctCartId: cart.id,
          invoiceId: invoiceExpanded.id,
        });
        const updatedCart = await this.paymentService.updateCartAddress(invoiceExpanded.charge as Stripe.Charge, cart);
        await this.paymentService.createOrder({ cart: updatedCart, paymentIntentId: updateData.pspReference });
      }
    } catch (e) {
      log.error('Error processing notification', { error: e });
      return;
    }
  }
}
