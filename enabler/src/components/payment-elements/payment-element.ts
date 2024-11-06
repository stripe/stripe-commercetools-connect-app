import { StripePaymentElement } from "@stripe/stripe-js";

import { BaseStripePaymentComponent, StripeElementConfiguration } from "../base-configuration";
import { PaymentResult} from "../../payment-enabler/payment-enabler.ts";
//import {DropinComponents} from "../../dropin/dropin-embedded.ts";

export class PaymentElement extends BaseStripePaymentComponent {

    private showPayButton : boolean;
    public onComplete : (result: PaymentResult) => void | undefined;
    public onError : ((e) => void) | undefined;
    //private dropinComponents: DropinComponents;


    constructor(baseOptions: StripeElementConfiguration) {
        super(baseOptions);
        this.onComplete = baseOptions.onComplete;
        this.onError = baseOptions.onError;
        this.showPayButton = true; //TODO review this button.
    }

    async submit(){
        console.log('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<< Payment element submit')
        const { error : submitError } = await this.elementsSDK.submit();

        if (submitError) {
            this.onError?.(submitError);

            return;
        }

        //MVP if additional information needs to be included in the payment intent, this method should be supplied with the necessary data.
        let { errors : processorError, sClientSecret : client_secret} = await fetch(`${this.processorURL}/payments`,{
            method : "GET",
            headers : {
                "Content-Type": "application/json",
                "x-session-id" : this.sessionId
            }
        }).then(res => res.json())

        if ( processorError && !client_secret) {
            console.warn(`Error in processor: ${processorError}`);
            this.onError?.({message: processorError?.message})
            return
        }

        let { error, paymentIntent } = await this.stripeSDK.confirmPayment({
            elements: this.elementsSDK,
            clientSecret: client_secret,
            confirmParams : {
                return_url : 'https://www.google.com'//`${this.returnURL}`//TODO review the retunr_url that need to be here.
            },
            redirect : "if_required"
        });

        if (error) {
            this.onError?.(error);

            return;
        }

        //TODO e.g. if (data.resultCode === "Authorised" || data.resultCode === "Pending") {
        //               component.setStatus("success");
        //               options.onComplete && options.onComplete({ isSuccess: true, paymentReference });
        //             } else {
        //               options.onComplete && options.onComplete({ isSuccess: false });
        //               component.setStatus("error");
        //             }
        //TODO review what is what we need to return if beacuse paymentIntent.status can be different
        await this.onComplete?.({isSuccess:true, paymentReference:paymentIntent.id});

        //TODO remove if, only testing the redirect of submit.
        if(false){
            const redirectUrl = new URL(this.returnURL)

            redirectUrl.searchParams.set("payment_intent", paymentIntent.id);
            redirectUrl.searchParams.set("payment_intent_client_secret", paymentIntent.client_secret);
            redirectUrl.searchParams.set("redirect_status", paymentIntent.status);

            window.location.href = redirectUrl.href;
        }

    }

    mount(selector : string) {
        const element = document.querySelector(selector)

        if (!element) {
            this.onError?.("Container element not found")
            return;
        }

        element.insertAdjacentHTML("afterbegin", this._getTemplate());

        if (this.showPayButton){

            document.querySelector("#card-element-paymentButton")
              ?.addEventListener?.("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.submit();
            });
        }

        (this.element as StripePaymentElement).mount("#card-element-container")
    }

    private _getTemplate() : string{
        const submitButton = this.showPayButton ?
          `<button id="card-element-paymentButton" type="submit">Pay</button>`
          :
          "";

        return `
            <div>
                <form id="card-element-form">
                    <div id="card-element-container">
                    </div>
                    ${submitButton}
                </form>
            </div>`
    }

}
