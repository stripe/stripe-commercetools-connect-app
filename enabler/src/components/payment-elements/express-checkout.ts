import { StripeExpressCheckoutElement, StripeExpressCheckoutElementConfirmEvent } from "@stripe/stripe-js";
import { BaseStripePaymentComponent, StripeElementConfiguration } from "../base-configuration";

export type ExpressCheckoutErrorReason = {reason?: 'fail' | 'invalid_shipping_address'};

export class ExpressCheckout extends BaseStripePaymentComponent {

    constructor(baseOptions: StripeElementConfiguration) {
        super(baseOptions);
    }

    async submit(){
        let { errors : processorError, sClientSecret } = await fetch(`${this.processorURL}/payments`,{
            method : "POST",
            headers : {
                "Content-Type": "application/json",
                "x-session-id" : this.sessionId
            },
            body : JSON.stringify({
                paymentMethod : {
                    type : "expressCheckout",
                    paymentIntent : this.clientSecret
                }
            })
        }).then(res => res.json())

        //This process does NOT cancel the payment confirm
        if ( processorError ) {
            console.warn(`Error in processor: ${processorError}`)
        }

        let { error } = await this.stripeSDK.confirmPayment({
            elements: this.elementsSDK,
            confirmParams : {
                return_url : `${window.location.href}${this.returnURL}` 
            }
        });

        if (error) {
            this.onError?.(error);
            return;
        }

        this.onComplete();
    }

    mount(selector : string) {
        
        (this.element as StripeExpressCheckoutElement).mount(selector);

        (this.element as StripeExpressCheckoutElement).on("confirm", async (_ : StripeExpressCheckoutElementConfirmEvent) => {
            this.submit();
        })
    }

}