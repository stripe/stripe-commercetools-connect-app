import { StripePaymentElement } from "@stripe/stripe-js";

import { BaseStripePaymentComponent, StripeElementConfiguration } from "../base-configuration";

export class PaymentElement extends BaseStripePaymentComponent {
    
    private showPayButton : boolean;
    

    constructor(baseOptions: StripeElementConfiguration) {
        super(baseOptions);
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
            return
        }
        
        let { error } = await this.stripeSDK.confirmPayment({
            elements: this.elementsSDK,
            clientSecret: client_secret,
            confirmParams : {
                return_url : `${this.returnURL}` 
            }
        });

        if (error) {
            this.onError?.(error);
            
            return;
        }

        this.onComplete();
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