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
  PAYMENT_INTENT__PAYMENT_FAILED = 'payment_intent.payment_failed',
  CHARGE__REFUNDED = 'charge.refunded',
  CHARGE__CAPTURED = 'charge.captured',
  CHARGE__SUCCEEDED = 'charge.succeeded',
}

export enum StripeSubscriptionEvent {
  INVOICE_PAID = 'invoice.paid',
  INVOICE_PAYMENT_FAILED = 'invoice.payment_failed',
  CUSTOMER_SUBSCRIPTION_DELETED = 'customer.subscription.deleted', //TODO when canceled subscription
}

export enum PaymentStatus {
  FAILURE = 'Failure',
  SUCCESS = 'Success',
  PENDING = 'Pending',
  INITIAL = 'Initial',
}

export interface CreateOrderProps {
  cart: Cart;
  subscriptionId?: string;
  paymentIntentId?: string;
}
