import { TransactionData, Money } from '@commercetools/connect-payments-sdk';

import Stripe from 'stripe';
import { PaymentStatus, StripeEventUpdatePayment, StripeSubscriptionEvent } from '../types/stripe-payment.type';
import { PaymentTransactions } from '../../dtos/operations/payment-intents.dto';
import { wrapStripeError } from '../../clients/stripe.client';

export class SubscriptionEventConverter {
  public convert(opts: Stripe.Event, invoice: Stripe.Invoice): StripeEventUpdatePayment {
    let paymentIntentId = invoice.id,
      paymentMethod;
    const data = opts.data.object as Stripe.Invoice;

    if (invoice.payment_intent) {
      const invoicePaymentIntent = invoice.payment_intent as Stripe.PaymentIntent;
      const invoiceCharge = invoice.charge as Stripe.Charge;
      paymentIntentId = invoicePaymentIntent.id;
      paymentMethod = (invoiceCharge.payment_method_details?.type as string) || '';
    }

    return {
      id: this.getCtPaymentId(data),
      pspReference: paymentIntentId as string,
      paymentMethod: paymentMethod,
      pspInteraction: {
        //response: JSON.stringify(opts),
      },
      transactions: this.populateTransactions(opts, paymentIntentId, invoice),
    };
  }

  private populateTransactions(
    event: Stripe.Event,
    paymentIntentId: string,
    invoice: Stripe.Invoice,
  ): TransactionData[] {
    switch (event.type) {
      /*case StripeSubscriptionEvent.PAYMENT_INTENT__CANCELED:
        return [
          {
            type: PaymentTransactions.AUTHORIZATION,
            state: PaymentStatus.FAILURE,
            amount: this.populateAmount(event),
            interactionId: paymentIntentId,
          },
          {
            type: PaymentTransactions.CANCEL_AUTHORIZATION,
            state: PaymentStatus.SUCCESS,
            amount: this.populateAmount(event),
            interactionId: paymentIntentId,
          },
        ];*/
      case StripeSubscriptionEvent.INVOICE_PAID:
        return [
          {
            type: PaymentTransactions.AUTHORIZATION,
            state: PaymentStatus.SUCCESS,
            amount: this.populateAmount(invoice),
            interactionId: paymentIntentId,
          },
          {
            type: PaymentTransactions.CHARGE,
            state: PaymentStatus.SUCCESS,
            amount: this.populateAmount(invoice),
            interactionId: paymentIntentId,
          },
        ];

      /*
      case StripeEvent.PAYMENT_INTENT__PAYMENT_FAILED:
        return [
          {
            type: PaymentTransactions.AUTHORIZATION,
            state: PaymentStatus.FAILURE,
            amount: this.populateAmount(event),
            interactionId: paymentIntentId,
          },
        ];
      case StripeEvent.CHARGE__REFUNDED:
        if (!event.data.object.captured) return [];
        return [
          {
            type: PaymentTransactions.REFUND,
            state: PaymentStatus.SUCCESS,
            amount: this.populateAmount(event),
            interactionId: paymentIntentId,
          },
          {
            type: PaymentTransactions.CHARGE_BACK,
            state: PaymentStatus.SUCCESS,
            amount: this.populateAmount(event),
            interactionId: paymentIntentId,
          },
        ];
      case StripeEvent.CHARGE__SUCCEEDED:
        if (event.data.object.captured) return [];
        return [
          {
            type: PaymentTransactions.AUTHORIZATION,
            state: PaymentStatus.SUCCESS,
            amount: this.populateAmount(event),
            interactionId: paymentIntentId,
          },
        ];*/
      default: {
        const error = `Unsupported event ${event.type}`;
        throw wrapStripeError(new Error(error));
      }
    }
  }

  private populateAmount(invoice: Stripe.Invoice): Money {
    return {
      centAmount: invoice.amount_paid,
      currencyCode: invoice.currency.toUpperCase(),
    };
  }

  private getCtPaymentId(invoice: Stripe.Invoice): string {
    return invoice.subscription_details?.metadata?.ctPaymentId ?? '';
  }
}
