import { StripeElements } from "@stripe/stripe-js";

export type StripeElementConfiguration = {
  elementType : string,
  selector : string,
  container? : HTMLElement
}

export interface PaymentComponent {
  createElements() : Promise<StripeElements | never>;
  submit(): void;
  showValidation?(): void;
  isValid?(): boolean;
  getState?(): {
    card?: {
      endDigits?: string;
      brand?: string;
      expiryDate?: string;
    }
  };
}

export interface PaymentComponentBuilder {
  componentHasSubmit?: boolean;
  build(config: ComponentOptions): PaymentComponent;
}

export type EnablerOptions = {
  processorUrl: string;
  returnUrl: string; // URL in which Stripe redirects after a payment intent is confirmed
  sessionId: string;
  locale?: string;
  onActionRequired?: () => Promise<void>;
  onComplete?: (result: PaymentResult) => void;
  onError?: (error: any) => void;
};

export enum PaymentMethods {
  card = "card",
  oxxo = "oxxo",
  link = "link",
  applepay = "applepay",
  googlepay = "googlepay",
}

export type PaymentResult = {
  isSuccess: true;
  paymentReference: string;
} | { isSuccess: false };

export type ComponentOptions = {
  showPayButton?: boolean;
  onClick?: () => boolean;
};

export interface PaymentEnabler {
  /** 
   * @throws {Error}
   */
  createComponentBuilder: (type: string) => Promise<PaymentComponentBuilder | never>
}
