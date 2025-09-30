import { TransactionData, Money } from '@commercetools/connect-payments-sdk';

import Stripe from 'stripe';
import { PaymentStatus, StripeEvent, StripeEventUpdatePayment } from '../types/stripe-payment.type';
import { PaymentTransactions } from '../../dtos/operations/payment-intents.dto';
import { wrapStripeError } from '../../clients/stripe.client';
import { METADATA_PAYMENT_ID_FIELD } from '../../constants';

export class StripeEventConverter {
  public convert(opts: Stripe.Event): StripeEventUpdatePayment {
    let data, paymentIntentId, paymentMethod;
    if (opts.type.startsWith('payment')) {
      data = opts.data.object as Stripe.PaymentIntent;
      paymentIntentId = data.id;
    } else {
      data = opts.data.object as Stripe.Charge;
      paymentIntentId = (data.payment_intent || data.id) as string;
      paymentMethod = (data.payment_method_details?.type as string) || '';
    }

    return {
      id: this.getCtPaymentId(data),
      pspReference: paymentIntentId,
      paymentMethod: paymentMethod,
      pspInteraction: {
        response: JSON.stringify(opts),
      },
      transactions: this.populateTransactions(opts, paymentIntentId),
    };
  }

  private populateTransactions(event: Stripe.Event, paymentIntentId: string): TransactionData[] {
    switch (event.type) {
      case StripeEvent.PAYMENT_INTENT__CANCELED:
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
        ];
      case StripeEvent.PAYMENT_INTENT__SUCCEEDED:
        return [
          {
            type: PaymentTransactions.CHARGE,
            state: PaymentStatus.SUCCESS,
            amount: this.populateAmount(event),
            interactionId: paymentIntentId,
          },
        ];
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
        ];
      case StripeEvent.CHARGE__UPDATED:
        return [
          {
            type: PaymentTransactions.CHARGE,
            state: PaymentStatus.SUCCESS,
            amount: this.populateAmount(event),
            interactionId: paymentIntentId,
          },
        ];
      default: {
        const error = `Unsupported event ${event.type}`;
        throw wrapStripeError(new Error(error));
      }
    }
  }

  private populateAmount(opts: Stripe.Event): Money {
    let data, centAmount;
    if (opts.type.startsWith('payment')) {
      data = opts.data.object as Stripe.PaymentIntent;
      centAmount = data.amount_received;
    } else {
      data = opts.data.object as Stripe.Charge;
      centAmount = data.amount_refunded;
    }

    return {
      centAmount: centAmount,
      currencyCode: data.currency.toUpperCase(),
    };
  }

  private getCtPaymentId(event: Stripe.PaymentIntent | Stripe.Charge): string {
    return event.metadata[METADATA_PAYMENT_ID_FIELD];
  }
}
