import { Stripe, StripeElements, StripeError, StripeExpressCheckoutElement, StripePaymentElement } from "@stripe/stripe-js";


/**
 * Base Web Component
 */
export abstract class BaseStripePaymentComponent implements BaseConfiguration{

    protected stripeSDK : StripeElementConfiguration["stripeSDK"];    
    protected elementsSDK : StripeElementConfiguration["elementsSDK"];
    protected element : StripeElementConfiguration["element"];
    protected environment : StripeElementConfiguration["environment"];
    protected returnURL: StripeElementConfiguration['returnURL']; 
    protected onComplete: StripeElementConfiguration["onComplete"];
    protected onError: StripeElementConfiguration["onError"];
    protected processorURL: StripeElementConfiguration["processorURL"];
    protected sessionId: StripeElementConfiguration["sessionId"];
    protected locale: StripeElementConfiguration["locale"];
    protected onActionRequired: StripeElementConfiguration["onActionRequired"];
    protected onConfirm: StripeElementConfiguration["onConfirm"];
  
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