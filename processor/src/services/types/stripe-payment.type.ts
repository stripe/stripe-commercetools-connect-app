import { PaymentRequestSchemaDTO } from '../../dtos/stripe-payment.dto';
import {
  Cart,
  CommercetoolsCartService,
  CommercetoolsOrderService,
  CommercetoolsPaymentService,
  TransactionData,
} from '@commercetools/connect-payments-sdk';
import { PSPInteraction } from '@commercetools/connect-payments-sdk/dist/commercetools/types/payment.type';

export interface StripePaymentServiceOptions {
  ctCartService: CommercetoolsCartService;
  ctPaymentService: CommercetoolsPaymentService;
  ctOrderService: CommercetoolsOrderService;
}

export interface CtPaymentCreationServiceOptions {
  ctCartService: CommercetoolsCartService;
  ctPaymentService: CommercetoolsPaymentService;
}

export type CreatePayment = {
  data: PaymentRequestSchemaDTO;
};
export type CaptureMethod = 'automatic' | 'automatic_async' | 'manual';

export type StripeEventUpdatePayment = {
  id: string;
  pspReference: string;
  transactions: TransactionData[];
  paymentMethod?: string;
  pspInteraction?: PSPInteraction;
};

export enum StripeEvent {
  PAYMENT_INTENT__SUCCEEDED = 'payment_intent.succeeded',
  PAYMENT_INTENT__CANCELED = 'payment_intent.canceled',
  PAYMENT_INTENT__REQUIRED_ACTION = 'payment_intent.requires_action',
  PAYMENT_INTENT__PROCESSING = 'payment_intent.processing',
  PAYMENT_INTENT__PAYMENT_FAILED = 'payment_intent.payment_failed',
  PAYMENT_INTENT__PARTIALLY_FUNDED = 'payment_intent.partially_funded',
  CUSTOMER_CASH_BALANCE_TRANSACTION__CREATED = 'customer_cash_balance_transaction.created',
  CHARGE__REFUNDED = 'charge.refunded',
  /**
   * Terminal outcome of a refund, and the ONLY place some rails report it.
   *
   * `charge.refunded` fires when the Refund object is CREATED, which for an instant rail is also when
   * it succeeds — so treating the two as one thing worked for cards and hid a hole everywhere else.
   * Measured 2026-08-05: refunding a bank-transfer PaymentIntent returns `status: 'pending'`, because
   * the money has to travel back over the banking network. The connector wrote Refund/Success at that
   * moment and had no path to ever correct it, so a refund that later failed stayed recorded as
   * successful forever.
   *
   * refund.updated carries the transition out of pending (to succeeded, failed or canceled);
   * refund.failed fires specifically on failure. Both are registered because Stripe emits failure on
   * both channels and the redundancy is free — the handler is idempotent on refund id + status.
   */
  REFUND__UPDATED = 'refund.updated',
  REFUND__FAILED = 'refund.failed',
  CHARGE__CAPTURED = 'charge.captured',
  CHARGE__SUCCEEDED = 'charge.succeeded',
  CHARGE__UPDATED = 'charge.updated',
}

export enum StripeSubscriptionEvent {
  INVOICE_PAID = 'invoice.paid',
  INVOICE_PAYMENT_FAILED = 'invoice.payment_failed',
  CUSTOMER_SUBSCRIPTION_DELETED = 'customer.subscription.deleted', //TODO when canceled subscription
  INVOICE_UPCOMING = 'invoice.upcoming',
}

export enum PaymentStatus {
  FAILURE = 'Failure',
  SUCCESS = 'Success',
  PENDING = 'Pending',
  INITIAL = 'Initial',
}

export enum OrderPaymentState {
  PAID = 'Paid',
  FAILED = 'Failed',
}

export interface CreateOrderProps {
  cart: Cart;
  subscriptionId?: string;
  paymentIntentId?: string;
  paymentState?: OrderPaymentState;
}
