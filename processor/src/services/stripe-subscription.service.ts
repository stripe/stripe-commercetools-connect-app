import Stripe from 'stripe';
import { randomUUID } from 'crypto';
import {
  Cart,
  CommercetoolsCartService,
  CommercetoolsOrderService,
  CommercetoolsPaymentService,
  LineItem,
  Money,
  Payment,
} from '@commercetools/connect-payments-sdk';
import {
  CartDraft,
  CartSetLineItemCustomFieldAction,
  CartSetLineItemCustomTypeAction,
  CartUpdateAction,
  Customer,
  Order,
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
import { paymentSDK } from '../payment-sdk';
import { StripeCustomerService } from './stripe-customer.service';
import { getLocalizedString, transformVariantAttributes } from '../utils';
import {
  lineItemStripeSubscriptionIdField,
  productTypeSubscription,
  stripeCustomerIdFieldName,
  typeLineItem,
} from '../custom-types/custom-types';
import { getSubscriptionAttributes, getSubscriptionUpdateAttributes } from '../mappers/subscription-mapper';
import { CtPaymentCreationService } from './ct-payment-creation.service';
import { getCartExpanded, updateCartById } from './commerce-tools/cart-client';
import { getCustomFieldUpdateActions } from './commerce-tools/custom-type-helper';
import {
  METADATA_CART_ID_FIELD,
  METADATA_CUSTOMER_ID_FIELD,
  METADATA_PAYMENT_ID_FIELD,
  METADATA_PRICE_ID_FIELD,
  METADATA_PRODUCT_ID_FIELD,
  METADATA_SHIPPING_PRICE_AMOUNT,
  METADATA_VARIANT_SKU_FIELD,
  METADATA_PROJECT_KEY_FIELD,
} from '../constants';
import { StripePaymentService } from './stripe-payment.service';
import { StripeCouponService } from './stripe-coupon.service';
import { getCustomerById } from './commerce-tools/customer-client';
import { getProductById, getProductMasterPrice, getPriceFromProduct } from './commerce-tools/price-client';
import { createCartWithProduct } from './commerce-tools/cart-client';
import { SubscriptionEventConverter } from './converters/subscriptionEventConverter';
import { PaymentTransactions } from '../dtos/operations/payment-intents.dto';
import { PaymentStatus, StripeEventUpdatePayment } from './types/stripe-payment.type';

const stripe = stripeApi();

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
      throw wrapStripeError(error);
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
      if (oneTimeItems.length > 0) {
        await this.createOneTimeItemsInvoice(cart, stripeCustomerId!, oneTimeItems);
      }

      const subscription = await stripe.subscriptions.create(
        {
          ...subscriptionParams,
          customer: stripeCustomerId!,
          items: [
            { price: priceId, quantity: this.findSubscriptionLineItem(cart).quantity || 1 },
            ...(shippingPriceId ? [{ price: shippingPriceId }] : []),
          ],
          payment_behavior: 'default_incomplete',
          payment_settings: { save_default_payment_method: 'on_subscription' },
          expand: ['latest_invoice.payment_intent'],
          metadata: this.paymentCreationService.getPaymentMetadata(cart),
          discounts: await this.stripeCouponService.getStripeCoupons(cart),
        },
        { idempotencyKey: randomUUID() },
      );

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
      const { cart, priceId, stripeCustomerId, subscriptionParams, amountPlanned, shippingPriceId } =
        await this.prepareSubscriptionData();
      const { payment_method: paymentMethodId } = await stripe.setupIntents.retrieve(setupIntentId);
      const { hasFreeAnchorDays, isSendInvoice } = this.getSubscriptionTypes(subscriptionParams);

      if (!paymentMethodId || typeof paymentMethodId !== 'string') {
        throw new Error('Failed to create Subscription. Invalid setup intent.');
      }

      const oneTimeItems = await this.getAllLineItemPrices(cart);
      if (oneTimeItems.length > 0) {
        await this.createOneTimeItemsInvoice(cart, stripeCustomerId!, oneTimeItems);
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
          expand: ['latest_invoice'],
          payment_settings: { save_default_payment_method: 'on_subscription' },
          metadata: this.paymentCreationService.getPaymentMetadata(cart),
          discounts: await this.stripeCouponService.getStripeCoupons(cart),
        },
        { idempotencyKey: randomUUID() },
      );

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

    const subscriptionLineItem = this.findSubscriptionLineItem(cart);

    const customer = await this.customerService.getCtCustomer(cart.customerId!);
    const stripeCustomerId: string = customer?.custom?.fields?.[stripeCustomerIdFieldName];
    const subscriptionParams = getSubscriptionAttributes(subscriptionLineItem.variant.attributes);
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
    const amount: ExtendedPaymentAmount = {
      centAmount: lineItem.price.value.centAmount,
      totalCentAmount: lineItem.price.value.centAmount * lineItem.quantity,
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
   * Get all line item prices for the cart, excluding the subscription line item
   * @param cart - The cart EXPANDED to get the line item prices for
   * @returns An array of line item prices
   */
  private async getAllLineItemPrices(cart: Cart): Promise<Array<{ price: string; quantity: number }>> {
    const lineItemPrices: Array<{ price: string; quantity: number }> = [];

    for (const lineItem of cart.lineItems) {
      if (lineItem.productType.obj?.name === productTypeSubscription.name) {
        continue;
      }

      const priceId = await this.getLineItemPriceId(lineItem);
      lineItemPrices.push({
        price: priceId,
        quantity: lineItem.quantity || 1,
      });
    }

    return lineItemPrices;
  }

  private async createOneTimeItemsInvoice(
    cart: Cart,
    stripeCustomerId: string,
    oneTimeItems: Array<{ price: string; quantity: number }>,
  ): Promise<void> {
    try {
      for (const item of oneTimeItems) {
        await stripe.invoiceItems.create(
          {
            customer: stripeCustomerId,
            price: item.price,
            quantity: item.quantity,
            description: 'One-time item from commercetools cart',
          },
          { idempotencyKey: randomUUID() },
        );
      }

      const invoice = await stripe.invoices.create(
        {
          customer: stripeCustomerId,
          metadata: {
            ...this.paymentCreationService.getPaymentMetadata(cart),
            type: 'one-time-items',
          },
        },
        { idempotencyKey: randomUUID() },
      );

      await stripe.invoices.finalizeInvoice(invoice.id);

      log.info('One-time items invoice created and finalized.', {
        ctCartId: cart.id,
        stripeInvoiceId: invoice.id,
        itemsCount: oneTimeItems.length,
      });
    } catch (error) {
      log.error('Failed to create one-time items invoice.', {
        ctCartId: cart.id,
        error: error,
      });
      throw error;
    }
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
      const subscriptionLineItem = this.findSubscriptionLineItem(cart);
      const subscriptionParams = getSubscriptionAttributes(subscriptionLineItem.variant.attributes!);
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
          isPending: isSendInvoice || hasTrial ? true : false,
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
      log.error('Error getting payment mode', { error });
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
    const { centAmount, currencyCode, fractionDigits } = product.price.value;

    const totalCentAmount = centAmount * product.quantity;

    return { centAmount: centAmount, totalCentAmount: totalCentAmount, currencyCode, fractionDigits };
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
      log.error(`Failed to cancel subscription ${subscriptionId}`, { error });
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

      // If newSubscriptionVariantPosition is 1, use the master variant
      let newVariant;
      if (newSubscriptionVariantPosition === 1) {
        newVariant = newVariantProduct.masterData?.current?.masterVariant;
        log.warn(`Using master variant: ${newVariant?.id || 'Not found'}, sku: ${newVariant?.sku || 'Unknown'}`);
      } else {
        newVariant = newVariantProduct.masterData?.current?.variants?.find(
          (variant) => variant.id === newSubscriptionVariantPosition,
        );
        log.warn(`Found variant: ${newVariant?.id || 'Not found'}, sku: ${newVariant?.sku || 'Unknown'}`);
      }
      log.warn(`newVariant: ${JSON.stringify(newVariant, null, 2)}`);

      if (!newVariant) {
        throw new Error(
          `No variant found with ID ${newSubscriptionVariantPosition} in product ${newSubscriptionVariantId}`,
        );
      }

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
        error,
        customerId,
        newVariantId: newSubscriptionVariantId,
        newPriceId: newSubscriptionPriceId,
        variantPosition: newSubscriptionVariantPosition,
      });
      throw wrapStripeError(error);
    }
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
      const updatedSubscription = await stripe.subscriptions.update(subscriptionId, params, {
        ...options,
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
      log.error(`Failed to update subscription ${subscriptionId}`, { error });
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
        error,
        subscriptionId,
        metadata: { cart, ctPaymentId, customerId },
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

      const invoiceExpanded = await this.paymentCreationService.getStripeInvoiceExpanded(dataInvoiceId);

      const subscription = invoiceExpanded.subscription as Stripe.Subscription;
      const invoicePaymentIntent = invoiceExpanded.payment_intent as Stripe.PaymentIntent;
      let paymentId;
      if (subscription.metadata?.[METADATA_PAYMENT_ID_FIELD]) {
        paymentId = subscription.metadata?.[METADATA_PAYMENT_ID_FIELD];
      } else {
        //When the event comes from a setup intent subscritpion, we need to wait for the payment to be created
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const payments = await this.ctPaymentService.findPaymentsByInterfaceId({
          interfaceId: dataInvoiceId,
        });
        if (payments.length > 0) {
          paymentId = payments[0].id;
        }
      }
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
      const updateData = this.subscriptionEventConverter.convert(
        event,
        invoiceExpanded,
        isPaymentChargePending,
        payment,
      );
      if (!isPaymentChargePending && !isPaymentFailed) {
        const config = getConfig();
        const shouldCreateNewOrder = config.subscriptionPaymentHandling === 'createOrder';
        if (shouldCreateNewOrder) {
          log.info(
            `Creating new order for subscription payment ${updateData.id} (config: ${config.subscriptionPaymentHandling})`,
          );
          updateData.id = await this.handleSubscriptionPaymentCreateNewOrder(subscription, invoiceExpanded, updateData);
          log.info(`New order created successfully for subscription payment ${updateData.id}`);
        } else {
          log.info(
            `Adding payment to existing order for subscription payment ${updateData.id} (config: ${config.subscriptionPaymentHandling})`,
          );
          const eventCartId = invoiceExpanded.subscription_details?.metadata?.[METADATA_CART_ID_FIELD];
          if (!eventCartId) {
            log.error(`Cannot process invoice with ID: ${invoiceExpanded.id}. Missing cart.`);
            return;
          }
          const amountPlanned: Money = {
            currencyCode: invoiceExpanded.currency.toUpperCase(),
            centAmount: invoiceExpanded.amount_paid,
          };

          const cart = await this.ctCartService.getCart({ id: eventCartId! });
          const createdPayment = await this.paymentCreationService.handleCtPaymentSubscription({
            cart,
            amountPlanned,
            interactionId: updateData.pspReference || '',
          });

          await this.handleSubscriptionPaymentAddToOrder(cart, createdPayment, subscription, payment, updateData);
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
      log.error(`Error processing Subscription notification: ${JSON.stringify(e, null, 2)}`);
      return;
    }
  }

  public async processSubscriptionEventChargedRefund(event: Stripe.Event): Promise<void> {
    log.info('Processing subscription processSubscriptionEventChargedRefund notification', {
      event: JSON.stringify(event.id),
    });
    try {
      const dataInvoiceId = (event.data.object as Stripe.Charge).invoice as string;

      const invoiceExpanded = await this.paymentCreationService.getStripeInvoiceExpanded(dataInvoiceId);

      const subscription = invoiceExpanded.subscription as Stripe.Subscription;
      const paymentId = subscription.metadata?.[METADATA_PAYMENT_ID_FIELD];
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
      for (const tx of updateData.transactions) {
        const updatedPayment = await this.ctPaymentService.updatePayment({
          ...updateData,
          transaction: tx,
        });

        log.info(`Subscription payment updated after processing the notification ${updatedPayment.id}
          paymentId:  ${updatedPayment.id}
          version: updatedPayment.version}
          pspReference: ${updateData.pspReference}
          paymentMethod: ${updateData.paymentMethod}
          transaction: ${JSON.stringify(tx)}
        `);
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
      log.error(`Error processing Subscription notification: ${JSON.stringify(e, null, 2)}`);
      return;
    }
  }

  public async processSubscriptionEventFailed(event: Stripe.Event): Promise<void> {
    log.info('Processing subscription processSubscriptionEventFailed notification', {
      event: JSON.stringify(event.id),
    });
    try {
      const dataInvoiceId = (event.data.object as Stripe.Invoice).id;

      const invoiceExpanded = await this.paymentCreationService.getStripeInvoiceExpanded(dataInvoiceId);

      const subscription = invoiceExpanded.subscription as Stripe.Subscription;
      const invoicePaymentIntent = invoiceExpanded.payment_intent as Stripe.PaymentIntent;
      const paymentId = subscription.metadata?.[METADATA_PAYMENT_ID_FIELD];
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
      const updateData = this.subscriptionEventConverter.convert(
        event,
        invoiceExpanded,
        isPaymentChargePending,
        payment,
      );
      if (!isPaymentFailed) {
        const config = getConfig();
        const shouldCreateNewOrder = config.subscriptionPaymentHandling === 'createOrder';
        if (shouldCreateNewOrder) {
          await this.handleSubscriptionPaymentCreateNewOrder(subscription, invoiceExpanded, updateData);
        } else {
          const eventCartId = invoiceExpanded.subscription_details?.metadata?.[METADATA_CART_ID_FIELD];
          if (!eventCartId) {
            log.error(`Cannot process invoice with ID: ${invoiceExpanded.id}. Missing cart.`);
            return;
          }
          const amountPlanned: Money = {
            currencyCode: invoiceExpanded.currency.toUpperCase(),
            centAmount: invoiceExpanded.amount_due,
          };

          const cart = await this.ctCartService.getCart({ id: eventCartId! });
          const createdPayment = await this.paymentCreationService.handleCtPaymentSubscription({
            cart,
            amountPlanned,
            interactionId: updateData.pspReference || '',
          });

          await this.handleSubscriptionPaymentAddToOrder(cart, createdPayment, subscription, payment, updateData);
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
      log.error(
        `Error processing Subscription processSubscriptionEventFailed notification: ${JSON.stringify(e, null, 2)}`,
      );
      return;
    }
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
      const subscriptionId = (event.data.object as Stripe.Invoice).subscription;

      if (!subscriptionId) {
        log.warn('Skipping upcoming subscription price synchronization: no subscription ID found in event');
        return;
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId as string);

      await this.synchronizeSubscriptionPrice(subscription);
    } catch (e) {
      log.error(`Error processing upcoming subscription notification: ${JSON.stringify(e, null, 2)}`);
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
      log.error(`Error synchronizing subscription price ${subscription.id} ${JSON.stringify(error, null, 2)}`);
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
      log.error('Error getting commercetools product price', { error, productId });
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
      log.error(`Error getting or creating Stripe price ${ctProductId} ${JSON.stringify(error, null, 2)}`);
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
      log.error(`Error searching for existing Stripe price ${ctProductId} ${JSON.stringify(error, null, 2)}`);
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
      log.error('Error updating subscription price', { error, subscriptionId, newPriceId });
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
   */
  private async handleSubscriptionPaymentCreateNewOrder(
    subscription: Stripe.Subscription,
    invoiceExpanded: Stripe.Invoice,
    updateData: StripeEventUpdatePayment,
  ): Promise<string> {
    log.info('Creating new order for subscription payment', {
      paymentId: updateData.id,
      subscriptionId: subscription.id,
      invoiceId: invoiceExpanded.id,
      pspReference: updateData.pspReference,
    });
    const originalOrder = await this.ctOrderService.getOrderByPaymentId({ paymentId: updateData.id });

    const customerId = invoiceExpanded.subscription_details?.metadata?.[METADATA_CUSTOMER_ID_FIELD];
    if (!customerId) {
      throw new Error('Customer ID not found in invoice metadata');
    }
    const customer = await getCustomerById(customerId);
    if (!customer) {
      log.error(`Customer not found ${customerId}`);
      throw new Error('Customer not found');
    }

    const newCart = await this.createCartFromOrder(originalOrder, customer, subscription);
    const updatedCart = await this.paymentService.updateCartAddress(invoiceExpanded.charge as Stripe.Charge, newCart);
    const paymentAmount: PaymentAmount = {
      centAmount: updatedCart.totalPrice?.centAmount || 0,
      currencyCode: updatedCart.totalPrice?.currencyCode || 'USD',
      fractionDigits: updatedCart.totalPrice?.fractionDigits || 2,
    };

    if (invoiceExpanded.total > paymentAmount.centAmount) {
      paymentAmount.centAmount = invoiceExpanded.total;
    }
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
      log.error(`Failed to create cart from order ${originalOrder.id} ${JSON.stringify(error, null, 2)}`);
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
    const apiClient = paymentSDK.ctAPI.client;
    const cartDraft: CartDraft = {
      currency: originalOrder.totalPrice?.currencyCode || 'USD',
      customerId: customer.id,
      customerEmail: customer.email,
      country: originalOrder.shippingAddress?.country || originalOrder.billingAddress?.country || 'US',
    };

    const cartResponse = await apiClient
      .carts()
      .post({
        body: cartDraft,
      })
      .execute();

    let newCart = cartResponse.body;

    if (originalOrder.lineItems && originalOrder.lineItems.length > 0) {
      const subscriptionPrice = subscription.items.data[0].price;
      //Improvementes ideas:
      //Adding all the line items from the original order as subscription products
      //posible solution, use the old cart to get the line items and add them to the new cart
      //maybe we can use the stripe product infomration as the source of truth to add the line items to the new cart using this approche we can have multiple products items.
      // or we can create cart and order to update subscription and we keep the source of truth in teh line item in commercetools
      const lineItemActions: CartUpdateAction[] = originalOrder.lineItems.map((item: LineItem) => {
        if (
          item.variant.sku === subscriptionPrice.metadata?.[METADATA_VARIANT_SKU_FIELD] &&
          item.price.id === subscription.metadata?.[METADATA_PRICE_ID_FIELD]
        ) {
          return {
            action: 'addLineItem',
            productId: item.productId,
            variantId: item.variant?.id,
            quantity: item.quantity || 1,
            custom: {
              type: {
                typeId: 'type',
                key: typeLineItem.key,
              },
              fields: {
                [lineItemStripeSubscriptionIdField]: subscription.id,
              },
            },
          };
        } else {
          return {
            action: 'addLineItem',
            sku: subscriptionPrice.metadata?.[METADATA_VARIANT_SKU_FIELD],
            quantity: item.quantity || 1,
            custom: {
              type: {
                typeId: 'type',
                key: typeLineItem.key,
              },
              fields: {
                [lineItemStripeSubscriptionIdField]: subscription.id,
              },
            },
          };
        }
      });

      newCart = await updateCartById(newCart, lineItemActions);

      newCart = await getCartExpanded(newCart.id);
      const subscriptionLineItem = this.findSubscriptionLineItem(newCart);

      if (subscriptionLineItem.price.value.centAmount !== subscriptionPrice.unit_amount) {
        //If the subscription price is different from the original order price, use the external
        // price to add the value charged to the client in the comercetools payment
        const updateItemActions: CartUpdateAction[] = [
          {
            action: 'setLineItemPrice',
            lineItemId: subscriptionLineItem.id,
            externalPrice: {
              centAmount: subscription.items.data[0].price.unit_amount || 0,
              currencyCode: subscription.items.data[0].price.currency.toUpperCase(),
              fractionDigits: 2,
            },
          },
        ];
        newCart = await updateCartById(newCart, updateItemActions);
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
          log.error(`Error getting subscription price ${JSON.stringify(error, null, 2)}`);
        }
      }
    }

    if (originalOrder.shippingAddress || originalOrder.billingAddress) {
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

      if (addressActions.length > 0) {
        newCart = await updateCartById(newCart, addressActions);
      }
    }

    return newCart;
  }
}
