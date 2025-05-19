import Stripe from 'stripe';
import { Attribute, LocalizedString } from '@commercetools/platform-sdk';
import { PaymentOutcome } from './dtos/stripe-payment.dto';

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

export const isFromSubscriptionInvoice = (event: Stripe.Event): boolean => {
  if (event.type.startsWith('payment')) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    return !!paymentIntent.invoice;
  }

  if (event.type.startsWith('charge')) {
    const charge = event.data.object as Stripe.Charge;
    return !!charge.invoice;
  }

  return false;
};

export const transformVariantAttributes = <T>(attributes?: Attribute[]): T => {
  const result: Record<string, string> = {};
  for (const { name, value } of attributes ?? []) {
    result[name] = isObject(value) ? value.key : value;
  }
  return result as T;
};

export const isObject = (value: unknown): value is Record<string, string> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const convertDateToUnixTimestamp = (date: string | number): number => {
  return Math.floor(new Date(date).getTime() / 1000);
};

export const parseTimeString = (timeString: string): { hour: number; minute: number; second: number } => {
  const [hoursStr, minutesStr, rest] = timeString.split(':');
  const [secondsStr] = rest.split('.');

  return {
    hour: parseInt(hoursStr, 10),
    minute: parseInt(minutesStr, 10),
    second: parseInt(secondsStr, 10),
  };
};

export const getLocalizedString = (obj?: LocalizedString): string => {
  if (!obj) {
    return '';
  }

  const locale = Object.keys(obj).find((key) => key.startsWith('en')) || 'en';
  return obj[locale] || obj['en'] || '';
};
