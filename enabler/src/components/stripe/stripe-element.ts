import { Stripe, StripeElements } from "@stripe/stripe-js";
import { PaymentMethods } from "../../payment-enabler/payment-enabler";
import { BaseComponent, BaseOptions } from "../base";


export class EnablerElement extends BaseComponent {

    public elements;

    constructor(paymentMethod : PaymentMethods[], baseOptions: BaseOptions) {
        console.log({baseOptions})
        super(paymentMethod, baseOptions);
    }

    async submit() {
        let {error} = await (this.sdk as Stripe).confirmPayment({
            elements: this.elements,
            confirmParams: {
                return_url : this.returnUrl
            }
        })

        if (error.type === "card_error" || error.type === "validation_error") {
            this.onError(error.type);
        }
    }

    async createElements() : Promise<StripeElements | never> { 
        let { clientSecret } = await fetch(`${this.processorUrl}/create-payment-intent`, {
            method : "POST",
            headers : {
                "Content-Type" : "application/json"
            },
            body : JSON.stringify({
                items : [],
                paymentMethod : this.paymentMethod
            })
        })
        .then(res => res.json());

        // this.elements = (this.sdk as Stripe).elements?.({clientSecret});
        
        return (this.sdk as Stripe).elements?.({clientSecret});

        // for (const index in stripeElementConfiguration){
        //     const configuration = stripeElementConfiguration[index];
            
        //     const element = this.elements.create(configuration.elementType);

        //     element.mount(configuration.selector);


        // }

        // document.querySelector(selector)
        //     .addEventListener("submit", (e) => {
        //         e.preventDefault();
        //         this.submit();
        //     });
    }
}