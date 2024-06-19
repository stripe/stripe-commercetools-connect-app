import { StripeExpressCheckoutElement, StripeExpressCheckoutElementConfirmEvent } from "@stripe/stripe-js";
import { BaseStripePaymentComponent, StripeElementConfiguration } from "../base-configuration";

export type ExpressCheckoutErrorReason = {reason?: 'fail' | 'invalid_shipping_address'};

export class ExpressCheckout extends BaseStripePaymentComponent {

    constructor(baseOptions: StripeElementConfiguration) {
        super(baseOptions);
    }

    async submit(){

        let { errors : processorError, sClientSecret : client_secret} = await fetch(`${this.processorURL}/payments`,{
            method : "POST",
            headers : {
                "Content-Type": "application/json",
                "x-session-id" : this.sessionId
            },
            body : JSON.stringify({
                paymentMethod : {
                    type : "expressCheckout"
                }
            })
        }).then(res => res.json())

        if ( processorError && !client_secret) {
            console.warn(`Error in processor: ${processorError}`);
            return
        }

        let { error } = await this.stripeSDK.confirmPayment({
            elements: this.elementsSDK,
            clientSecret: client_secret,
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