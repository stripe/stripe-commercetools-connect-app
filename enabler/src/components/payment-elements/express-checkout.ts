import { StripeExpressCheckoutElement, StripeExpressCheckoutElementConfirmEvent } from "@stripe/stripe-js";
import { BaseStripePaymentComponent, StripeElementConfiguration } from "../base-configuration";
import {PaymentResult} from "../../payment-enabler/payment-enabler.ts";

export type ExpressCheckoutErrorReason = {reason?: 'fail' | 'invalid_shipping_address'};

export class ExpressCheckout extends BaseStripePaymentComponent {

    public onComplete : (result: PaymentResult) => void;
    public onError : ((e) => void) | undefined;

    constructor(baseOptions: StripeElementConfiguration) {
        super(baseOptions);
        this.onComplete = baseOptions.onComplete;
        this.onError = baseOptions.onError;
    }

    async submit(e : StripeExpressCheckoutElementConfirmEvent){
        //MVP if additional information needs to be included in the payment intent, this method should be supplied with the necessary data.
        let { errors : processorError, sClientSecret : client_secret} = await fetch(`${this.processorURL}/payments`,{
            method : "GET",
            headers : {
                "Content-Type": "application/json",
                "x-session-id" : this.sessionId
            }
        }).then(res => res.json())

        if ( processorError && !client_secret) {
            this.onError?.({message: processorError?.message})
            console.warn(`Error in processor: ${processorError}`);
            return
        }

        let { error, paymentIntent } = await this.stripeSDK.confirmPayment({
            elements: this.elementsSDK,
            clientSecret: client_secret,
            confirmParams : {
                return_url : `${this.returnURL}`
            },
            redirect : "if_required"
        });


        if (error) {
            this.onError?.(error);

            return;
        }

        //await this.onComplete?.(e);//TODO review
        console.log(e)

        const redirectUrl = new URL(this.returnURL)

        redirectUrl.searchParams.set("payment_intent", paymentIntent.id);
        redirectUrl.searchParams.set("payment_intent_client_secret", paymentIntent.client_secret);
        redirectUrl.searchParams.set("redirect_status", paymentIntent.status);

        window.location.href = redirectUrl.href;
    }

    mount(selector : string) {

        (this.element as StripeExpressCheckoutElement).mount(selector);

        (this.element as StripeExpressCheckoutElement).on("confirm", async (e : StripeExpressCheckoutElementConfirmEvent) => {
            this.submit(e);
        })
    }

}

