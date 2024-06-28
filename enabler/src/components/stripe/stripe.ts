import { Stripe, StripeElements, StripeElementsOptionsMode, StripeExpressCheckoutElementOptions, StripePaymentElementOptions, loadStripe } from "@stripe/stripe-js";
import { PaymentElement } from "../payment-elements/payment-element";
import { BaseConfiguration, StripeElementConfiguration } from "../base-configuration";
import { ExpressCheckout } from "../payment-elements/express-checkout";
import env from "../../constants";

export type StripeElementType = {
    type : string
    options : StripeExpressCheckoutElementOptions | StripePaymentElementOptions,
    onComplete : (e) => Promise<void>,
    onError: (e) => void
}

export enum StripeElementTypes {
    payment = "payment",
    expressCheckout = "expressCheckout"
}

export type SetupData = {
    configuration : BaseConfiguration,
    stripeSDK : Stripe,
    elementsSDK? : StripeElementConfiguration
} 

export type ConfigElementResponse = {
    cartInfo: {
      amount: number,
      currency: string,
    },
    appearance?: string,
    captureMethod : "manual" | "automatic"
};

export interface ElementsConfig{
    mode : StripeElementsOptionsMode["mode"],
    amount : StripeElementsOptionsMode["amount"],
    currency : StripeElementsOptionsMode["currency"],
    appearance : StripeElementsOptionsMode["appearance"],
    capture_method : StripeElementsOptionsMode["capture_method"]
}

export class StripePayment {

    public setupData : Promise<SetupData>;
    public elements? : StripeElements;
    public elementsConfiguration : ConfigElementResponse;
    private clientSecret : string; 


    constructor(options: BaseConfiguration) {
        this.setupData = StripePayment.setup(options);
        this.elementsConfiguration 
    }

    get stripeSDK(){
        return this.setupData
            .then(({stripeSDK}) => stripeSDK)
            .catch(_ => null)
    }

    private static async setup(options: BaseConfiguration) : Promise<SetupData> {
        
        const stripeSDK = await loadStripe(options.publishableKey);

        let environment = "live";
        
        if(env.VITE_STRIPE_PUBLISHABLE_KEY?.includes("_test_")) {
            environment = "test"
        }
        
        return {
            configuration : {
                environment, 
                ...options
            },
            stripeSDK
        }
    }

    private async initializeStripeElements() {
        const { stripeSDK } = await this.setupData;
        this.elements = stripeSDK.elements?.({
            mode: 'payment',
            amount: this.elementsConfiguration.cartInfo.amount,
            currency: this.elementsConfiguration.cartInfo.currency,
            appearance : JSON.parse(this.elementsConfiguration.appearance ? this.elementsConfiguration.appearance : "{}"),
            capture_method: this.elementsConfiguration.captureMethod,
        })
    }

    private async fetchElementConfiguration(elementType : string) : Promise<ConfigElementResponse>{

        const { configuration } = await this.setupData;

        let response = await fetch(`${configuration.processorURL}/get-config-element/${elementType}`,
            {
                headers : {
                    "Content-Type": "application/json",
                    "x-session-id" : configuration.sessionId
                },
            }
        )
        .then(res => res.json())
        .then(res => {
            res.cartInfo.currency = res.cartInfo.currency.toLowerCase()
            
            return res;
        })

        return response;
    }

    async createStripeElement(stripeElement : StripeElementType) : Promise<PaymentElement | ExpressCheckout | never> {
        const { configuration, stripeSDK } = await this.setupData;
        
        if (!StripeElementTypes[stripeElement.type]){
            throw new Error(
                `Component type not supported: ${stripeElement.type}. Supported types: ${Object.keys(
                    StripeElementTypes
                ).join(", ")}`
            );
        }
        
        if (!this.elementsConfiguration) {
            this.elementsConfiguration = await this.fetchElementConfiguration(stripeElement.type);
        }

        if (!this.elements){
            await this.initializeStripeElements();
        }

        switch(stripeElement.type) {
            case StripeElementTypes.payment : {

                const element = this.elements.create(stripeElement.type, stripeElement.options as StripePaymentElementOptions); 
                return new PaymentElement({
                    element,
                    stripeSDK,
                    elementsSDK : this.elements, 
                    clientSecret : this.clientSecret,
                    onComplete : stripeElement.onComplete,
                    onError : stripeElement.onError,
                    ...configuration
                });    
            }
            case StripeElementTypes.expressCheckout : {
                const element = this.elements.create(stripeElement.type, stripeElement.options as StripeExpressCheckoutElementOptions);
                return new ExpressCheckout({
                    element,
                    stripeSDK,
                    elementsSDK : this.elements,
                    clientSecret : this.clientSecret,
                    onComplete : stripeElement.onComplete,
                    onError : stripeElement.onError,
                    ...configuration
                });
            }
        }
    }

    public submit(){
        //TODO
    }

    async getStripeElements() : Promise<StripeElements | never>{
    
        if (!this.elements) {
            this.initializeStripeElements();
        }

        return this.elements;
    }
}
