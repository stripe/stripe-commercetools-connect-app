import { PaymentRequestSchemaDTO } from '../../dtos/stripe-payment.dto';
import {
  CommercetoolsCartService,
  CommercetoolsOrderService,
  CommercetoolsPaymentService,
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
