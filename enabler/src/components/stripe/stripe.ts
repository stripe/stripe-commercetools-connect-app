import { Stripe, StripeElements, StripeExpressCheckoutElementOptions, StripePaymentElementOptions, loadStripe } from "@stripe/stripe-js";
import { PaymentElement } from "../payment-elements/payment-element";
import { BaseConfiguration, StripeElementConfiguration } from "../base-configuration";
import { ExpressCheckout } from "../payment-elements/express-checkout";
import env from "../../constants";


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
        
        const stripeSDK = await loadStripe(env.VITE_STRIPE_PUBLISHABLE_KEY);

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

    async createStripeElement(stripeElement : StripeElementType) : Promise<PaymentElement | ExpressCheckout | never> {
        const { configuration, stripeSDK } = await this.setupData;
        
        if (!StripeElementTypes[stripeElement.type]){
            throw new Error(
                `Component type not supported: ${stripeElement.type}. Supported types: ${Object.keys(
                    StripeElementTypes
                ).join(", ")}`
            );
        }
        
        if (!this.elements){
            this.elements = stripeSDK.elements?.({
                //@ts-ignore
                mode: 'payment',
                amount: 120,
                currency: "usd",
                appearance : {}
            })
        }
        
        switch(stripeElement.type) {
            case StripeElementTypes.payment : {

                const element = this.elements.create(stripeElement.type, stripeElement.options as StripePaymentElementOptions); 
                return new PaymentElement({
                    element,
                    stripeSDK,
                    elementsSDK : this.elements, 
                    clientSecret : this.clientSecret,
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
                    ...configuration
                });    
            }
        }
    }

    async getStripeElements() : Promise<StripeElements | never>{
    
        const { stripeSDK } = await this.setupData;

        if (!this.elements) {
            // await this.createIntent();

            this.elements = stripeSDK.elements?.({clientSecret : this.clientSecret});
        }

        console.log(this.elements);

        return this.elements;
    }
}
