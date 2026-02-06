import {
  Cart,
  CommercetoolsCartService,
  CommercetoolsOrderService,
  CommercetoolsPaymentService,
  LineItem,
  ShippingInfo,
} from '@commercetools/connect-payments-sdk';
import { PaymentAmount } from '@commercetools/connect-payments-sdk/dist/commercetools/types/payment.type';
import Stripe from 'stripe';

export interface ExtendedPaymentAmount extends PaymentAmount {
  totalCentAmount: number;
}

/**
 * Extended Invoice type that includes expanded properties.
 * When using expand: ['payment_intent', 'subscription', 'charge'] in Stripe API calls,
 * these properties are returned as full objects instead of string IDs.
 */
export interface StripeInvoiceExpanded extends Omit<Stripe.Invoice, 'payment_intent' | 'subscription' | 'charge'> {
  payment_intent?: Stripe.PaymentIntent | string | null;
  subscription?: Stripe.Subscription | string | null;
  charge?: Stripe.Charge | string | null;
  subscription_details?: {
    metadata?: Stripe.Metadata | null;
  } | null;
}

export interface StripeSubscriptionServiceOptions {
  ctCartService: CommercetoolsCartService;
  ctPaymentService: CommercetoolsPaymentService;
  ctOrderService: CommercetoolsOrderService;
}

export interface SubscriptionAttributes {
  description: string;
  recurring_interval: Stripe.PriceCreateParams.Recurring.Interval;
  recurring_interval_count: number;
  off_session: boolean;
  collection_method: Stripe.SubscriptionCreateParams.CollectionMethod;
  days_until_due?: number;
  cancel_at_period_end?: boolean;
  cancel_at?: string;
  billing_cycle_anchor_day?: number;
  billing_cycle_anchor_time?: string;
  billing_cycle_anchor_date?: string;
  trial_period_days?: number;
  trial_end_date?: string;
  missing_payment_method_at_trial_end?: Stripe.SubscriptionCreateParams.TrialSettings.EndBehavior.MissingPaymentMethod;
  proration_behavior?: Stripe.SubscriptionCreateParams.ProrationBehavior;
}

export interface CreateStripePriceProps {
  amount: PaymentAmount;
  product: LineItem;
  stripeProductId: string;
  attributes: SubscriptionAttributes;
}

export interface CreateStripeShippingPriceProps {
  shipping: ShippingInfo;
  stripeProductId: string;
  attributes: SubscriptionAttributes;
}

export interface CreateSetupIntentProps {
  cart: Cart;
  stripeCustomerId: string;
  offSession?: boolean;
}

export interface GetCurrentPaymentProps {
  paymentReference: string;
  invoice: Stripe.Invoice;
  subscriptionParams: Stripe.SubscriptionCreateParams;
}

export interface UpdateSubscriptionMetadataProps {
  subscriptionId: string;
  cart?: Cart;
  ctPaymentId?: string;
  customerId?: string;
  orderId?: string;
}

export interface BasicSubscriptionData {
  cart: Cart;
  stripeCustomerId: string;
  subscriptionParams: Stripe.SubscriptionCreateParams;
  billingAddress?: string;
  merchantReturnUrl: string;
}

export interface FullSubscriptionData extends BasicSubscriptionData {
  lineItemAmount: PaymentAmount;
  amountPlanned: PaymentAmount;
  priceId: string;
  shippingPriceId?: string;
}
