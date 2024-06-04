import { Stripe, StripeElements, StripeExpressCheckoutElementOptions, StripePaymentElementOptions, loadStripe } from "@stripe/stripe-js";
import { PaymentElement } from "../payment-elements/payment-element";
import { BaseConfiguration, StripeElementConfiguration } from "../base-configuration";
import { ExpressCheckout } from "../payment-elements/express-checkout";


export type StripeElementType = {
    type : string
    options : StripeExpressCheckoutElementOptions | StripePaymentElementOptions
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

export class StripePayment {

    public setupData : Promise<SetupData>;
    public stripeSDK : Promise<Stripe>
    public elements? : StripeElements;
    private clientSecret : string; 

    constructor(options: BaseConfiguration) {
        this.setupData = StripePayment.setup(options);
    }

    private static async setup(options: BaseConfiguration) : Promise<SetupData> {
        
        const stripeSDK = await loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

        let environment = "live";

        if(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY?.includes("_test_")) {
            environment = "test"
        }
        console.log({
            configuration : {
                environment, 
                ...options
            },
            stripeSDK
        })
        return {
            configuration : {
                environment, 
                ...options
            },
            stripeSDK
        }
    }

    private async createIntent() : Promise<void>{
        const { configuration } = await this.setupData;
        
        const clientSecret = await fetch(`${configuration.processorURL}/getPaymentIntent`, {
            method: "GET",
            headers: {
                "Content-Type" : "application/json",
                "x-session-id" : configuration.sessionId
            }
        })
        .then(res => res.json())
        .then(({client_secret}) => client_secret);

        this.clientSecret = clientSecret;
    }

    async createStripeElement(stripeElement : StripeElementType) : Promise<PaymentElement | ExpressCheckout | never> {
        const { configuration, stripeSDK } = await this.setupData;
        console.log({configuration})
        if (!StripeElementTypes[stripeElement.type]){
            throw new Error(
                `Component type not supported: ${stripeElement}. Supported types: ${Object.keys(
                    StripeElementTypes
                ).join(", ")}`
            );
        }
        
        if (!this.elements){
            
            await this.createIntent();
            
            const appearance = {
                variables: { colorPrimaryText: '#262626' }
            };
            //elements require the client secret with the name client_secret, even when the Typescript type is writen as clientSecret
            this.elements = stripeSDK.elements?.({
                //@ts-ignore
                clientSecret : this.clientSecret,
                //@ts-ignore
                appearance,
            })
        }
        
        switch(stripeElement.type) {
            case StripeElementTypes.payment : {
                return new PaymentElement({
                    element : this.elements.create(stripeElement.type, stripeElement.options as StripePaymentElementOptions),
                    stripeSDK,
                    elementsSDK : this.elements, 
                    clientSecret : this.clientSecret,
                    ...configuration
                });    
            }
            case StripeElementTypes.expressCheckout : {
                return new ExpressCheckout({
                    element : this.elements.create(stripeElement.type, stripeElement.options as StripeExpressCheckoutElementOptions),
                    stripeSDK,
                    elementsSDK : this.elements,
                    clientSecret : this.clientSecret,
                    ...configuration
                });    
            }
        }
    }

    async getStripeElements() : Promise<StripeElements | never>{
    
        const { stripeSDK } = await this.setupData;

        if (!this.elements) {
            await this.createIntent();            

            this.elements = stripeSDK.elements?.({clientSecret : this.clientSecret});
        }


        return this.elements;
    }
}