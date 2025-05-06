import { PaymentOutcome } from './dtos/stripe-payment.dto';
import Stripe from 'stripe';

export const parseJSON = <T extends object | []>(json?: string): T => {
  try {
    return JSON.parse(json || '{}');
  } catch (error) {
    console.error('Error parsing JSON', error);
    return {} as T;
  }
};

export const convertPaymentResultCode = (resultCode: PaymentOutcome): string => {
  switch (resultCode) {
    case PaymentOutcome.AUTHORIZED:
      return 'Success';
    case PaymentOutcome.REJECTED:
      return 'Failure';
    default:
      return 'Initial';
  }
};

export const isValidUUID = (uuid: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

export function isFromSubscriptionInvoice(event: Stripe.Event): boolean {
  if (event.type.startsWith('payment')) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    return !!paymentIntent.invoice;
  }

  if (event.type.startsWith('charge')) {
    const charge = event.data.object as Stripe.Charge;
    return !!charge.invoice;
  }

  return false;
}
