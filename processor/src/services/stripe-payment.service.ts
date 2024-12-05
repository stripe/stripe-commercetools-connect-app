import Stripe from 'stripe';
import {
  healthCheckCommercetoolsPermissions,
  statusHandler,
  TransactionState,
  TransactionType,
} from '@commercetools/connect-payments-sdk';
import {
  CancelPaymentRequest,
  CapturePaymentRequest,
  ConfigResponse,
  ModifyPayment,
  PaymentProviderModificationResponse,
  RefundPaymentRequest,
  StatusResponse,
} from './types/operation.type';

import {
  PaymentComponentsSupported,
  SupportedPaymentComponentsSchemaDTO,
} from '../dtos/operations/payment-componets.dto';
import { PaymentModificationStatus, PaymentTransactions } from '../dtos/operations/payment-intents.dto';
import packageJSON from '../../package.json';

import { AbstractPaymentService } from './abstract-payment.service';
import { getConfig } from '../config/config';
import { appLogger, paymentSDK } from '../payment-sdk';
import { CaptureMethod, StripePaymentServiceOptions } from './types/stripe-payment.type';
import {
  ConfigElementResponseSchemaDTO,
  CtPaymentSchemaDTO,
  PaymentOutcome,
  PaymentRequestSchemaDTO,
  PaymentResponseSchemaDTO,
} from '../dtos/stripe-payment.dto';
import { getCartIdFromContext, getPaymentInterfaceFromContext } from '../libs/fastify/context/context';
import { stripeApi, wrapStripeError } from '../clients/stripe.client';
import { log } from '../libs/logger';
import crypto, { randomUUID } from 'crypto';
import { TransactionDraftDTO, TransactionResponseDTO } from '../dtos/operations/transaction.dto';

export class StripePaymentService extends AbstractPaymentService {
  constructor(opts: StripePaymentServiceOptions) {
    super(opts.ctCartService, opts.ctPaymentService, opts.ctOrderService);
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
      /*const idempotencyKey = crypto.randomUUID();
      await stripeApi().paymentIntents.capture(request.payment.interfaceId as string, {
        idempotencyKey,
      });*/
      //TODO MVP Review if we need to retrieve data from the webhook event to be added in commercetools

      return { outcome: PaymentModificationStatus.APPROVED, pspReference: request.payment.interfaceId as string };
    } catch (e) {
      throw wrapStripeError(e);
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
      /*const idempotencyKey = crypto.randomUUID();
      const resp = await stripeApi().paymentIntents.cancel(request.payment.interfaceId as string, {
        idempotencyKey,
      });*/
      //TODO MVP Review if we need to retrieve data from the webhook event to be added in commercetools

      return { outcome: PaymentModificationStatus.APPROVED, pspReference: request.payment.interfaceId as string };
    } catch (e) {
      throw wrapStripeError(e);
    }
  }

  /**
   * Refund payment in Stripe.
   *
   * @remarks
   * MVP: refund the total amount
   *
   * @param {RefundPaymentRequest} request - contains amount and {@link https://docs.commercetools.com/api/projects/payments | Payment } defined in composable commerce
   * @returns Promise with mocking data containing operation status and PSP reference
   */
  public async refundPayment(request: RefundPaymentRequest): Promise<PaymentProviderModificationResponse> {
    try {
      /**const idempotencyKey = crypto.randomUUID();
      await stripeApi().refunds.create(
        {
          payment_intent: request.payment.interfaceId,
        },
        { idempotencyKey },
      );**/
      //TODO MVP Review if we need to retrieve data from the webhook event to be added in commercetools

      return { outcome: PaymentModificationStatus.RECEIVED, pspReference: request.payment.interfaceId as string };
    } catch (e) {
      throw wrapStripeError(e);
    }
  }

  /**
   * Create the Payment Intent from Stripe
   *
   * @remarks
   * Implementation to provide the payment Intent from Stripe
   *
   * @returns {Promise<PaymentIntentResponseSchemaDTO>} - The payment response.
   */
  public async createPaymentIntentStripe(): Promise<PaymentResponseSchemaDTO> {
    const ctCart = await this.ctCartService.getCart({
      id: getCartIdFromContext(),
    });
    const amountPlanned = await this.ctCartService.getPaymentAmount({ cart: ctCart });

    const captureMethodConfig = getConfig().stripeCaptureMethod;
    let paymentIntent!: Stripe.PaymentIntent;
    try {
      const idempotencyKey = crypto.randomUUID();
      // MVP Add customer address to the payment Intent creation
      paymentIntent = await stripeApi().paymentIntents.create(
        {
          amount: amountPlanned.centAmount,
          currency: amountPlanned.currencyCode,
          automatic_payment_methods: {
            enabled: true,
          },
          capture_method: captureMethodConfig as CaptureMethod,
          metadata: {
            cart_id: ctCart.id,
            ct_project_key: getConfig().projectKey,
          },
        },
        {
          idempotencyKey,
        },
      );
    } catch (e) {
      throw wrapStripeError(e);
    }

    log.info(`PaymentIntent created.`, {
      ctCartId: ctCart.id,
      stripePaymentIntentId: paymentIntent.id,
    });

    const createPaymentRequest: PaymentRequestSchemaDTO = {
      paymentMethod: {
        type: 'payment',
      },
      cart: {
        id: ctCart.id,
      },
      paymentIntent: {
        id: paymentIntent.id,
      },
    };
    let paymentOutcome;

    if (captureMethodConfig === 'manual') {
      paymentOutcome = PaymentOutcome.INITIAL;
    }

    const ctPayment = await this.createPaymentCt(
      createPaymentRequest,
      PaymentTransactions.AUTHORIZATION,
      paymentOutcome,
    );
    console.log('finished payment intent creation Initial');
    return {
      sClientSecret: paymentIntent.client_secret ?? '',
      paymentReference: ctPayment.ctPaymentReference,
    };
  }

  /**
   * Testing an authorized payment in commercetools after receiving a message from a webhook.
   *
   * @remarks MVP: The amount to cancel is the order's total
   * @param {Stripe.Event} event - Event sent by Stripe webhooks.
   */
  public async authorizedPayment(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const ctPayment = await this.ctPaymentService.getPayment({
      id: this.getCtPaymentId(paymentIntent),
    });

    try {
      await this.ctPaymentService.updatePayment({
        id: ctPayment.id,
        transaction: {
          type: PaymentTransactions.AUTHORIZATION,
          amount: {
            centAmount: paymentIntent.amount, // MVP cancel the total amount
            currencyCode: paymentIntent.currency.toUpperCase(),
          },
          interactionId: paymentIntent.id,
          state: this.convertPaymentResultCode(PaymentOutcome.AUTHORIZED as PaymentOutcome),
        },
      });
    } catch (error) {
      log.error(
        `Error processing cancel of authorized payment_intent[${paymentIntent.id}] received from webhook.`,
        error,
      );
      throw error;
    }
  }

  //TODO This method is responsabile of creating the initial payment in the cart, and return the amount and currency that
  // the cart has so Stripe can create the element with that information
  public async initializeCartPayment(opts: string): Promise<ConfigElementResponseSchemaDTO> {
    const ctCart = await this.ctCartService.getCart({
      id: getCartIdFromContext(),
    });

    const amountPlanned = await this.ctCartService.getPaymentAmount({ cart: ctCart });

    const appearance =
      opts.toUpperCase() === PaymentComponentsSupported.PAYMENT_ELEMENT.toString().toUpperCase()
        ? getConfig().stripePaymentElementAppearance
        : getConfig().stripeExpressCheckoutAppearance;

    log.info(`Cart and Stripe.Element config retrieved.`, {
      cartId: ctCart.id,
      cartInfo: {
        amount: amountPlanned.centAmount,
        currency: amountPlanned.currencyCode,
      },
      stripeElementAppearance: appearance,
    });

    return {
      cartInfo: {
        amount: amountPlanned.centAmount,
        currency: amountPlanned.currencyCode,
      },
      appearance: appearance,
      captureMethod: getConfig().stripeCaptureMethod,
    };
  }

  /**
   * Create a new payment in ct, add the new payment to the cart and update the payment_intent metadata.
   * @param {PaymentRequestSchemaDTO} opts - Information about the payment in Stripe
   * @param {string} transactionType - Transaction type to add to the payment in ct once is created
   * @param {string} paymentOutcome - Payment Outcome to be added in the creation of the payment
   * @returns {CtPaymentSchemaDTO} - Commercetools payment reference
   */
  private async createPaymentCt(
    opts: PaymentRequestSchemaDTO,
    transactionType: string,
    paymentOutcome: PaymentOutcome = PaymentOutcome.AUTHORIZED,
  ): Promise<CtPaymentSchemaDTO> {
    const ctCart = await this.ctCartService.getCart({
      id: opts.cart?.id || '',
    });

    const paymentMethod = opts.paymentMethod;

    // add payment intent to cart in ct (Payment)
    const ctPayment = await this.ctPaymentService.createPayment({
      amountPlanned: await this.ctCartService.getPaymentAmount({
        cart: ctCart,
      }),
      interfaceId: opts.paymentIntent?.id,
      paymentMethodInfo: {
        paymentInterface: getPaymentInterfaceFromContext() || 'stripe',
      },
      ...(ctCart.customerId && {
        customer: {
          typeId: 'customer',
          id: ctCart.customerId,
        },
      }),
    });

    await this.ctCartService.addPayment({
      resource: {
        id: ctCart.id,
        version: ctCart.version,
      },
      paymentId: ctPayment.id,
    });

    const updatedPayment = await this.ctPaymentService.updatePayment({
      id: ctPayment.id,
      paymentMethod: paymentMethod.type,
      transaction: {
        type: transactionType,
        amount: ctPayment.amountPlanned,
        interactionId: opts.paymentIntent?.id,
        state: this.convertPaymentResultCode(paymentOutcome as PaymentOutcome),
      },
    });

    try {
      const idempotencyKey = crypto.randomUUID();
      await stripeApi().paymentIntents.update(
        opts.paymentIntent?.id || '',
        {
          metadata: {
            ct_payment_id: updatedPayment.id,
          },
        },
        { idempotencyKey },
      );
    } catch (e) {
      throw wrapStripeError(e);
    }

    log.info(`Payment created and assigned PSP reference.`, {
      ctCartId: ctCart.id,
      stripePaymentIntentId: opts.paymentIntent?.id,
      ctPaymentId: updatedPayment.id,
    });

    return {
      ctPaymentReference: updatedPayment.id,
    };
  }

  private getCtPaymentId(event: Stripe.PaymentIntent | Stripe.Charge): string {
    return event.metadata.ct_payment_id;
  }

  private getCtCartId(paymentIntent: Stripe.PaymentIntent): string {
    return paymentIntent.metadata.cart_id || '';
  }

  private convertPaymentResultCode(resultCode: PaymentOutcome): string {
    switch (resultCode) {
      case PaymentOutcome.AUTHORIZED:
        return 'Success';
      case PaymentOutcome.REJECTED:
        return 'Failure';
      default:
        return 'Initial';
    }
  }

  /**
   * Handle the payment transaction request. It will create a new Payment in CoCo and associate it with the provided cartId. If no amount is given it will use the full cart amount.
   *
   * @remarks
   * Abstract method to handle payment transaction requests. The actual invocation to PSPs should be implemented in subclasses
   *
   * @param transactionDraft the incoming request payload
   * @returns Promise with the created Payment and whether or not it was a success or not
   */
  public async handleTransaction(transactionDraft: TransactionDraftDTO): Promise<TransactionResponseDTO> {
    const TRANSACTION_AUTHORIZATION_TYPE: TransactionType = 'Authorization';
    const TRANSACTION_STATE_SUCCESS: TransactionState = 'Success';
    const TRANSACTION_STATE_FAILURE: TransactionState = 'Failure';

    const maxCentAmountIfSuccess = 10000;

    const ctCart = await this.ctCartService.getCart({ id: transactionDraft.cartId });

    let amountPlanned = transactionDraft.amount;
    if (!amountPlanned) {
      amountPlanned = await this.ctCartService.getPaymentAmount({ cart: ctCart });
    }

    const isBelowSuccessStateThreshold = amountPlanned.centAmount < maxCentAmountIfSuccess;

    const newlyCreatedPayment = await this.ctPaymentService.createPayment({
      amountPlanned,
      paymentMethodInfo: {
        paymentInterface: transactionDraft.paymentInterface,
      },
    });

    await this.ctCartService.addPayment({
      resource: {
        id: ctCart.id,
        version: ctCart.version,
      },
      paymentId: newlyCreatedPayment.id,
    });

    const transactionState: TransactionState = isBelowSuccessStateThreshold
      ? TRANSACTION_STATE_SUCCESS
      : TRANSACTION_STATE_FAILURE;

    const pspReference = randomUUID().toString();

    await this.ctPaymentService.updatePayment({
      id: newlyCreatedPayment.id,
      pspReference: pspReference,
      transaction: {
        amount: amountPlanned,
        type: TRANSACTION_AUTHORIZATION_TYPE,
        state: transactionState,
        interactionId: pspReference,
      },
    });

    console.log(`isBelowSuccessStateThreshold = ${isBelowSuccessStateThreshold}`);

    if (isBelowSuccessStateThreshold) {
      return {
        transactionStatus: {
          errors: [],
          state: 'Completed',
        },
      };
    } else {
      return {
        transactionStatus: {
          errors: [
            {
              code: 'PaymentRejected',
              message: `Payment '${newlyCreatedPayment.id}' has been rejected.`,
            },
          ],
          state: 'Failed',
        },
      };
    }
  }

  public getModifyData(event: Stripe.Event): ModifyPayment {
    let data, centAmount;
    if (event.type.startsWith('payment')) {
      data = event.data.object as Stripe.PaymentIntent;
      centAmount = data.amount_received;
    } else {
      data = event.data.object as Stripe.Charge;
      centAmount = data.amount_refunded;
    }

    return {
      paymentId: this.getCtPaymentId(data),
      data: {
        actions: [
          {
            action: this.getEventTransactionType(event.type),
            amount: {
              centAmount: centAmount,
              currencyCode: data.currency.toUpperCase(),
            },
          },
        ],
      },
    };
  }
}
