import crypto from 'crypto';
import Stripe from 'stripe';
import { healthCheckCommercetoolsPermissions, Money, statusHandler } from '@commercetools/connect-payments-sdk';
import {
  CancelPaymentRequest,
  CapturePaymentRequest,
  ConfigResponse,
  PaymentProviderModificationResponse,
  RefundPaymentRequest,
  StatusResponse,
} from './types/operation.type';
import { SupportedPaymentComponentsSchemaDTO } from '../dtos/operations/payment-componets.dto';
import { PaymentModificationStatus, PaymentTransactions } from '../dtos/operations/payment-intents.dto';
import packageJSON from '../../package.json';
import { AbstractPaymentService } from './abstract-payment.service';
import { getConfig } from '../config/config';
import { appLogger, paymentSDK } from '../payment-sdk';
import {
  CaptureMethod,
  CreateOrderProps,
  PaymentStatus,
  StripeEvent,
  StripePaymentServiceOptions,
} from './types/stripe-payment.type';
import {
  CollectBillingAddressOptions,
  ConfigElementResponseSchemaDTO,
  PaymentOutcome,
  PaymentResponseSchemaDTO,
} from '../dtos/stripe-payment.dto';
import { getCartIdFromContext, getMerchantReturnUrlFromContext } from '../libs/fastify/context/context';
import { stripeApi, wrapStripeError } from '../clients/stripe.client';
import { log } from '../libs/logger';
import { StripeEventConverter } from './converters/stripeEventConverter';
import { convertPaymentResultCode } from '../utils';
import { SubscriptionEventConverter } from './converters/subscriptionEventConverter';
import { CtPaymentCreationService } from './ct-payment-creation.service';
import { stripeCustomerIdFieldName } from '../custom-types/custom-types';
import { StripeCustomerService } from './stripe-customer.service';
import { getCartExpanded } from './commerce-tools/cart-client';
import { METADATA_ORDER_ID_FIELD } from '../constants';
import { addOrderPayment, createOrderFromCart } from './commerce-tools/order-client';
import { StripeSubscriptionService } from './stripe-subscription.service';

const stripe = stripeApi();

export class StripePaymentService extends AbstractPaymentService {
  private stripeEventConverter: StripeEventConverter;
  private subscriptionEventConverter: SubscriptionEventConverter;
  private customerService: StripeCustomerService;
  private paymentCreationService: CtPaymentCreationService;

  constructor(opts: StripePaymentServiceOptions) {
    super(opts.ctCartService, opts.ctPaymentService, opts.ctOrderService);
    this.stripeEventConverter = new StripeEventConverter();
    this.subscriptionEventConverter = new SubscriptionEventConverter();
    this.customerService = new StripeCustomerService(opts.ctCartService);
    this.paymentCreationService = new CtPaymentCreationService({
      ctCartService: opts.ctCartService,
      ctPaymentService: opts.ctPaymentService,
    });
  }

  /**
   * Get configurations
   *
   * @remarks
   * Implementation to provide mocking configuration information
   *
   * @returns Promise with mocking object containing configuration information
   */
  public async config(): Promise<ConfigResponse> {
    const config = getConfig();
    return {
      environment: config.mockEnvironment,
      publishableKey: config.stripePublishableKey,
    };
  }

  /**
   * Get status
   *
   * @remarks
   * Implementation to provide mocking status of external systems
   *
   * @returns Promise with mocking data containing a list of status from different external systems
   */
  public async status(): Promise<StatusResponse> {
    const handler = await statusHandler({
      timeout: getConfig().healthCheckTimeout,
      log: appLogger,
      checks: [
        healthCheckCommercetoolsPermissions({
          requiredPermissions: [
            'manage_payments',
            'view_sessions',
            'view_api_clients',
            'manage_orders',
            'introspect_oauth_tokens',
            'manage_checkout_payment_intents',
            'manage_types',
          ],
          ctAuthorizationService: paymentSDK.ctAuthorizationService,
          projectKey: getConfig().projectKey,
        }),
        async () => {
          try {
            const paymentMethods = await stripeApi().paymentMethods.list({
              limit: 3,
            });
            return {
              name: 'Stripe Status check',
              status: 'UP',
              message: 'Stripe api is working',
              details: {
                paymentMethods,
              },
            };
          } catch (e) {
            return {
              name: 'Stripe Status check',
              status: 'DOWN',
              message: 'The mock paymentAPI is down for some reason. Please check the logs for more details.',
              details: {
                error: e,
              },
            };
          }
        },
      ],
      metadataFn: async () => ({
        name: packageJSON.name,
        description: packageJSON.description,
        '@commercetools/connect-payments-sdk': packageJSON.dependencies['@commercetools/connect-payments-sdk'],
        stripe: packageJSON.dependencies['stripe'],
      }),
    })();

    return handler.body;
  }

  /**
   * Get supported payment components
   *
   * @remarks
   * Implementation to provide the mocking payment components supported by the processor.
   *
   * @returns Promise with mocking data containing a list of supported payment components
   */
  public async getSupportedPaymentComponents(): Promise<SupportedPaymentComponentsSchemaDTO> {
    return {
      dropins: [
        {
          type: 'embedded',
        },
      ],
      components: [],
    };
  }

  /**
   * Capture payment in Stripe.
   *
   * @remarks
   * MVP: capture the total amount
   *
   * @param {CapturePaymentRequest} request - Information about the ct payment and the amount.
   * @returns Promise with mocking data containing operation status and PSP reference
   */
  public async capturePayment(request: CapturePaymentRequest): Promise<PaymentProviderModificationResponse> {
    try {
      const paymentIntentId = request.payment.interfaceId as string;
      const amount = request.amount.centAmount;
      const response = await stripeApi().paymentIntents.capture(paymentIntentId, {
        amount_to_capture: amount,
      });

      if (response.status === 'succeeded') {
        return {
          outcome: PaymentModificationStatus.APPROVED,
          pspReference: response.id,
        };
      } else {
        log.warn('Stripe capture did not succeed as expected', { status: response.status, id: response.id });
        return {
          outcome: PaymentModificationStatus.REJECTED,
          pspReference: response.id,
        };
      }
    } catch (error) {
      log.error('Error capturing payment in Stripe', { error });
      return {
        outcome: PaymentModificationStatus.REJECTED,
        pspReference: request.payment.interfaceId as string,
      };
    }
  }

  /**
   * Cancel payment in Stripe.
   *
   * @param {CancelPaymentRequest} request - contains amount and {@link https://docs.commercetools.com/api/projects/payments | Payment } defined in composable commerce
   * @returns Promise with mocking data containing operation status and PSP reference
   */
  public async cancelPayment(request: CancelPaymentRequest): Promise<PaymentProviderModificationResponse> {
    try {
      const paymentIntentId = request.payment.interfaceId as string;
      await stripeApi().paymentIntents.cancel(paymentIntentId);
      return { outcome: PaymentModificationStatus.APPROVED, pspReference: paymentIntentId };
    } catch (error) {
      log.error('Error canceling payment in Stripe', { error });
      return {
        outcome: PaymentModificationStatus.REJECTED,
        pspReference: request.payment.interfaceId as string,
      };
    }
  }

  /**
   * Refund payment in Stripe.
   *
   * @param {RefundPaymentRequest} request - contains amount and {@link https://docs.commercetools.com/api/projects/payments | Payment } defined in composable commerce
   * @returns Promise with mocking data containing operation status and PSP reference
   */
  public async refundPayment(request: RefundPaymentRequest): Promise<PaymentProviderModificationResponse> {
    try {
      const paymentIntentId = request.payment.interfaceId as string;
      const amount = request.amount.centAmount;
      await stripeApi().refunds.create({
        payment_intent: paymentIntentId,
        amount: amount,
      });
      return { outcome: PaymentModificationStatus.RECEIVED, pspReference: paymentIntentId };
    } catch (error) {
      log.error('Error refunding payment in Stripe', { error });
      return {
        outcome: PaymentModificationStatus.REJECTED,
        pspReference: request.payment.interfaceId as string,
      };
    }
  }

  /**
   * Creates a payment intent using the Stripe API and create commercetools payment with Initial transaction.
   *
   * @param cart
   * @return Promise<PaymentResponseSchemaDTO> A Promise that resolves to a PaymentResponseSchemaDTO object containing the client secret and payment reference.
   */
  public async createPaymentIntent(): Promise<PaymentResponseSchemaDTO> {
    try {
      const config = getConfig();
      const cart = await this.ctCartService.getCart({ id: getCartIdFromContext() });
      const setupFutureUsage = config.stripeSavedPaymentMethodConfig?.payment_method_save_usage;
      const customer = await this.customerService.getCtCustomer(cart.customerId!);
      const amountPlanned = await this.ctCartService.getPaymentAmount({ cart });
      const shippingAddress = this.customerService.getStripeCustomerAddress(
        cart.shippingAddress,
        customer?.addresses[0],
      );
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
          metadata: this.paymentCreationService.getPaymentMetadata(cart),
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

      const paymentReference = await this.paymentCreationService.handleCtPaymentCreation({
        interactionId: paymentIntent.id,
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
    } catch (error) {
      throw wrapStripeError(error);
    }
  }

  /**
   * Update the PaymentIntent in Stripe to mark the Authorization in commercetools as successful.
   *
   * @param {string} paymentIntentId - The Intent id created in Stripe.
   * @param {string} paymentReference - The identifier of the payment associated with the PaymentIntent in Stripe.
   * @return {Promise<void>} - A Promise that resolves when the PaymentIntent is successfully updated.
   */
  public async updatePaymentIntentStripeSuccessful(paymentIntentId: string, paymentReference: string): Promise<void> {
    try {
      const ctCart = await this.ctCartService.getCart({ id: getCartIdFromContext() });
      const ctPayment = await this.ctPaymentService.getPayment({ id: paymentReference });
      const amountPlanned = ctPayment.amountPlanned;

      log.info(`PaymentIntent confirmed.`, {
        ctCartId: ctCart.id,
        stripePaymentIntentId: ctPayment.interfaceId,
        amountPlanned: JSON.stringify(amountPlanned),
      });

      await this.ctPaymentService.updatePayment({
        id: ctPayment.id,
        pspReference: paymentIntentId,
        transaction: {
          interactionId: paymentIntentId,
          type: PaymentTransactions.AUTHORIZATION,
          amount: amountPlanned,
          state: convertPaymentResultCode(PaymentOutcome.AUTHORIZED as PaymentOutcome),
        },
      });
    } catch (error) {
      console.log('updatePaymentIntentStripeSuccessful error', JSON.stringify(error, null, 2));
    }
  }

  /**
   * Return the Stripe payment configuration and the cart amount planed information.
   *
   * @return {Promise<ConfigElementResponseSchemaDTO>} Returns a promise that resolves with the cart information, appearance, and capture method.
   */
  public async initializeCartPayment(paymentType: string): Promise<ConfigElementResponseSchemaDTO> {
    const {
      stripePaymentElementAppearance,
      stripeExpressCheckoutAppearance,
      stripeCaptureMethod,
      stripeSavedPaymentMethodConfig,
      stripeLayout,
      stripeCollectBillingAddress,
    } = getConfig();
    const webElement = paymentType;
    const cart = await getCartExpanded();
    const amountPlanned = await this.ctCartService.getPaymentAmount({ cart });
    const appearance =
      webElement === 'paymentElement' ? stripePaymentElementAppearance : stripeExpressCheckoutAppearance;
    const setupFutureUsage = stripeSavedPaymentMethodConfig.payment_method_save_usage;
    const subscriptionService = new StripeSubscriptionService({
      ctCartService: this.ctCartService,
      ctPaymentService: this.ctPaymentService,
      ctOrderService: this.ctOrderService,
    });
    const paymentMode = await subscriptionService.getPaymentMode(cart);

    log.info(`Cart and ${webElement} config retrieved.`, {
      cartId: cart.id,
      cartInfo: {
        amount: amountPlanned.centAmount,
        currency: amountPlanned.currencyCode,
      },
      stripeElementAppearance: appearance,
      stripeCaptureMethod: stripeCaptureMethod,
      webElements: webElement,
      stripeSetupFutureUsage: setupFutureUsage,
      layout: stripeLayout,
      collectBillingAddress: stripeCollectBillingAddress,
      paymentMode,
    });

    return {
      cartInfo: {
        amount: amountPlanned.centAmount,
        currency: amountPlanned.currencyCode,
      },
      appearance,
      captureMethod: stripeCaptureMethod,
      webElements: webElement,
      setupFutureUsage,
      layout: stripeLayout,
      collectBillingAddress: stripeCollectBillingAddress as CollectBillingAddressOptions,
      paymentMode,
    };
  }

  /**
   * Return the Stripe payment configuration and the cart amount planed information.
   *
   * @return {Promise<ConfigElementResponseSchemaDTO>} Returns a promise that resolves with the cart information, appearance, and capture method.
   */
  public applePayConfig(): string {
    return getConfig().stripeApplePayWellKnown;
  }

  /**
   * Retrieves modified payment data based on the given Stripe event.
   *
   * @param {Stripe.Event} event - The Stripe event object to extract data from.
   * @return {ModifyPayment} - An object containing modified payment data.
   */
  public async processStripeEvent(event: Stripe.Event): Promise<void> {
    log.info('Processing notification', { event: JSON.stringify(event.id) });
    try {
      const updateData = this.stripeEventConverter.convert(event);

      for (const tx of updateData.transactions) {
        const updatedPayment = await this.ctPaymentService.updatePayment({
          ...updateData,
          transaction: tx,
        });

        log.info('Payment updated after processing the notification', {
          paymentId: updatedPayment.id,
          version: updatedPayment.version,
          pspReference: updateData.pspReference,
          paymentMethod: updateData.paymentMethod,
          transaction: JSON.stringify(tx),
        });
      }

      if (event.type === StripeEvent.PAYMENT_INTENT__SUCCEEDED) {
        const ctCart = await this.ctCartService.getCartByPaymentId({ paymentId: updateData.id });
        await this.createOrder({ cart: ctCart, paymentIntentId: updateData.pspReference });
      }
    } catch (e) {
      log.error('Error processing notification', { error: e });
      return;
    }
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

        await this.addPaymentToOrder(payment.id, createdPayment);
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
    } catch (e) {
      log.error('Error processing notification', { error: e });
      return;
    }
  }

  public async createOrder({ cart, subscriptionId, paymentIntentId }: CreateOrderProps) {
    const order = await createOrderFromCart(cart);
    log.info('Order created successfully', {
      ctOrderId: order.id,
      ctCartId: cart.id,
      stripeSubscriptionId: subscriptionId,
    });

    if (paymentIntentId) {
      await stripe.paymentIntents.update(
        paymentIntentId,
        { metadata: { [METADATA_ORDER_ID_FIELD]: order.id } },
        { idempotencyKey: crypto.randomUUID() },
      );
    }

    if (subscriptionId) {
      await stripe.subscriptions.update(
        subscriptionId,
        { metadata: { [METADATA_ORDER_ID_FIELD]: order.id } },
        { idempotencyKey: crypto.randomUUID() },
      );
    }
  }

  public async addPaymentToOrder(subscriptionPaymentId: string, paymentId: string) {
    try {
      const order = await this.ctOrderService.getOrderByPaymentId({ paymentId: subscriptionPaymentId });
      await addOrderPayment(order, paymentId);
    } catch (error) {
      log.error('Error adding payment to order', { error });
    }
  }
}
