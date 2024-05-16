import { Stripe, StripeElements } from '@stripe/stripe-js';
import { PaymentComponent, PaymentMethods, PaymentResult, StripeElementConfiguration } from '../payment-enabler/payment-enabler';

export type ElementOptions = {
  paymentMethod: PaymentMethods;
};

export type BaseOptions = {
  sdk : Stripe,
  processorUrl: string;
  returnUrl: string;
  sessionId: string;
  environment: string;
  locale?: string;
  onComplete?: (result: PaymentResult) => void;
  onError?: (error?: any) => void;
}

/**
 * Base Web Component
 */
export abstract class BaseComponent implements PaymentComponent {
  protected paymentMethod: ElementOptions['paymentMethod'][];
  protected returnUrl: BaseOptions['returnUrl']; 
  protected sdk: Stripe;
  protected processorUrl: BaseOptions['processorUrl'];
  protected sessionId: BaseOptions['sessionId'];
  protected environment: BaseOptions['environment'];
  protected onComplete: (result: PaymentResult) => void;
  protected onError: (error?: any) => void;

  constructor(paymentMethod: PaymentMethods[], baseOptions: BaseOptions) {
    this.paymentMethod = paymentMethod;
    this.sdk = baseOptions.sdk;
    this.processorUrl = baseOptions.processorUrl;
    this.returnUrl = baseOptions.returnUrl;
    this.sessionId = baseOptions.sessionId;
    this.environment = baseOptions.environment;
    this.onComplete = baseOptions.onComplete;
    this.onError = baseOptions.onError;
  }

  abstract submit(): void;

  abstract createElements(): Promise<StripeElements | never>;

  showValidation?(): void;
  isValid?(): boolean;
  getState?(): {
    card?: {
      endDigits?: string;
      brand?: string;
      expiryDate? : string;
    }
  };
}
