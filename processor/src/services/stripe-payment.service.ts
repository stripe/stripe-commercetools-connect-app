import Stripe from 'stripe';
import { statusHandler, healthCheckCommercetoolsPermissions } from '@commercetools/connect-payments-sdk';
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
import { paymentSDK } from '../payment-sdk';
import { CreatePayment, StripePaymentServiceOptions } from './types/stripe-payment.type';
import { PaymentIntentResponseSchemaDTO, PaymentOutcome, PaymentResponseSchemaDTO } from '../dtos/mock-payment.dto';
import { getCartIdFromContext, getPaymentInterfaceFromContext } from '../libs/fastify/context/context';
import { stripeApi, wrapStripeError } from '../clients/stripe.client';
import { log } from '../libs/logger';

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
      components: [
        {
          type: 'card',
        },
      ],
    };
  }

  /**
   * Capture payment
   *
   * @remarks
   * Implementation to provide the mocking data for payment capture in external PSPs
   *
   * @param request - contains the amount and {@link https://docs.commercetools.com/api/projects/payments | Payment } defined in composable commerce
   * @returns Promise with mocking data containing operation status and PSP reference
   */
  public async capturePayment(request: CapturePaymentRequest): Promise<PaymentProviderModificationResponse> {
    return { outcome: PaymentModificationStatus.APPROVED, pspReference: request.payment.interfaceId as string };
  }

  public async cancelPayment(request: CancelPaymentRequest): Promise<PaymentProviderModificationResponse> {
    try {
      await stripeApi().paymentIntents.cancel(request.payment.interfaceId as string);

      return { outcome: PaymentModificationStatus.RECEIVED, pspReference: request.payment.interfaceId as string };
    } catch (e) {
      throw wrapStripeError(e);
    }
  }

  public async refundPayment(request: RefundPaymentRequest): Promise<PaymentProviderModificationResponse> {
    try {
      await stripeApi().refunds.create({
        payment_intent: request.payment.interfaceId,
      });

      return { outcome: PaymentModificationStatus.RECEIVED, pspReference: request.payment.interfaceId as string };
    } catch (e) {
      throw wrapStripeError(e);
    }
  }

  /**
   * Crate the 'Initial' payment to CT.
   *
   * @remarks
   * Implementation to provide the initial data to cart for payment creation in external PSPs
   *
   * @param {CreatePayment} opts - The options for creating the payment.
   * @returns {Promise<PaymentResponseSchemaDTO>} - The payment response.
   */
  public async createPayment(opts: CreatePayment): Promise<PaymentResponseSchemaDTO> {
    const ctCart = await this.ctCartService.getCart({
      id: getCartIdFromContext(),
    });

    const ctPayment = await this.ctPaymentService.getPayment({
      id: ctCart.paymentInfo?.payments[0].id ?? '',
    });

    const paymentMethod = opts.data.paymentMethod;

    const resultCode = PaymentOutcome.INITIAL;

    const pspReference = paymentMethod.paymentIntent;

    const paymentMethodType = paymentMethod.type;

    const updatedPayment = await this.ctPaymentService.updatePayment({
      id: ctPayment.id,
      paymentMethod: paymentMethodType,
      transaction: {
        type: PaymentTransactions.AUTHORIZATION,
        amount: ctPayment.amountPlanned,
        interactionId: pspReference,
        state: resultCode,
      },
    });

    return {
      outcome: resultCode,
      paymentReference: updatedPayment.id,
    };
  }

  /**
   * Retrieves or creates a payment intent for a cart.
   *
   * @returns {Promise<PaymentIntentResponseSchemaDTO>} The payment intent.
   */
  async getPaymentIntent(): Promise<PaymentIntentResponseSchemaDTO> {
    const ctCart = await this.ctCartService.getCart({
      id: getCartIdFromContext(),
    });

    const amountPlanned = await this.ctCartService.getPaymentAmount({ cart: ctCart });
    // verify if payment intent exist in cart in ct
    if (ctCart.paymentInfo?.payments[0]) {
      try {
        const { interfaceId = '' } = await this.ctPaymentService.getPayment({
          id: ctCart.paymentInfo?.payments[0].id ?? '',
        });

        const rest = await stripeApi().paymentIntents.retrieve(interfaceId);
        log.info(`PaymentIntent retrieve.`, {
          ctCartId: ctCart.id,
          stripePaymentIntentId: interfaceId,
          payment_intent_metadata: rest.metadata,
        });
        return rest as PaymentIntentResponseSchemaDTO;
      } catch (e) {
        throw wrapStripeError(e);
      }
    } else {
      let paymentIntent!: Stripe.PaymentIntent;
      try {
        // obtain customer from ct to add to paymentIntent
        paymentIntent = await stripeApi().paymentIntents.create({
          amount: amountPlanned.centAmount,
          currency: amountPlanned.currencyCode,
          automatic_payment_methods: {
            enabled: true,
          },
          metadata: {
            order_id: ctCart.id,
          },
        });
      } catch (e) {
        throw wrapStripeError(e);
      }

      // add payment intent to cart in ct (Payment)
      const ctPayment = await this.ctPaymentService.createPayment({
        amountPlanned: await this.ctCartService.getPaymentAmount({
          cart: ctCart,
        }),
        interfaceId: paymentIntent.id,
        paymentMethodInfo: {
          paymentInterface: getPaymentInterfaceFromContext() || 'mock',
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

      try {
        await stripeApi().paymentIntents.update(paymentIntent.id, {
          metadata: {
            paymentId: ctPayment.id,
          },
        });
      } catch (e) {
        throw wrapStripeError(e);
      }

      log.info(`PaymentIntent created and assigned to cart.`, {
        ctCartId: ctCart.id,
        stripePaymentIntentId: paymentIntent.id,
        ctPaymentId: ctPayment.id,
      });

      return paymentIntent as PaymentIntentResponseSchemaDTO;
    }
  }

  /**
   * Set payment transaction type 'Authorization' to status 'success' (money is ready to be capture).
   * 
   * @remarks MVP: The amount to authorize is the total of the order
   * @param {Stripe.Event} event - Event sent by Stripe webhooks.
   */
  public async setAuthorizationSuccessPayment(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    try {
      const ctPaymentId = this.getCtPaymentId(paymentIntent);
      log.info(
        `setAuthorizationSuccessPayment() function: get ct_payment[${ctPaymentId}] associated with payment_intent[${paymentIntent.id}]`,
      );
      const ctPayment = await this.ctPaymentService.getPayment({
        id: ctPaymentId,
      });

      await this.ctPaymentService.updatePayment({
        id: ctPayment.id,
        transaction: {
          type: PaymentTransactions.AUTHORIZATION,
          amount: ctPayment.amountPlanned,
          interactionId: paymentIntent.id,
          state: this.convertPaymentResultCode(PaymentOutcome.AUTHORIZED as PaymentOutcome),
        },
      });
    } catch (error) {
      log.error(
        `Error at setAuthorizationSuccessPayment() function, processing payment_intent[${paymentIntent.id}]:`,
        error,
      );
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
      const paymentIntentId = charge.data.object.payment_intent as string;

      const paymentIntent = await stripeApi().paymentIntents.retrieve(paymentIntentId);

      const ctPaymentId = this.getCtPaymentId(paymentIntent);

      if (charge.data.object.captured) {
        await this.ctPaymentService.updatePayment({
          id: ctPaymentId,
          transaction: {
            type: PaymentTransactions.REFUND,
            amount: {
              centAmount: charge.data.object.amount_captured, // MVP refund the total captured
              currencyCode: charge.data.object.currency.toUpperCase()
            },
            interactionId: paymentIntentId,
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
            currencyCode: paymentIntent.currency.toUpperCase()
          },
          interactionId: paymentIntent.id,
          state: this.convertPaymentResultCode(PaymentOutcome.AUTHORIZED as PaymentOutcome),
        },
      });
    } catch (error) {
      log.error(
        `Error processing cancel of authorized payment_intent[${paymentIntent.id}] received from webhook.`,
        error);
    }
  }

  private getCtPaymentId(paymentIntent: Stripe.PaymentIntent): string {
    return paymentIntent.metadata.paymentId || '';
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
}