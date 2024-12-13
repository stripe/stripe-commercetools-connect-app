import { PaymentRequestSchemaDTO } from '../../dtos/stripe-payment.dto';
import {
  CommercetoolsCartService,
  CommercetoolsOrderService,
  CommercetoolsPaymentService,
  TransactionData,
} from '@commercetools/connect-payments-sdk';

export type StripePaymentServiceOptions = {
  ctCartService: CommercetoolsCartService;
  ctPaymentService: CommercetoolsPaymentService;
  ctOrderService: CommercetoolsOrderService;
};

export type CreatePayment = {
  data: PaymentRequestSchemaDTO;
};
export type CaptureMethod = 'automatic' | 'automatic_async' | 'manual';

export type StripeEventUpdatePayment = {
  id: string;
  pspReference?: string;
  transactions: TransactionData[];
  paymentMethod?: string;
};

export enum StripeEvent {
  PAYMENT_INTENT__SUCCEEDED = 'payment_intent.succeeded',
  PAYMENT_INTENT__CANCELED = 'payment_intent.canceled',
  PAYMENT_INTENT__REQUIRED_ACTION = 'payment_intent.requires_action',
  PAYMENT_INTENT__PAYMENT_FAILED = 'payment_intent.payment_failed',
  CHARGE__REFUNDED = 'charge.refunded',
  CHARGE__CAPTURED = 'charge.captured',
}

export enum PaymentStatus {
  FAILURE = 'Failure',
  SUCCESS = 'Success',
  PENDING = 'Pending',
  INITIAL = 'Initial',
}
