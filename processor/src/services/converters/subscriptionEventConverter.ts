import { TransactionData, Money, Payment } from '@commercetools/connect-payments-sdk';

import Stripe from 'stripe';
import {
  PaymentStatus,
  StripeEvent,
  StripeEventUpdatePayment,
  StripeSubscriptionEvent,
} from '../types/stripe-payment.type';
import { PaymentTransactions } from '../../dtos/operations/payment-intents.dto';
import { wrapStripeError } from '../../clients/stripe.client';
import { StripeInvoiceExpanded } from '../types/stripe-subscription.type';

export class SubscriptionEventConverter {
  public convert(
    opts: Stripe.Event,
    invoice: StripeInvoiceExpanded,
    isPaymentChargePending: boolean,
    payment: Payment,
  ): StripeEventUpdatePayment {
    // invoice.id is always defined when retrieved from Stripe API
    let paymentIntentId: string = invoice.id!;
    let paymentMethod: string | undefined;

    if (invoice.payment_intent) {
      const invoicePaymentIntent = invoice.payment_intent as Stripe.PaymentIntent;
      const invoiceCharge = invoice.charge as Stripe.Charge;
      paymentIntentId = invoicePaymentIntent.id;
      paymentMethod = (invoiceCharge.payment_method_details?.type as string) || '';
    }

    if (isPaymentChargePending) {
      paymentIntentId = invoice.id!;
    }

    // Check if invoice is paid without payment_intent or charge (e.g., applied balance)
    const invoicePaid = (invoice as unknown as { paid?: boolean }).paid;
    if (invoicePaid && !invoice.payment_intent && !invoice.charge) {
      paymentMethod = 'Stripe Applied Balance';
    }

    return {
      id: payment.id,
      pspReference: paymentIntentId,
      paymentMethod: paymentMethod,
      pspInteraction: {
        response: JSON.stringify(opts),
      },
      transactions: this.populateTransactions(opts, paymentIntentId, invoice, isPaymentChargePending),
    };
  }

  private populateTransactions(
    event: Stripe.Event,
    paymentIntentId: string,
    invoice: StripeInvoiceExpanded,
    isPaymentChargePending: boolean,
  ): TransactionData[] {
    const charge = invoice.charge as Stripe.Charge;
    switch (event.type) {
      case StripeSubscriptionEvent.INVOICE_PAID:
        if (isPaymentChargePending) {
          return [
            {
              type: PaymentTransactions.CHARGE,
              state: PaymentStatus.SUCCESS,
              amount: this.populateAmount(invoice),
              interactionId: paymentIntentId,
            },
          ];
        } else {
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
        }
      case StripeSubscriptionEvent.INVOICE_PAYMENT_FAILED:
        if (isPaymentChargePending) {
          return [
            {
              type: PaymentTransactions.CHARGE,
              state: PaymentStatus.FAILURE,
              amount: this.populateFailedAmount(invoice),
              interactionId: paymentIntentId,
            },
          ];
        } else {
          return [
            {
              type: PaymentTransactions.AUTHORIZATION,
              state: PaymentStatus.FAILURE,
              amount: this.populateFailedAmount(invoice),
              interactionId: paymentIntentId,
            },
            {
              type: PaymentTransactions.CHARGE,
              state: PaymentStatus.FAILURE,
              amount: this.populateFailedAmount(invoice),
              interactionId: paymentIntentId,
            },
          ];
        }
      case StripeEvent.CHARGE__REFUNDED:
        return [
          {
            type: PaymentTransactions.REFUND,
            state: PaymentStatus.SUCCESS,
            amount: this.populateChargeRefundAmount(charge),
            interactionId: paymentIntentId,
          },
          {
            type: PaymentTransactions.CHARGE_BACK,
            state: PaymentStatus.SUCCESS,
            amount: this.populateChargeRefundAmount(charge),
            interactionId: paymentIntentId,
          },
        ];
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

      /*
      case StripeEvent.PAYMENT_INTENT__PAYMENT_FAILED:
        return [
          {
            type: PaymentTransactions.AUTHORIZATION,
            state: PaymentStatus.FAILURE,
            amount: this.populateAmount(event),
            interactionId: paymentIntentId,
          },
        ];*/
      case StripeEvent.CHARGE__SUCCEEDED:
        if (event.data.object.captured) return [];
        return [
          {
            type: PaymentTransactions.AUTHORIZATION,
            state: PaymentStatus.SUCCESS,
            amount: this.populateAmount(invoice),
            interactionId: paymentIntentId,
          },
        ];
      default: {
        const error = `Unsupported event ${event.type}`;
        throw wrapStripeError(new Error(error));
      }
    }
  }

  private populateAmount(invoice: StripeInvoiceExpanded): Money {
    return {
      centAmount: invoice.amount_paid,
      currencyCode: invoice.currency.toUpperCase(),
    };
  }

  private populateChargeRefundAmount(charge: Stripe.Charge): Money {
    return {
      centAmount: charge.amount_refunded,
      currencyCode: charge.currency.toUpperCase(),
    };
  }

  private populateFailedAmount(invoice: StripeInvoiceExpanded): Money {
    return {
      centAmount: invoice.amount_due,
      currencyCode: invoice.currency.toUpperCase(),
    };
  }

  private getCtPaymentId(invoice: StripeInvoiceExpanded): string {
    return invoice.subscription_details?.metadata?.ctPaymentId ?? '';
  }
}
