import { StripePaymentElement } from "@stripe/stripe-js";

import { BaseStripePaymentComponent, StripeElementConfiguration } from "../base-configuration";

export class PaymentElement extends BaseStripePaymentComponent {
    
    private showPayButton : boolean;

    constructor(baseOptions: StripeElementConfiguration) {
        super(baseOptions);
    }

    async submit(){

        let { errors : processorError, ...res } = await fetch(`${this.processorURL}/payments`,{
            method : "POST",
            headers : {
                "Content-Type": "application/json",
                "x-session-id" : this.sessionId
            },
            body : JSON.stringify({
                paymentMethod : {
                    type : "card",
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
        document.querySelector(selector)
            .insertAdjacentHTML("afterbegin", this._getTemplate());
        
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