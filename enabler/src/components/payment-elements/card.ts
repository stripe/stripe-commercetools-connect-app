import { StripePaymentElement } from "@stripe/stripe-js";
import { BaseStripePaymentComponent, StripeElementConfiguration } from "../base-configuration";

export class Card extends BaseStripePaymentComponent {
    
    private showPayButton : boolean;

    constructor(baseOptions: StripeElementConfiguration) {
        console.log({baseOptions})
        super(baseOptions);
    }

    async submit(){
        //TODO call processor API to register payment url : /payments
        debugger
        let { error } = await this.stripeSDK.confirmPayment({
            elements: this.elementsSDK,
            confirmParams : {
                return_url : `${window.location.href}${this.returnURL}` 
            }
        });

        if (error) {

            if(!this.onError){
                console.warn('You must provide an "onError" callback');
            } else {
                this.onError?.(error);
            }
            
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