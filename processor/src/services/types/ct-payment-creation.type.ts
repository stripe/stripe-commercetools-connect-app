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
  /**
   * The Stripe PaymentIntent id (pi_) whose metadata must be updated (cart/customer/payment/project/
   * subscription ids). Kept separate from `interactionId` because subscription transactions are keyed
   * by the invoice id (in_): the CT payment/transactions use `interactionId`, while the Stripe PI
   * metadata is written against this id. If omitted, falls back to `interactionId` when it is a pi_.
   */
  paymentIntentId?: string;
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
