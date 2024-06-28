import { StripePaymentElement } from "@stripe/stripe-js";

import { BaseStripePaymentComponent, StripeElementConfiguration } from "../base-configuration";

export class PaymentElement extends BaseStripePaymentComponent {

    private showPayButton : boolean;
    public onComplete : ((e) => Promise<void>) | undefined;
    public onError : ((e) => void) | undefined;

    constructor(baseOptions: StripeElementConfiguration) {
        super(baseOptions);
        this.onComplete = baseOptions.onComplete;
        this.onError = baseOptions.onError;
    }

    async submit(){

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
                return_url : `${this.returnURL}`
            },
            redirect : "if_required"
        });
        
        if (error) {
            this.onError?.(error);
            
            return;
        }
        
        await this.onComplete?.(paymentIntent);
    
        const redirectUrl = new URL(this.returnURL)

        redirectUrl.searchParams.set("payment_intent", paymentIntent.id);
        redirectUrl.searchParams.set("payment_intent_client_secret", paymentIntent.client_secret);
        redirectUrl.searchParams.set("redirect_status", paymentIntent.status);
        
        window.location.href = redirectUrl.href;
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
