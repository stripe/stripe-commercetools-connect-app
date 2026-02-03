import { ComponentOptions, PaymentComponent, PaymentMethod } from '../payment-enabler/payment-enabler';
import { BaseOptions } from "../payment-enabler/payment-enabler-mock";
import {Stripe, StripeElements, StripeExpressCheckoutElement, StripePaymentElement} from "@stripe/stripe-js";


/**
 * Base Web Component
 */
export abstract class BaseComponent implements PaymentComponent {

  protected paymentMethod: PaymentMethod;
  protected processorUrl: BaseOptions['processorUrl'];
  protected sessionId: BaseOptions['sessionId'];
  protected environment: BaseOptions['environment'];
  protected sdk: Stripe;
  protected elements: StripeElements;
  protected stripePaymentElement: StripePaymentElement | StripeExpressCheckoutElement;

  constructor(paymentMethod: PaymentMethod, baseOptions: BaseOptions, _componentOptions: ComponentOptions) {
    this.paymentMethod = paymentMethod;
    this.sdk = baseOptions.sdk;
    this.elements = baseOptions.elements;
    this.processorUrl = baseOptions.processorUrl;
    this.sessionId = baseOptions.sessionId;
    this.environment = baseOptions.environment;
    this.stripePaymentElement = baseOptions.paymentElement;
  }

  abstract submit(): void;

  abstract mount(selector: string): void ;

  showValidation?(): void;
  isValid?(): boolean;
  getState?(): {
    card?: {
      endDigits?: string;
      brand?: string;
      expiryDate? : string;
    }
  };
  isAvailable?(): Promise<boolean>;
}
