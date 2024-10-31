import { PaymentRequestSchemaDTO } from '../../dtos/stripe-payment.dto';
import { CommercetoolsCartService, CommercetoolsPaymentService } from '@commercetools/connect-payments-sdk';

export type MockPaymentServiceOptions = {
  ctCartService: CommercetoolsCartService;
  ctPaymentService: CommercetoolsPaymentService;
};

export type CreatePaymentRequest = {
  data: PaymentRequestSchemaDTO;
};
