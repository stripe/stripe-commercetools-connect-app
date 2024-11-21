import Stripe from 'stripe';
import {
  statusHandler,
  healthCheckCommercetoolsPermissions,
  TransactionType,
  TransactionState,
} from '@commercetools/connect-payments-sdk';
import {
  CancelPaymentRequest,
  CapturePaymentRequest,
  ConfigResponse,
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
    super(opts.ctCartService, opts.ctPaymentService);
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
      clientKey: config.stripeSecretKey,
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
      log: appLogger,
      timeout: getConfig().healthCheckTimeout,
      checks: [
        healthCheckCommercetoolsPermissions({
          requiredPermissions: [
            'manage_payments',
            'view_sessions',
            'view_api_clients',
            'manage_orders',
            'introspect_oauth_tokens',
            'manage_checkout_payment_intents',
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
      components: [
        {
          type: PaymentComponentsSupported.PAYMENT_ELEMENT.toString(),
        },
        {
          type: PaymentComponentsSupported.EXPRESS_CHECKOUT.toString(),
        },
      ],
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
      const idempotencyKey = crypto.randomUUID();
      await stripeApi().paymentIntents.capture(request.payment.interfaceId as string, {
        idempotencyKey,
      });

      return { outcome: PaymentModificationStatus.APPROVED, pspReference: request.payment.interfaceId as string };
    } catch (e) {
      throw wrapStripeError(e);
    }
  }

  /**
   * Cancel payment in Stripe.
   *
   * @param {CancelPaymentRequest} request - Information about the ct payment.
   * @returns Promise with mocking data containing operation status and PSP reference
   */
  public async cancelPayment(request: CancelPaymentRequest): Promise<PaymentProviderModificationResponse> {
    try {
      const idempotencyKey = crypto.randomUUID();
      await stripeApi().paymentIntents.cancel(request.payment.interfaceId as string, {
        idempotencyKey,
      });

      return { outcome: PaymentModificationStatus.RECEIVED, pspReference: request.payment.interfaceId as string };
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
   * @param {RefundPaymentRequest} request - Information about the ct payment and the amount.
   * @returns Promise with mocking data containing operation status and PSP reference
   */
  public async refundPayment(request: RefundPaymentRequest): Promise<PaymentProviderModificationResponse> {
    try {
      const idempotencyKey = crypto.randomUUID();
      await stripeApi().refunds.create(
        {
          payment_intent: request.payment.interfaceId,
        },
        { idempotencyKey },
      );

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
        type: paymentIntent.payment_method as string,
      },
      cart: {
        id: ctCart.id,
      },
      paymentIntent: {
        id: paymentIntent.id,
      },
    };

    const { ctPaymentReference } = await this.createPaymentCt(
      createPaymentRequest,
      PaymentTransactions.AUTHORIZATION,
      PaymentOutcome.INITIAL,
    );

    return {
      sClientSecret: paymentIntent.client_secret ?? '',
      paymentReference: ctPaymentReference,
    };
  }

  /**
   * If the capture mode is 'manual' create a payment in ct and update the payment_intent metadata in Stripe.
   *
   * @remarks MVP: The amount to authorize is the total of the order
   * @param {Stripe.Event} event - Event sent by Stripe webhooks.
   */
  public async authorizePaymentInCt(event: Stripe.Event) {
    const charge = event.data.object as Stripe.Charge;

    if (!charge.captured) {
      const createPaymentRequest: PaymentRequestSchemaDTO = {
        paymentMethod: {
          type: charge.payment_method as string,
        },
        cart: {
          id: charge.metadata.cart_id,
        },
        paymentIntent: {
          id: charge.payment_intent as string,
        },
      };

      try {
        await this.createPaymentCt(createPaymentRequest, PaymentTransactions.AUTHORIZATION);
      } catch (error) {
        log.error(`Error processing charge.succeeded[${charge.id}] received from webhook.`, error);
      }
    }
  }

  /**
   * Refund a captured payment in commercetools after receiving a message from a webhook.
   * The payment will be updated only for charges with the attribute captured=true
   *
   * @remarks MVP: The amount to refund is the total captured
   * @param {Stripe.Event} event - Event sent by Stripe webhooks.
   */
  async refundPaymentInCt(event: Stripe.Event) {
    const charge = event as Stripe.ChargeRefundedEvent;

    try {
      if (charge.data.object.captured) {
        const stripePaymentIntentId = charge.data.object.payment_intent as string;

        const stripePaymentIntent: Stripe.PaymentIntent =
          await stripeApi().paymentIntents.retrieve(stripePaymentIntentId);

        await this.ctPaymentService.updatePayment({
          id: this.getCtPaymentId(stripePaymentIntent),
          transaction: {
            type: PaymentTransactions.REFUND,
            amount: {
              centAmount: charge.data.object.amount_captured, // MVP refund the total captured
              currencyCode: charge.data.object.currency.toUpperCase(),
            },
            interactionId: stripePaymentIntentId,
            state: this.convertPaymentResultCode(PaymentOutcome.AUTHORIZED as PaymentOutcome),
          },
        });
      }
    } catch (error) {
      log.error(`Error processing refund of charge[${charge.id}] received from webhook.`, error);
    }
  }

  /**
   * Cancel an authorized payment in commercetools after receiving a message from a webhook.
   *
   * @remarks MVP: The amount to cancel is the order's total
   * @param {Stripe.Event} event - Event sent by Stripe webhooks.
   */
  async cancelAuthorizationInCt(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    try {
      const ctPaymentId = this.getCtPaymentId(paymentIntent);

      await this.ctPaymentService.updatePayment({
        id: ctPaymentId,
        transaction: {
          type: PaymentTransactions.CANCEL_AUTHORIZATION,
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
    }
  }

  /**
   * Charge an authorized payment in commercetools after receiving a message from a webhook.
   * If the payment_intent has 'capture_method'='manual' this function will add a 'Charge' transaction to the payment in ct.
   * If the payment_intent is not manual, this function will create the payment in ct and update the payment_intent metadata.
   *
   * @remarks MVP: The charge amount is based on the amount received from Stripe. If the charge amount is less than the total amount, the difference will not register as a transaction in ct.
   * @param {Stripe.Event} event - Event sent by Stripe webhooks.
   */
  async chargePaymentInCt(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    try {
      const ctPaymentId = this.getCtPaymentId(paymentIntent);

      if (paymentIntent.capture_method === 'manual') {
        await this.ctPaymentService.updatePayment({
          id: ctPaymentId,
          transaction: {
            type: PaymentTransactions.CHARGE,
            amount: {
              centAmount: paymentIntent.amount_received, // MVP capture the amount_received
              currencyCode: paymentIntent.currency.toUpperCase(),
            },
            interactionId: paymentIntent.id,
            state: this.convertPaymentResultCode(PaymentOutcome.AUTHORIZED as PaymentOutcome),
          },
        });
      } else {
        const createPaymentRequest: PaymentRequestSchemaDTO = {
          paymentMethod: {
            type: paymentIntent.payment_method as string,
          },
          cart: {
            id: paymentIntent.metadata.cart_id,
          },
          paymentIntent: {
            id: paymentIntent.id,
          },
        };

        await this.createPaymentCt(createPaymentRequest, PaymentTransactions.CHARGE);
      }
    } catch (error) {
      log.error(
        `Error processing charge of authorized payment_intent[${paymentIntent.id}] received from webhook.`,
        error,
      );
    }
  }

  public async getConfigElement(opts: string): Promise<ConfigElementResponseSchemaDTO> {
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
   * @returns {CtPaymentSchemaDTO} - Commercetools payment reference
   */
  private async createPaymentCt(
    opts: PaymentRequestSchemaDTO,
    transactionType: string,
    paymentOutcome: string = PaymentOutcome.AUTHORIZED, //TODO review if need it.
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

  private getCtPaymentId(paymentIntent: Stripe.PaymentIntent): string {
    return paymentIntent.metadata.ct_payment_id || '';
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
}
