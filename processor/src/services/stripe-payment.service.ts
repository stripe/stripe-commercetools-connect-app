import crypto from 'crypto';
import Stripe from 'stripe';
import { Cart } from '@commercetools/platform-sdk';
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
import { StripeEvent, StripePaymentServiceOptions } from './types/stripe-payment.type';
import {
  CollectBillingAddressOptions,
  ConfigElementResponseSchemaDTO,
  PaymentOutcome,
  PaymentResponseSchemaDTO,
} from '../dtos/stripe-payment.dto';
import { getCartIdFromContext } from '../libs/fastify/context/context';
import { stripeApi, wrapStripeError } from '../clients/stripe.client';
import { log } from '../libs/logger';
import { StripeEventConverter } from './converters/stripeEventConverter';
import { convertPaymentResultCode } from '../utils';
import { StripeCreatePaymentService } from './stripe-create-payment.service';
import { SubscriptionEventConverter } from './converters/subscriptionEventConverter';

export class StripePaymentService extends AbstractPaymentService {
  private stripeEventConverter: StripeEventConverter;
  private subscriptionEventConverter: SubscriptionEventConverter;
  private createPaymentService: StripeCreatePaymentService;

  constructor(opts: StripePaymentServiceOptions) {
    super(opts.ctCartService, opts.ctPaymentService, opts.ctOrderService);
    this.stripeEventConverter = new StripeEventConverter();
    this.createPaymentService = new StripeCreatePaymentService(opts);
    this.subscriptionEventConverter = new SubscriptionEventConverter();
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
   * Handles the payment process by either creating a subscription or a payment intent.
   *
   * @return {Promise<PaymentResponseSchemaDTO>} A promise that resolves to a PaymentResponseSchemaDTO object.
   */
  public async handlePaymentCreation(): Promise<PaymentResponseSchemaDTO> {
    try {
      const cart = await this.getCartExpanded();
      //TODO: Make sure if the product type name is correct
      const subscriptionTypeName = 'subscription-information';
      const productType = cart.lineItems[0].productType.obj?.name;
      const isSubscription = productType === subscriptionTypeName;
      if (isSubscription) {
        //TODO: What happens with Subscription if the CT CustomerId is not set?
        return await this.createPaymentService.createSubscription(cart);
      } else {
        return await this.createPaymentService.createPaymentIntent(cart);
      }
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
    const ctCart = await this.ctCartService.getCart({ id: getCartIdFromContext() });
    const amountPlanned = await this.ctCartService.getPaymentAmount({ cart: ctCart });
    const webElement = paymentType; //getConfig().stripeWebElements;
    const appearance =
      webElement === 'paymentElement' ? stripePaymentElementAppearance : stripeExpressCheckoutAppearance;
    const setupFutureUsage = stripeSavedPaymentMethodConfig.payment_method_save_usage!;

    log.info(`Cart and ${webElement} config retrieved.`, {
      cartId: ctCart.id,
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
    });

    return {
      cartInfo: {
        amount: amountPlanned.centAmount,
        currency: amountPlanned.currencyCode,
      },
      appearance: appearance,
      captureMethod: stripeCaptureMethod,
      webElements: webElement,
      setupFutureUsage: setupFutureUsage,
      layout: stripeLayout,
      collectBillingAddress: stripeCollectBillingAddress as CollectBillingAddressOptions,
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
        await this.createOrder(ctCart, updateData.pspReference);
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
      const data = event.data.object as Stripe.Invoice;
      const invoice = await this.createPaymentService.getStripeInvoiceExpanded(data.id);
      const subscription = invoice.subscription as Stripe.Subscription;
      const updateData = this.subscriptionEventConverter.convert(event, invoice);

      if (subscription && subscription.status !== 'trialing') {
        const eventCartId = data.subscription_details?.metadata?.cart_id;
        const eventPaymentId = data.subscription_details?.metadata?.ct_payment_id;
        if (!eventCartId || !eventPaymentId) {
          throw new Error(
            `Cannot process invoice with ID: ${data.id}. Missing Cart ID or Payment ID in the event metadata.`,
          );
        }
        const cart = await this.ctCartService.getCart({ id: eventCartId });
        const amountPlanned: Money = {
          currencyCode: data.currency.toUpperCase(),
          centAmount: data.amount_paid * 2,
        };

        const paymentId = await this.createPaymentService.handleCtPaymentSubscription({
          cart,
          amountPlanned,
          invoiceId: data.id,
        });

        await this.addPaymentToOrder(eventPaymentId, paymentId);

        //update data of the payment
        updateData.id = paymentId;
      }

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
    } catch (e) {
      log.error(JSON.stringify(e));
      log.error('Error processing notification', { error: e });
      return;
    }
  }

  public async createOrder(cart: Cart, paymentIntent: string | undefined) {
    const apiClient = paymentSDK.ctAPI.client;
    const order = await apiClient
      .orders()
      .post({
        body: {
          cart: {
            id: cart.id,
            typeId: 'cart',
          },
          shipmentState: 'Pending',
          orderState: 'Open',
          version: cart.version,
          paymentState: 'Paid',
        },
      })
      .execute();

    const idempotencyKey = crypto.randomUUID();

    if (paymentIntent)
      await stripeApi().paymentIntents.update(
        paymentIntent,
        {
          metadata: {
            ct_order_id: order.body.id,
          },
        },
        { idempotencyKey },
      );
  }

  public async getCartExpanded(): Promise<Cart> {
    const cart = await paymentSDK.ctAPI.client
      .carts()
      .withId({ ID: getCartIdFromContext() })
      .get({ queryArgs: { expand: 'lineItems[*].productType' } })
      .execute();
    return cart.body;
  }

  private async addPaymentToOrder(subscriptionPaymentId: string, paymentId: string) {
    const order = await this.ctOrderService.getOrderByPaymentId({ paymentId: subscriptionPaymentId });
    const apiClient = paymentSDK.ctAPI.client;

    return await apiClient
      .orders()
      .withId({ ID: order.id })
      .post({
        body: {
          version: order.version,
          actions: [
            {
              action: 'addPayment',
              payment: {
                id: paymentId,
                typeId: 'payment',
              },
            },
          ],
        },
      })
      .execute();
  }
}
