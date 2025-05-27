import { Cart, Money, Payment } from '@commercetools/connect-payments-sdk';
import { PaymentAmount } from '@commercetools/connect-payments-sdk/dist/commercetools/types/payment.type';

export interface PaymentCreationProps {
  cart: Cart;
  amountPlanned: Money;
  interactionId?: string;
  isSubscription?: boolean;
}

export interface HandleCtPaymentCreationProps {
  cart: Cart;
  amountPlanned: PaymentAmount;
  interactionId: string;
  subscriptionId?: string;
}

export interface UpdatePaymentMetadataProps {
  cart: Cart;
  ctPaymentId: string;
  paymentIntentId?: string;
  subscriptionId?: string;
}

export interface UpdateSubscriptionPaymentTransactionsProps {
  payment: Payment;
  interactionId: string;
  subscriptionId: string;
  isPending?: boolean;
}

export interface HandlePaymentSubscriptionProps {
  cart: Cart;
  amountPlanned: Money;
  interactionId: string;
}
