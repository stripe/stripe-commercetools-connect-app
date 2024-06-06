import { PaymentRequestSchemaDTO } from '../../dtos/mock-payment.dto';
import { CommercetoolsCartService, CommercetoolsPaymentService } from '@commercetools/connect-payments-sdk';

export type StripePaymentServiceOptions = {
  ctCartService: CommercetoolsCartService;
  ctPaymentService: CommercetoolsPaymentService;
};

export type CreatePayment = {
  data: PaymentRequestSchemaDTO;
};
export type CaptureMethod = 'automatic' | 'automatic_async' | 'manual';
