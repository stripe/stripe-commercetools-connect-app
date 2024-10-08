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
    processorURL: StripeElementConfiguration["processorURL"];
    sessionId: StripeElementConfiguration["sessionId"];
    locale: StripeElementConfiguration["locale"];
    publishableKey : StripeElementConfiguration["publishableKey"];
    protected clientSecret : string;
    
    constructor(baseOptions: StripeElementConfiguration) {
        this.stripeSDK = baseOptions["stripeSDK"];
        this.elementsSDK = baseOptions["elementsSDK"];
        this.element = baseOptions["element"];
        this.environment = baseOptions["environment"];
        this.returnURL = baseOptions["returnURL"];
        this.processorURL = baseOptions["processorURL"];
        this.sessionId = baseOptions["sessionId"];
        this.locale = baseOptions["locale"];
        this.clientSecret = baseOptions["clientSecret"];
        this.publishableKey = baseOptions["publishableKey"];
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
    publishableKey : string;
};

export interface StripeElementConfiguration extends BaseConfiguration {
    stripeSDK : SupportedSDK;
    elementsSDK : StripeElements;
    element : SupportedStripeElement;
    clientSecret : string;
    onComplete : (e) => Promise<void>;
    onError : (error: StripeError | 'fail' | 'invalid_shipping_address' | 'Container element not found') => void;
}