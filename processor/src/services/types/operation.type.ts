import { ConfigResponseSchemaDTO } from '../../dtos/operations/config.dto';
import {
  AmountSchemaDTO,
  PaymentIntentRequestSchemaDTO,
  PaymentModificationStatus,
} from '../../dtos/operations/payment-intents.dto';
import { StatusResponseSchemaDTO } from '../../dtos/operations/status.dto';
import { Payment } from '@commercetools/connect-payments-sdk/dist/commercetools';

export type CapturePaymentRequest = {
  amount: AmountSchemaDTO;
  payment: Payment;
  merchantReference?: string;
};

export type CancelPaymentRequest = {
  payment: Payment;
  merchantReference?: string;
};

export type RefundPaymentRequest = {
  amount: AmountSchemaDTO;
  payment: Payment;
  merchantReference?: string;
};

export type ReversePaymentRequest = {
  payment: Payment;
  merchantReference?: string;
};

export type PaymentProviderModificationResponse = {
  outcome: PaymentModificationStatus;
  pspReference: string;
};

export type ConfigResponse = ConfigResponseSchemaDTO;

export type StatusResponse = StatusResponseSchemaDTO;

export type ModifyPayment = {
  paymentId: string;
  stripePaymentIntent?: string;
  stripeEventType?: string;
  data: PaymentIntentRequestSchemaDTO;
};
