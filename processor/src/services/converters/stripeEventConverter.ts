import { TransactionData, Money } from '@commercetools/connect-payments-sdk';

import Stripe from 'stripe';
import { PaymentStatus, StripeEvent, StripeEventUpdatePayment } from '../types/stripe-payment.type';
import { PaymentTransactions } from '../../dtos/operations/payment-intents.dto';
import { wrapStripeError } from '../../clients/stripe.client';
import { METADATA_PAYMENT_ID_FIELD } from '../../constants';

export class StripeEventConverter {
  public convert(opts: Stripe.Event): StripeEventUpdatePayment {
    // customer_cash_balance_transaction.created is observability-only: the event object is
    // customer-scoped, carries no ct_payment_id, and has no commercetools transaction model
    // in v1. The route must never send it here. Rejecting it explicitly makes that invariant
    // self-enforcing instead of relying on the route switch alone, and produces a readable
    // error instead of the cast failure it would otherwise hit below.
    if (opts.type === StripeEvent.CUSTOMER_CASH_BALANCE_TRANSACTION__CREATED) {
      throw wrapStripeError(new Error(`Event ${opts.type} is observability-only and must not be converted`));
    }

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
        response: this.buildPspInteractionResponse(opts),
      },
      transactions: this.populateTransactions(opts, paymentIntentId),
    };
  }

  /**
   * Serializes the event for the commercetools interface interaction, stripping bank
   * transfer account details.
   *
   * A `display_bank_transfer_instructions` payload carries the merchant's virtual account —
   * full IBAN, sort code, routing number — plus `hosted_instructions_url`, an unauthenticated
   * customer-facing link. Persisted verbatim, all of it becomes readable to every Merchant
   * Center user with payment read access. `reference` and `amount_remaining` are kept: those
   * are the fields support actually needs to trace a transfer.
   *
   * `client_secret` is nulled for the same reason. This is the first path that persists a
   * PaymentIntent while it is still open (`requires_action` / `partially_funded`), so unlike
   * the settled-PI precedent that secret is live and usable against Stripe's public client
   * API for the whole funding window. The nulling is scoped to this branch so that card,
   * crypto, Boleto and subscription interactions keep a byte-identical shape.
   *
   * This lives here, as a private method, rather than as a shared helper in utils.ts on
   * purpose. The converter is the only thing that builds `pspInteraction`, so a private
   * method is a choke point that cannot be bypassed. A public helper inverts the failure
   * mode: someone adds a persistence path and forgets to call it. Promoting this to utils.ts
   * later is trivial; discovering that a caller skipped it is not. Please do not "simplify"
   * it into a shared export.
   */
  private buildPspInteractionResponse(event: Stripe.Event): string {
    const instructions = (event.data.object as Stripe.PaymentIntent)?.next_action?.display_bank_transfer_instructions;
    if (!instructions) {
      // No bank transfer instructions in this payload: serialize exactly as before, so card,
      // crypto, Boleto and subscription interactions keep a byte-identical shape.
      return JSON.stringify(event);
    }

    const redacted = JSON.parse(JSON.stringify(event)) as Stripe.Event;
    const redactedPaymentIntent = redacted.data.object as Stripe.PaymentIntent;
    const target = redactedPaymentIntent.next_action?.display_bank_transfer_instructions;
    if (target) {
      delete target.financial_addresses;
      // Typed `string | null` by the SDK, so these are nulled rather than deleted to preserve shape.
      target.hosted_instructions_url = null;
    }
    redactedPaymentIntent.client_secret = null;
    return JSON.stringify(redacted);
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
      case StripeEvent.PAYMENT_INTENT__PROCESSING: {
        const pi = event.data.object as Stripe.PaymentIntent;
        return [
          {
            type: PaymentTransactions.AUTHORIZATION,
            state: PaymentStatus.PENDING,
            amount: { centAmount: pi.amount, currencyCode: pi.currency.toUpperCase() },
            interactionId: paymentIntentId,
          },
        ];
      }
      case StripeEvent.PAYMENT_INTENT__REQUIRED_ACTION: {
        // Bank transfer awaiting funds. populateAmount() must NOT be reused here: it reads
        // `amount_received`, which is 0 until the wire lands, so it would book a 0-cent
        // authorization. `pi.amount` is the full intended amount, taken verbatim as integer
        // cents from Stripe — no arithmetic is performed on this value.
        const pi = event.data.object as Stripe.PaymentIntent;
        return [
          {
            type: PaymentTransactions.AUTHORIZATION,
            state: PaymentStatus.PENDING,
            amount: { centAmount: pi.amount, currencyCode: pi.currency.toUpperCase() },
            interactionId: paymentIntentId,
          },
        ];
      }
      case StripeEvent.PAYMENT_INTENT__PARTIALLY_FUNDED:
        // No commercetools transaction, on purpose. A second Authorization/Pending breaks the
        // dedup invariant (a three-instalment top-up would book 3x the order value); a partial
        // Charge/Success books revenue that is not on the platform balance, since the funds sit
        // in the customer's cash balance; and Charge/Pending already means something else in
        // the subscription flows (KI-019). The PaymentIntent state has not changed and neither
        // has the commercetools state — only the pspInteraction is persisted, as an audit trail.
        return [];
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
