import { loadStripe } from "@stripe/stripe-js";
import { EnablerOptions, PaymentMethods } from "../../payment-enabler/payment-enabler";

import { BaseComponent, BaseOptions } from "../base";
import { EnablerElement } from "./stripe-element";


export class StripePayment {

    public setupData : Promise<{baseOptions : BaseOptions}>;
    public stripeAPI;
    public elements;

    constructor(options: EnablerOptions) {
        this.setupData = StripePayment.setup(options);
    }

    private static async setup(options: EnablerOptions) : Promise<{baseOptions : BaseOptions}> {
        console.log({options})
        
        const stripeAPI = await loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

        let environment = "live";

        if(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY?.includes("_test_")) {
            environment = "test"
        }
        console.log({
            baseOptions : {
                sdk : stripeAPI,
                environment, 
                ...options
            }
        })
        return {
            baseOptions : {
                sdk : stripeAPI,
                environment, 
                ...options
            }
        }
    }

    async createComponent(type : string[]) : Promise<BaseComponent | never>{
    
        const { baseOptions } = await this.setupData;
    
        if (!type.every(t => !!PaymentMethods[t])) {
            throw new Error(
                `Component type not supported: ${type}. Supported types: ${Object.keys(
                    PaymentMethods
                ).join(", ")}`
            );
        }

        return new EnablerElement(type.map(t => PaymentMethods[t]), baseOptions);
    }
}