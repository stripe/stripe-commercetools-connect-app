import crypto from 'crypto';
import { Cart, CommercetoolsCartService, CommercetoolsPaymentService } from '@commercetools/connect-payments-sdk';
import { PaymentTransactions } from '../dtos/operations/payment-intents.dto';
import { getConfig } from '../config/config';
import { CtPaymentCreationServiceOptions } from './types/stripe-payment.type';
import { PaymentOutcome } from '../dtos/stripe-payment.dto';
import { getPaymentInterfaceFromContext } from '../libs/fastify/context/context';
import { stripeApi } from '../clients/stripe.client';
import { log } from '../libs/logger';
import {
  METADATA_CART_ID_FIELD,
  METADATA_CUSTOMER_ID_FIELD,
  METADATA_PAYMENT_ID_FIELD,
  METADATA_PROJECT_KEY_FIELD,
  METADATA_SUBSCRIPTION_ID_FIELD,
} from '../constants';
import Stripe from 'stripe';
import {
  HandleCtPaymentCreationProps,
  HandlePaymentSubscriptionProps,
  PaymentCreationProps,
  UpdatePaymentMetadataProps,
  UpdateSubscriptionPaymentTransactionsProps,
} from './types/ct-payment-creation.type';

const stripe = stripeApi();

export class CtPaymentCreationService {
  private ctCartService: CommercetoolsCartService;
  private ctPaymentService: CommercetoolsPaymentService;

  constructor(opts: CtPaymentCreationServiceOptions) {
    this.ctCartService = opts.ctCartService;
    this.ctPaymentService = opts.ctPaymentService;
  }

  public async createCtPayment({ cart, amountPlanned, interactionId }: PaymentCreationProps): Promise<string> {
    const response = await this.ctPaymentService.createPayment({
      amountPlanned,
      interfaceId: interactionId,
      paymentMethodInfo: {
        paymentInterface: getPaymentInterfaceFromContext() || 'stripe',
        //...(isSubscription && { method: 'subscription' }), //remove this line if you want to update the payment method for subscriptions with the payment method used in the Stripe webhook event charge.succeeded
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
          state: PaymentOutcome.INITIAL,
          interactionId,
        },
      ],
    });

    return response.id;
  }

  public async addCtPayment(cart: Cart, ctPaymentId: string): Promise<void> {
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
    interactionId,
    subscriptionId,
  }: HandleCtPaymentCreationProps): Promise<string> {
    const ctPaymentId = await this.createCtPayment({
      cart,
      amountPlanned,
      interactionId,
    });

    await this.addCtPayment(cart, ctPaymentId);

    log.info(`Commercetools Payment and initial transaction created.`, {
      ctCartId: cart.id,
      ctPaymentId,
      interactionId,
    });

    await this.updatePaymentMetadata({
      cart,
      ctPaymentId,
      paymentIntentId: interactionId.startsWith('pi_') ? interactionId : undefined,
      subscriptionId,
    });

    return ctPaymentId;
  }

  public async updatePaymentMetadata({
    cart,
    ctPaymentId,
    paymentIntentId,
    subscriptionId,
  }: UpdatePaymentMetadataProps): Promise<void> {
    const requests: Promise<unknown>[] = [];
    if (paymentIntentId) {
      const updatePaymentIntent = stripe.paymentIntents.update(
        paymentIntentId,
        {
          metadata: {
            ...(subscriptionId
              ? {
                  ...this.getPaymentMetadata(cart),
                  [METADATA_SUBSCRIPTION_ID_FIELD]: subscriptionId,
                }
              : null),
            [METADATA_PAYMENT_ID_FIELD]: ctPaymentId,
          },
        },
        { idempotencyKey: crypto.randomUUID() },
      );
      requests.push(updatePaymentIntent);
    }

    if (subscriptionId) {
      const updateSubscription = stripe.subscriptions.update(
        subscriptionId,
        { metadata: { [METADATA_PAYMENT_ID_FIELD]: ctPaymentId } },
        { idempotencyKey: crypto.randomUUID() },
      );
      requests.push(updateSubscription);
    }

    if (!requests.length) {
      log.warn(`No Payment intent or Subscription ID provided for metadata update. Skipping update.`);
      return;
    }

    await Promise.all(requests);
    log.info(`Stripe Payment id metadata has been updated successfully.`);
  }

  public getPaymentMetadata(cart: Cart): Record<string, string> {
    const { projectKey } = getConfig();
    return {
      [METADATA_CART_ID_FIELD]: cart.id,
      [METADATA_PROJECT_KEY_FIELD]: projectKey,
      ...(cart.customerId ? { [METADATA_CUSTOMER_ID_FIELD]: cart.customerId } : null),
    };
  }

  public async updateSubscriptionPaymentTransactions({
    payment,
    interactionId,
    subscriptionId,
    isPending = false,
  }: UpdateSubscriptionPaymentTransactionsProps) {
    await this.ctPaymentService.updatePayment({
      id: payment.id,
      pspReference: interactionId,
      transaction: {
        interactionId: interactionId,
        type: PaymentTransactions.AUTHORIZATION,
        amount: payment.amountPlanned,
        state: 'Success',
      },
    });

    await this.ctPaymentService.updatePayment({
      id: payment.id,
      pspReference: interactionId,
      transaction: {
        interactionId: interactionId,
        type: PaymentTransactions.CHARGE,
        amount: payment.amountPlanned,
        state: isPending ? 'Pending' : 'Success',
      },
    });
    log.info(`Payment for Subscription "${subscriptionId}" has been confirmed.`, {
      ctPaymentId: payment.id,
      interactionId,
    });
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
    interactionId,
  }: HandlePaymentSubscriptionProps): Promise<string> {
    const ctPaymentId = await this.createCtPayment({
      cart,
      amountPlanned,
      interactionId,
    });

    log.info(`Commercetools Subscription Payment transaction initial created.`, {
      ctCartId: cart.id,
      ctPaymentId,
      interactionId,
    });

    return ctPaymentId;
  }
}
