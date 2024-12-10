
import {
  DropinComponent,
  DropinOptions,
  PaymentDropinBuilder,
} from "../payment-enabler/payment-enabler";
import { BaseOptions } from "../payment-enabler/payment-enabler-mock";
import { StripePaymentElement} from "@stripe/stripe-js";

export class DropinEmbeddedBuilder implements PaymentDropinBuilder {
  public dropinHasSubmit = true; // refering to if checkout is going to call the submit func
  private baseOptions: BaseOptions;

  constructor(baseOptions: BaseOptions) {
    this.baseOptions = baseOptions;
  }

  build(config: DropinOptions): DropinComponent {
    const dropin = new DropinComponents({
      baseOptions: this.baseOptions,
      dropinOptions: config,
    });

    dropin.init();
    return dropin;
  }
}

export class DropinComponents implements DropinComponent {
  private baseOptions: BaseOptions;
  private paymentElement : StripePaymentElement;
  private dropinOptions: DropinOptions;


  constructor(opts: {
    baseOptions : BaseOptions,
    dropinOptions: DropinOptions
  }) {
    this.baseOptions = opts.baseOptions;
    this.dropinOptions = opts.dropinOptions;
  }

  init(): void {
    this.dropinOptions.showPayButton = false;
    this.paymentElement = this.baseOptions.paymentElement;

  }

  addSubmitButton(selector): void {
    // Create the submit button
    const button = document.createElement("button");
    button.id = "card-element-paymentButton";
    button.textContent = "Submit Payment";
    button.style.cssText = "padding: 10px 20px; font-size: 16px; background-color: #0070f3; color: white; border: none; cursor: pointer;";

    // Attach an event listener to trigger the submit function
    button.addEventListener("click", () => {
      console.log("Submit button clicked");
      this.submit().catch((error) => {
        console.error("Error during payment submission:", error);
      });
    });

    // Append the button to the parent element of the payment element
    const paymentElementParent = document.querySelector(selector);
    if (paymentElementParent) {
      paymentElementParent.appendChild(button);
    } else {
      console.error("Payment element parent not found. Ensure the selector is correct.");
    }

  }

  async mount(selector: string) {
    if (this.baseOptions.paymentElement) {
      this.paymentElement.mount(selector);
      this.addSubmitButton(selector);
    } else {
      console.error("Payment Element not initialized");
    }
  }

  async submit(): Promise<void> {
    {
      const { error : submitError } = await this.baseOptions.elements.submit();

      if (submitError) {
        this.baseOptions.onError?.(submitError);
        return;
      }

      let { errors : processorError, sClientSecret : client_secret, paymentReference: paymentReference} = await fetch(`${this.baseOptions.processorUrl}/payments`,{
        method : "GET",
        headers : {
          "Content-Type": "application/json",
          "x-session-id" : this.baseOptions.sessionId
        }
      }).then(res => res.json())

      if ( processorError && !client_secret) {
        console.warn(`Error in processor: ${processorError}`);
        this.baseOptions.onError?.({message: processorError?.message})
        return
      }

      let { error, paymentIntent } = await this.baseOptions.sdk.confirmPayment({
        elements: this.baseOptions.elements,
        clientSecret: client_secret,
        confirmParams : {
          return_url : 'https://example.com'
        },
        redirect : "if_required"
      });

      if (error) {
        this.baseOptions.onError?.(error);
        return;
      }

      await fetch(`${this.baseOptions.processorUrl}/payments/${paymentIntent.id}`,{
        method : "GET",
        headers : {
          "Content-Type": "application/json",
          "x-session-id" : this.baseOptions.sessionId
        }
      }).then(res => res.json())

      this.baseOptions.onComplete?.({isSuccess:true, paymentReference: paymentReference});

    }

  }
}

