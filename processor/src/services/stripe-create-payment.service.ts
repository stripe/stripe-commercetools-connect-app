import Stripe from 'stripe';
import crypto from 'crypto';
import {
  Cart,
  CommercetoolsCartService,
  CommercetoolsPaymentService,
  LineItem,
  Money,
} from '@commercetools/connect-payments-sdk';
import { PaymentAmount } from '@commercetools/connect-payments-sdk/dist/commercetools/types/payment.type';
import { PaymentTransactions } from '../dtos/operations/payment-intents.dto';
import { getConfig } from '../config/config';
import { CaptureMethod, StripePaymentServiceOptions } from './types/stripe-payment.type';
import { PaymentOutcome, PaymentResponseSchemaDTO } from '../dtos/stripe-payment.dto';
import { getMerchantReturnUrlFromContext, getPaymentInterfaceFromContext } from '../libs/fastify/context/context';
import { stripeApi } from '../clients/stripe.client';
import { log } from '../libs/logger';
import { StripeCustomerService } from './stripe-customer.service';
import { convertPaymentResultCode } from '../utils';
import { stripeCustomerIdFieldName } from '../custom-types/custom-types';

const stripe = stripeApi();

export class StripeCreatePaymentService {
  private customerService: StripeCustomerService;
  private ctCartService: CommercetoolsCartService;
  private ctPaymentService: CommercetoolsPaymentService;

  constructor(opts: StripePaymentServiceOptions) {
    this.ctCartService = opts.ctCartService;
    this.ctPaymentService = opts.ctPaymentService;
    this.customerService = new StripeCustomerService(opts.ctCartService);
  }

  /**
   * Creates a payment intent using the Stripe API and create commercetools payment with Initial transaction.
   *
   * @param cart
   * @return Promise<PaymentResponseSchemaDTO> A Promise that resolves to a PaymentResponseSchemaDTO object containing the client secret and payment reference.
   */
  public async createPaymentIntent(cart: Cart): Promise<PaymentResponseSchemaDTO> {
    const config = getConfig();
    const setupFutureUsage = config.stripeSavedPaymentMethodConfig?.payment_method_save_usage;
    const customer = await this.customerService.getCtCustomer(cart.customerId!);
    const amountPlanned = await this.ctCartService.getPaymentAmount({ cart });
    const shippingAddress = this.customerService.getStripeCustomerAddress(cart.shippingAddress, customer?.addresses[0]);
    const stripeCustomerId = customer?.custom?.fields?.[stripeCustomerIdFieldName];
    const paymentIntent = await stripe.paymentIntents.create(
      {
        ...(stripeCustomerId && {
          customer: stripeCustomerId,
          setup_future_usage: setupFutureUsage,
        }),
        amount: amountPlanned.centAmount,
        currency: amountPlanned.currencyCode,
        automatic_payment_methods: {
          enabled: true,
        },
        capture_method: config.stripeCaptureMethod as CaptureMethod,
        metadata: this.getPaymentMetadata(cart),
        shipping: shippingAddress,
      },
      {
        idempotencyKey: crypto.randomUUID(),
      },
    );

    log.info(`Stripe PaymentIntent created.`, {
      ctCartId: cart.id,
      stripePaymentIntentId: paymentIntent.id,
    });

    const paymentReference = await this.handleCtPaymentCreation({
      paymentIntentId: paymentIntent.id,
      amountPlanned,
      cart,
    });

    return {
      cartId: cart.id,
      clientSecret: paymentIntent.client_secret!,
      paymentReference,
      merchantReturnUrl: getMerchantReturnUrlFromContext() || config.merchantReturnUrl,
      ...(config.stripeCollectBillingAddress !== 'auto' && {
        billingAddress: this.customerService.getBillingAddress(cart),
      }),
    };
  }

  /**
   * Creates a subscription using the Stripe API and create commercetools payment with Initial transaction.
   *
   * @param cart
   * @returns Promise<PaymentResponseSchemaDTO> A Promise that resolves to a PaymentResponseSchemaDTO object containing the client secret and payment reference.
   */
  public async createSubscription(cart: Cart): Promise<PaymentResponseSchemaDTO> {
    const config = getConfig();
    const amountPlanned = await this.ctCartService.getPaymentAmount({ cart });
    const priceId = await this.getSubscriptionPriceId(cart, amountPlanned);
    const customer = await this.customerService.getCtCustomer(cart.customerId!);
    const stripeCustomerId = customer?.custom?.fields?.[stripeCustomerIdFieldName];

    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomerId!,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata: this.getPaymentMetadata(cart),
      //TODO: Add additional fields from product attributes
    });

    if (
      typeof subscription.latest_invoice === 'string' ||
      typeof subscription.latest_invoice?.payment_intent === 'string' ||
      !subscription.latest_invoice?.payment_intent?.client_secret
    ) {
      throw 'Failed to create Subscription.';
    }

    const paymentIntentId = subscription.latest_invoice.payment_intent.id;
    const clientSecret = subscription.latest_invoice.payment_intent.client_secret;

    log.info(`Stripe Subscription created.`, {
      ctCartId: cart.id,
      stripeSubscriptionId: subscription.id,
      stripePaymentIntentId: paymentIntentId,
    });

    const paymentReference = await this.handleCtPaymentCreation({
      subscriptionId: subscription.id,
      paymentIntentId,
      amountPlanned,
      cart,
    });

    return {
      cartId: cart.id,
      clientSecret,
      paymentReference,
      merchantReturnUrl: getMerchantReturnUrlFromContext() || config.merchantReturnUrl,
      ...(config.stripeCollectBillingAddress !== 'auto' && {
        billingAddress: this.customerService.getBillingAddress(cart),
      }),
    };
  }

  public async createCtPayment({
    cart,
    amountPlanned,
    paymentIntentId,
    isSubscription = false,
  }: {
    cart: Cart;
    amountPlanned: Money;
    paymentIntentId: string;
    isSubscription?: boolean;
  }): Promise<string> {
    const response = await this.ctPaymentService.createPayment({
      amountPlanned,
      paymentMethodInfo: {
        paymentInterface: getPaymentInterfaceFromContext() || 'stripe',
        method: isSubscription ? 'subscription' : 'payment',
      },
      ...(cart.customerId
        ? { customer: { typeId: 'customer', id: cart.customerId } }
        : cart.anonymousId
          ? { anonymousId: cart.anonymousId }
          : null),
      transactions: [
        {
          type: PaymentTransactions.AUTHORIZATION,
          amount: amountPlanned,
          state: convertPaymentResultCode(PaymentOutcome.INITIAL as PaymentOutcome),
          interactionId: paymentIntentId,
        },
      ],
    });
    if (!response.id) {
      throw 'Failed to create CT payment.';
    }
    return response.id;
  }

  public async addCtPayment({ cart, ctPaymentId }: { cart: Cart; ctPaymentId: string }): Promise<void> {
    await this.ctCartService.addPayment({
      resource: {
        id: cart.id,
        version: cart.version,
      },
      paymentId: ctPaymentId,
    });
  }

  public async handleCtPaymentCreation({
    cart,
    amountPlanned,
    paymentIntentId,
    subscriptionId,
  }: {
    cart: Cart;
    amountPlanned: PaymentAmount;
    paymentIntentId: string;
    subscriptionId?: string;
  }): Promise<string> {
    const ctPaymentId = await this.createCtPayment({
      cart,
      amountPlanned,
      paymentIntentId,
      isSubscription: Boolean(subscriptionId),
    });

    await this.addCtPayment({ cart, ctPaymentId });

    log.info(`Commercetools Payment and initial transaction created.`, {
      ctCartId: cart.id,
      ctPaymentId,
      paymentIntentId,
    });

    await this.updatePaymentMetadata({
      cart,
      ctPaymentId,
      paymentIntentId,
      subscriptionId,
    });

    return ctPaymentId;
  }

  public async updatePaymentMetadata({
    cart,
    ctPaymentId,
    paymentIntentId,
    subscriptionId,
  }: {
    cart: Cart;
    ctPaymentId: string;
    paymentIntentId: string;
    subscriptionId?: string;
  }): Promise<void> {
    const updatePaymentIntent = stripe.paymentIntents.update(
      paymentIntentId,
      {
        metadata: {
          //Metadata is not initially set in the payment intent when subscription is created
          ...(subscriptionId ? this.getPaymentMetadata(cart) : null),
          ct_payment_id: ctPaymentId,
        },
      },
      { idempotencyKey: crypto.randomUUID() },
    );
    const requests: Promise<Stripe.Response<Stripe.Subscription> | Stripe.Response<Stripe.PaymentIntent>>[] = [
      updatePaymentIntent,
    ];

    if (subscriptionId) {
      const updateSubscription = stripe.subscriptions.update(
        subscriptionId,
        { metadata: { ct_payment_id: ctPaymentId } },
        { idempotencyKey: crypto.randomUUID() },
      );
      requests.push(updateSubscription);
    }

    await Promise.all(requests);
    log.info(`Stripe update Payment id metadata.`);
  }

  /**
   * Retrieves the Stripe price ID for the given cart and amount. If it doesn't exist, creates a new Stripe price.
   *
   * @param cart
   * @param amount
   * @returns The Stripe price ID.
   */
  public async getSubscriptionPriceId(cart: Cart, amount: PaymentAmount): Promise<string> {
    const product = cart.lineItems[0];
    const stripePrice = await stripe.prices.search({
      query: `metadata['ct_variant_sku']:'${product.variant.sku}' AND
              metadata['ct_price_id']:'${product.price.id}'`,
    });

    if (stripePrice.data.length && stripePrice.data[0].id) {
      const stripePriceId = stripePrice.data[0].id;
      log.info(`Found existing price ID: ${stripePriceId}`);
      return stripePriceId;
    }

    log.info(`No stripe price was found with metadata specified. A new one will be created.`);
    const stripeProductId = await this.getStripeProduct(product);
    const newStripePriceId = await this.createStripePrice({ amount, product, stripeProductId });

    log.info(`Stripe price created.`, {
      ctProductId: product.productId,
      ctPrice: amount.centAmount,
      stripePriceId: newStripePriceId,
      stripeProductId,
    });

    return newStripePriceId;
  }

  /**
   * Retrieves the Stripe product ID for the given CT product ID. If it doesn't exist, creates a new Stripe product.
   *
   * @param product The CT product for which the Stripe product ID is being retrieved.
   * @returns The Stripe product ID.
   */
  public async getStripeProduct(product: LineItem): Promise<string> {
    const stripeProduct = await stripe.products.search({
      query: `metadata['ct_product_id']:'${product.productId}'`,
    });

    if (stripeProduct.data.length && stripeProduct.data[0].id) {
      const stripeProductId = stripeProduct.data[0].id;
      log.info(`Found existing product ID: ${stripeProductId}`);
      return stripeProductId;
    }

    log.info(`No stripe product found was found with metadata specified. A new one will be created.`);
    const newProductId = await this.createStripeProduct(product);
    return newProductId;
  }

  /**
   * Creates a Stripe product for the given CT product ID.
   *
   * @param product The CT product for which the Stripe product is being created.
   * @returns The ID of the created Stripe product.
   */
  public async createStripeProduct(product: LineItem): Promise<string> {
    //TODO: get locale from cart or config
    const locale = 'en-US';
    const newProduct = await stripe.products.create({
      name: product.name[locale] ?? product.name,
      metadata: {
        ct_product_id: product.productId,
      },
      //TODO: Add additional fields from product attributes?
    });

    if (!newProduct.id) {
      throw 'Failed to create new stripe product.';
    }

    log.info(`Stripe product created.`, {
      ctProductId: product.productId,
      stripeProductId: newProduct.id,
    });
    return newProduct.id;
  }

  /**
   * Creates a Stripe price for the given product and amount.
   *
   * @param amount The amount to be charged.
   * @param product The product for which the price is being created.
   * @param stripeProductId The ID of the Stripe product.
   * @returns The ID of the created Stripe price.
   */
  public async createStripePrice({
    amount,
    product,
    stripeProductId,
  }: {
    amount: PaymentAmount;
    product: LineItem;
    stripeProductId: string;
  }) {
    const price = await stripe.prices.create({
      currency: amount.currencyCode,
      product: stripeProductId,
      unit_amount: amount.centAmount,
      metadata: {
        ct_variant_sku: product.variant.sku!,
        ct_price_id: product.price.id,
      },
      //TODO: Add additional fields from product attributes?
      recurring: {
        interval: 'month',
        interval_count: 1,
      },
    });

    if (!price || !price.id) {
      throw 'Failed to create stripe product price.';
    }

    return price.id;
  }

  public getPaymentMetadata(cart: Cart): Record<string, string> {
    const { projectKey } = getConfig();
    return {
      cart_id: cart.id,
      ct_project_key: projectKey,
      ...(cart.customerId ? { ct_customer_id: cart.customerId } : null),
    };
  }

  public async getStripeInvoiceExpanded(invoiceId: string): Promise<Stripe.Invoice> {
    try {
      return await stripe.invoices.retrieve(invoiceId, {
        expand: ['payment_intent', 'subscription', 'charge'],
      });
    } catch (err) {
      log.error(`Failed to retrieve invoice: ${err}`);
      throw new Error(`Failed to retrieve invoice id: ${invoiceId}.`);
    }
  }

  public async handleCtPaymentSubscription({
    cart,
    amountPlanned,
    invoiceId,
  }: {
    cart: Cart;
    amountPlanned: Money;
    invoiceId: string;
  }): Promise<string> {
    log.info(`Received invoice id: ${invoiceId}.`);
    const ctPaymentId = await this.createCtPayment({
      cart,
      amountPlanned,
      paymentIntentId: invoiceId,
      isSubscription: true,
    });

    log.info(`Commercetools Subscription Payment transaction initial created.`, {
      ctCartId: cart.id,
      ctPaymentId,
      invoiceId,
    });

    return ctPaymentId;
  }
}
