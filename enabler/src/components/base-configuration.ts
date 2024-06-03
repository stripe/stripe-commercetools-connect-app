import { Stripe, StripeElements, StripeError, StripeExpressCheckoutElement, StripePaymentElement } from "@stripe/stripe-js";


/**
 * Base Web Component
 */
export abstract class BaseStripePaymentComponent implements BaseConfiguration{

    stripeSDK : StripeElementConfiguration["stripeSDK"];    
    elementsSDK : StripeElementConfiguration["elementsSDK"];
    element : StripeElementConfiguration["element"];
    environment : StripeElementConfiguration["environment"];
    returnURL: StripeElementConfiguration['returnURL']; 
    onComplete: StripeElementConfiguration["onComplete"];
    onError: StripeElementConfiguration["onError"];
    processorURL: StripeElementConfiguration["processorURL"];
    sessionId: StripeElementConfiguration["sessionId"];
    locale: StripeElementConfiguration["locale"];
    onActionRequired: StripeElementConfiguration["onActionRequired"];
    onConfirm: StripeElementConfiguration["onConfirm"];
  
    constructor(baseOptions: StripeElementConfiguration) {
        this.stripeSDK = baseOptions.stripeSDK;
        this.elementsSDK = baseOptions.elementsSDK;
        this.element = baseOptions.element;
        this.returnURL = baseOptions.returnURL;
        this.onComplete = baseOptions.onComplete;
        this.onError = baseOptions.onError;
    }
  
    abstract mount(selector : string): void;
}

export type SupportedStripeElement = StripeExpressCheckoutElement | StripePaymentElement;
export type SupportedSDK = Stripe;

export type BaseConfiguration = {
    environment: string;
    processorURL: string;
    returnURL: string;
    sessionId: string;
    locale?: string;
    onActionRequired?: () => Promise<void>;
    onConfirm?: () => Promise<void>;
    onComplete?: (result?: any) => void;
    onError?: (error: StripeError | 'fail' | 'invalid_shipping_address') => void;
};

export interface StripeElementConfiguration extends BaseConfiguration {
    stripeSDK : SupportedSDK;
    elementsSDK : StripeElements;
    element : SupportedStripeElement;
}