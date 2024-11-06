import { ComponentOptions, PaymentComponent, PaymentMethod, PaymentResult } from '../payment-enabler/payment-enabler';
import { BaseOptions } from "../payment-enabler/payment-enabler-mock";
import {BaseConfiguration} from "./base-configuration.ts";
import {Stripe} from "@stripe/stripe-js";

export type ElementOptions = {
  paymentMethod: PaymentMethod;
};



/**
 * Base Web Component
 */
export abstract class BaseComponent implements PaymentComponent {
  protected paymentMethod: ElementOptions['paymentMethod'];
  protected sdk: Stripe;
  protected processorUrl: BaseConfiguration['processorURL'];
  protected sessionId: BaseConfiguration['sessionId'];
  protected environment: BaseConfiguration['environment'];
  protected onComplete: (result: PaymentResult) => void;
  protected onError: (error?: any) => void;

  constructor(paymentMethod: PaymentMethod, baseOptions: BaseOptions, _componentOptions: ComponentOptions) {
    this.paymentMethod = paymentMethod;
    this.sdk = baseOptions.stripeSDK;
    this.processorUrl = baseOptions.configuration.processorURL;
    this.sessionId = baseOptions.configuration.sessionId;
    this.environment = baseOptions.configuration.environment;
    /**this.onComplete = baseOptions.configuration.onComplete;
    this.onError = baseOptions.configuration.onError;**/
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
