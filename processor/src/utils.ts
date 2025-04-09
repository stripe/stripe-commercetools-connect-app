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
