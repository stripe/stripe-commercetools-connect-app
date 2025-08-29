import crypto from 'crypto';
import Stripe from 'stripe';
import {
  Cart,
  ErrorInvalidOperation,
  healthCheckCommercetoolsPermissions,
  statusHandler,
} from '@commercetools/connect-payments-sdk';
import {
  CancelPaymentRequest,
  CapturePaymentRequest,
  ConfigResponse,
  PaymentProviderModificationResponse,
  RefundPaymentRequest,
  ReversePaymentRequest,
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
import { CtPaymentCreationService } from './ct-payment-creation.service';
import { stripeCustomerIdFieldName } from '../custom-types/custom-types';
import { StripeCustomerService } from './stripe-customer.service';
import { getCartExpanded, updateCartById } from './commerce-tools/cart-client';
import { METADATA_ORDER_ID_FIELD } from '../constants';
import { addOrderPayment, createOrderFromCart } from './commerce-tools/order-client';
import { StripeSubscriptionService } from './stripe-subscription.service';
import { CartUpdateAction } from '@commercetools/platform-sdk';

export class StripePaymentService extends AbstractPaymentService {
  private stripeEventConverter: StripeEventConverter;
  private customerService: StripeCustomerService;
  private paymentCreationService: CtPaymentCreationService;

  constructor(opts: StripePaymentServiceOptions) {
    super(opts.ctCartService, opts.ctPaymentService, opts.ctOrderService);
    this.stripeEventConverter = new StripeEventConverter();
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
        await this.ctPaymentService.updatePayment({
          id: request.payment.id,
          transaction: {
            type: PaymentTransactions.CHARGE,
            amount: request.amount,
            interactionId: response.id,
            state: PaymentStatus.SUCCESS,
          },
        });

        log.info(`Payment modification completed.`, {
          paymentId: paymentIntentId,
          action: PaymentTransactions.CHARGE,
          result: PaymentModificationStatus.APPROVED,
          trackingId: response.id,
        });

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
      const response = await stripeApi().paymentIntents.cancel(paymentIntentId);

      await this.ctPaymentService.updatePayment({
        id: request.payment.id,
        transaction: {
          type: PaymentTransactions.CANCEL_AUTHORIZATION,
          amount: request.payment.amountPlanned,
          interactionId: paymentIntentId,
          state: PaymentStatus.SUCCESS,
        },
      });
      log.info(`Payment modification completed.`, {
        paymentId: paymentIntentId,
        action: PaymentTransactions.CANCEL_AUTHORIZATION,
        result: PaymentModificationStatus.APPROVED,
        trackingId: response.id,
      });

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
      const response = await stripeApi().refunds.create({
        payment_intent: paymentIntentId,
        amount: amount,
      });

      await this.ctPaymentService.updatePayment({
        id: request.payment.id,
        transaction: {
          type: PaymentTransactions.REFUND,
          amount: request.amount,
          interactionId: paymentIntentId,
          state: PaymentStatus.SUCCESS,
        },
      });
      log.info(`Payment modification completed.`, {
        paymentId: request.payment.id,
        action: PaymentTransactions.CANCEL_AUTHORIZATION,
        result: PaymentModificationStatus.APPROVED,
        trackingId: response.id,
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
   * Reverse payment
   *
   * @remarks
   * Abstract method to execute payment reversals in support of automated reversals to be triggered by checkout api. The actual invocation to PSPs should be implemented in subclasses
   *
   * @param request
   * @returns Promise with outcome containing operation status and PSP reference
   */
  public async reversePayment(request: ReversePaymentRequest): Promise<PaymentProviderModificationResponse> {
    const hasCharge = this.ctPaymentService.hasTransactionInState({
      payment: request.payment,
      transactionType: 'Charge',
      states: ['Success'],
    });
    const hasRefund = this.ctPaymentService.hasTransactionInState({
      payment: request.payment,
      transactionType: 'Refund',
      states: ['Success', 'Pending'],
    });
    const hasCancelAuthorization = this.ctPaymentService.hasTransactionInState({
      payment: request.payment,
      transactionType: 'CancelAuthorization',
      states: ['Success', 'Pending'],
    });

    const wasPaymentReverted = hasRefund || hasCancelAuthorization;

    if (hasCharge && !wasPaymentReverted) {
      return this.refundPayment({
        payment: request.payment,
        merchantReference: request.merchantReference,
        amount: request.payment.amountPlanned,
      });
    }

    const hasAuthorization = this.ctPaymentService.hasTransactionInState({
      payment: request.payment,
      transactionType: 'Authorization',
      states: ['Success'],
    });
    if (hasAuthorization && !wasPaymentReverted) {
      return this.cancelPayment({ payment: request.payment });
    }

    throw new ErrorInvalidOperation('There is no successful payment transaction to reverse.');
  }

  /**
   * Creates a payment intent using the Stripe API and create commercetools payment with Initial transaction.
   *
   * @return Promise<PaymentResponseSchemaDTO> A Promise that resolves to a PaymentResponseSchemaDTO object containing the client secret and payment reference.
   */
  public async createPaymentIntent(): Promise<PaymentResponseSchemaDTO> {
    try {
      const config = getConfig();
      const cart = await this.ctCartService.getCart({ id: getCartIdFromContext() });
      const setupFutureUsage = config.stripeSavedPaymentMethodConfig?.payment_method_save_usage;
      const customer = await this.customerService.getCtCustomer(cart.customerId!);
      const amountPlanned = await this.ctCartService.getPaymentAmount({ cart });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const shippingAddress = this.customerService.getStripeCustomerAddress(
        cart.shippingAddress,
        customer?.addresses[0],
      );
      const stripeCustomerId = customer?.custom?.fields?.[stripeCustomerIdFieldName];
      const paymentIntent = await stripeApi().paymentIntents.create(
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
          /*...(config.stripeCollectBillingAddress === 'auto' && {
            shipping: shippingAddress,
          }),*/
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

      if (updateData.transactions.length === 0 && event.type === StripeEvent.CHARGE__SUCCEEDED) {
        const updatedPayment = await this.ctPaymentService.updatePayment({
          ...updateData,
        });
        const hasAuthInitial = this.ctPaymentService.hasTransactionInState({
          payment: updatedPayment,
          transactionType: PaymentTransactions.AUTHORIZATION,
          states: [PaymentStatus.INITIAL],
        });
        if (hasAuthInitial) {
          await this.ctPaymentService.updatePayment({
            id: updatedPayment.id,
            pspReference: updateData.pspReference,
            transaction: {
              type: PaymentTransactions.AUTHORIZATION,
              state: convertPaymentResultCode(PaymentOutcome.AUTHORIZED as PaymentOutcome),
              amount: updatedPayment.amountPlanned,
              interactionId: updateData.pspReference,
            },
          });
        }

        log.info('Payment information updated', {
          paymentId: updatedPayment.id,
          version: updatedPayment.version,
          pspReference: updateData.pspReference,
          paymentMethod: updateData.paymentMethod,
        });
      } else {
        for (const tx of updateData.transactions) {
          const updatedPayment = await this.ctPaymentService.updatePayment({
            ...updateData,
            transaction: tx,
          });

          log.info('Payment transaction updated after processing the notification', {
            paymentId: updatedPayment.id,
            version: updatedPayment.version,
            pspReference: updateData.pspReference,
            paymentMethod: updateData.paymentMethod,
            transaction: JSON.stringify(tx),
          });
        }
      }

      if (event.type === StripeEvent.PAYMENT_INTENT__SUCCEEDED) {
        const ctCart = await this.ctCartService.getCartByPaymentId({ paymentId: updateData.id });
        const { latest_charge } = event.data.object as Stripe.PaymentIntent;
        const charge = await stripeApi().charges.retrieve(latest_charge as string);
        const updatedCart = await this.updateCartAddress(charge, ctCart);
        await this.createOrder({ cart: updatedCart, paymentIntentId: updateData.pspReference });
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
    /* If using Stripe Test Clock, wait for 9 seconds to allow clock advancement in test environments.
      This helps ensure Stripe's test clock events are processed before updating the subscription.
      Uncomment this line for testing purposes when using Stripe Test Clock.
      await new Promise((resolve) => setTimeout(resolve, 5000));
      */
    if (paymentIntentId && paymentIntentId.startsWith('pi_')) {
      await stripeApi().paymentIntents.update(
        paymentIntentId,
        { metadata: { [METADATA_ORDER_ID_FIELD]: order.id } },
        { idempotencyKey: crypto.randomUUID() },
      );
    }
    /* If using Stripe Test Clock, wait for 9 seconds to allow clock advancement in test environments.
      This helps ensure Stripe's test clock events are processed before updating the subscription.
      Uncomment this line for testing purposes when using Stripe Test Clock.
      await new Promise((resolve) => setTimeout(resolve, 000));
      */

    if (subscriptionId) {
      await stripeApi().subscriptions.update(
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

  public async updateCartAddress(charge: Stripe.Charge, ctCart: Cart): Promise<Cart> {
    if (!charge) {
      return ctCart;
    }
    const { billing_details, shipping } = charge;
    let billingAlias: Stripe.Charge.BillingDetails | Stripe.Charge.Shipping;
    if (!shipping) {
      billingAlias = billing_details;
    } else {
      billingAlias = shipping;
    }

    const actions: CartUpdateAction[] = [
      {
        action: 'setShippingAddress',
        address: {
          key: billingAlias.name || 'mockName',
          country: billingAlias.address?.country || 'US',
          city: billingAlias.address?.city || 'mockCity',
          postalCode: billingAlias.address?.postal_code || 'mockPostalCode',
          state: billingAlias.address?.state || 'mockState',
          streetName: billingAlias.address?.line1 || 'mockStreenName',
        },
      },
    ];
    return await updateCartById(ctCart, actions);
  }
}
