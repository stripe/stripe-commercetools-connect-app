import { PaymentRequestSchemaDTO } from '../../dtos/stripe-payment.dto';
import {
  CommercetoolsCartService,
  CommercetoolsOrderService,
  CommercetoolsPaymentService,
} from '@commercetools/connect-payments-sdk';

export type MockPaymentServiceOptions = {
  ctCartService: CommercetoolsCartService;
  ctPaymentService: CommercetoolsPaymentService;
  ctOrderService: CommercetoolsOrderService;
};

export type CreatePaymentRequest = {
  data: PaymentRequestSchemaDTO;
};
