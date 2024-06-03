import { statusHandler, healthCheckCommercetoolsPermissions } from '@commercetools/connect-payments-sdk';

import Stripe from 'stripe';

import { paymentSDK } from '../payment-sdk';
import packageJSON from '../../package.json';
import { stripeApi, wrapStripeError } from '../clients/stripe.client';
import { getConfig } from '../config/config';
import { PaymentIntentResponseSchemaDTO, PaymentOutcome, PaymentResponseSchemaDTO } from '../dtos/mock-payment.dto';
import { log } from '../libs/logger';
import { SupportedPaymentComponentsSchemaDTO } from '../dtos/operations/payment-componets.dto';
import { PaymentModificationStatus } from '../dtos/operations/payment-intents.dto';
import { getCartIdFromContext, getPaymentInterfaceFromContext } from '../libs/fastify/context/context';

import { AbstractPaymentService } from './abstract-payment.service';

import {
  CancelPaymentRequest,
  CapturePaymentRequest,
  ConfigResponse,
  PaymentProviderModificationResponse,
  RefundPaymentRequest,
  StatusResponse,
} from './types/operation.type';
import { CreatePayment, StripePaymentServiceOptions } from './types/stripe-payment.type';

export class StripePaymentService extends AbstractPaymentService {
  private allowedCreditCards = ['4111111111111111', '5555555555554444', '341925950237632'];

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
            const paymentMethods = 'card';
            return {
              name: 'Stripe Payment API',
              status: 'UP',
              details: {
                paymentMethods,
              },
            };
          } catch (e) {
            return {
              name: 'Stripe Payment API',
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

  private isCreditCardAllowed(cardNumber: string) {
    return this.allowedCreditCards.includes(cardNumber);
  }

  /**
   * Create payment
   *
   * @remarks
   * Implementation to provide the initial data to cart for payment creation in external PSPs
   *
   * @param request - contains amount and {@link https://docs.commercetools.com/api/projects/payments | Payment } defined in composable commerce
   * @returns Promise with mocking data containing operation status and PSP reference
   */
  public async createPayment(opts: CreatePayment): Promise<PaymentResponseSchemaDTO> {
    const ctCart = await this.ctCartService.getCart({
      id: getCartIdFromContext(),
    });

    const ctPayment = await this.ctPaymentService.createPayment({
      amountPlanned: await this.ctCartService.getPaymentAmount({
        cart: ctCart,
      }),
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

    const paymentMethod = opts.data.paymentMethod;

    const resultCode = PaymentOutcome.INITIAL;

    const pspReference = paymentMethod.paymentIntent;

    const paymentMethodType = paymentMethod.type;

    const updatedPayment = await this.ctPaymentService.updatePayment({
      id: ctPayment.id,
      pspReference: pspReference,
      paymentMethod: paymentMethodType,
      transaction: {
        type: 'Authorization',
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
        log.info(`PaymentIntent retrieve.`, {
          ctCartId: ctCart.id,
          stripePaymentIntentId: interfaceId,
        });
        const rest = await stripeApi().paymentIntents.retrieve(interfaceId);

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

      log.info(`PaymentIntent created and assigned to cart.`, {
        ctCartId: ctCart.id,
        stripePaymentIntentId: paymentIntent.id,
        ctPaymentId: ctPayment.id,
      });

      return paymentIntent as PaymentIntentResponseSchemaDTO;
    }
  }
}
