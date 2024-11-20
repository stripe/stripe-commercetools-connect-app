
import {
  DropinComponent,
  DropinOptions,
  PaymentDropinBuilder,
} from "../payment-enabler/payment-enabler";
import { BaseOptions } from "../payment-enabler/payment-enabler-mock";
import { StripePaymentElement} from "@stripe/stripe-js";

export class DropinEmbeddedBuilder implements PaymentDropinBuilder {
  public dropinHasSubmit = true;


  private baseOptions: BaseOptions;

  constructor(baseOptions: BaseOptions) {
    console.log("----------dropin-constructor-embedded START");
    this.baseOptions = baseOptions;
  }

  build(config: DropinOptions): DropinComponent {
    console.log('DropinOptions----dropin-embedded START');
    console.log('Dropin Options---dropin-embedded START');
    console.log(JSON.stringify(config, null, 2));
    console.log('Dropin Options---dropin-embedded START');
    config.showPayButton = true; // dropinHasSubmit
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
  private dropinOptions: DropinOptions;
  private paymentElement : StripePaymentElement;


  constructor(opts: {
    baseOptions : BaseOptions,
    dropinOptions: DropinOptions
  }) {
    console.log(`+++++++${JSON.stringify(opts, null, 2)}`)
    this.baseOptions = opts.baseOptions;
    this.dropinOptions = opts.dropinOptions;
  }

  init(): void {
    this.paymentElement = this.baseOptions.paymentElement;
    //this.overrideOnSubmit();
    this.dropinOptions.showPayButton = true;

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
    this.dropinOptions.onPayButtonClick = async () => {
      console.log("Pay button clicked");
      this.submit().catch((error) => {
        console.error("Error during payment submission:", error);
      });
    };

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
      this.dropinOptions
        .onDropinReady()
        .then(() => {})
        .catch((error) => console.error(error));

    } else {
      console.error("Payment Element not initialized");
    }
  }

  async submit(): Promise<void> {
    console.log('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<< Dropin embedded submit')
    {
      console.log('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<< Payment element submit')
      const { error : submitError } = await this.baseOptions.elements.submit();

      if (submitError) {
        console.log('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<< Payment submitError')
        this.baseOptions.onError?.(submitError);

        return;
      }

      //MVP if additional information needs to be included in the payment intent, this method should be supplied with the necessary data.
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
      console.log('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<< Payment data')
      console.log(`<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<< ${client_secret}`)

      let { error, paymentIntent } = await this.baseOptions.sdk.confirmPayment({
        elements: this.baseOptions.elements,
        clientSecret: client_secret,
        confirmParams : {
          return_url : 'https://www.google.com'//`${this.returnURL}`//TODO review the retunr_url that need to be here.
        },
        redirect : "if_required"
      });

      if (error) {
        console.log('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<< Payment confir error')
        console.log(`<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<< ${error}`)
        this.baseOptions.onError?.(error);

        return;
      }
      console.log('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<< Payment intent id')
      console.log(`<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<< ${JSON.stringify(paymentIntent,null,2)}`)
      //TODO e.g. if (data.resultCode === "Authorised" || data.resultCode === "Pending") {
      //               component.setStatus("success");
      //               options.onComplete && options.onComplete({ isSuccess: true, paymentReference });
      //             } else {
      //               options.onComplete && options.onComplete({ isSuccess: false });
      //               component.setStatus("error");
      //             }
      //TODO review what is what we need to return if beacuse paymentIntent.status can be different
      this.baseOptions.onComplete?.({isSuccess:true, paymentReference: paymentReference});


      //TODO remove if, only testing the redirect of submit.
      if(false){
        const redirectUrl = new URL('https://www.google.com')//this.baseOptions.returnURL)

        redirectUrl.searchParams.set("payment_intent", paymentIntent.id);
        redirectUrl.searchParams.set("payment_intent_client_secret", paymentIntent.client_secret);
        redirectUrl.searchParams.set("redirect_status", paymentIntent.status);

        window.location.href = redirectUrl.href;
      }

    }

  }

  /**private overrideOnSubmit() {
    console.log('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<< Dropin embedded overrideOnSubmit')
    console.log('Setting up overridden submit in DropinComponents');
    console.log(this.paymentElement.submit)
    console.log('Setting up overridden submit in DropinComponents');
    const originalSubmit = this.paymentElement.submit.bind(this.paymentElement);


    this.paymentElement.submit = async () => {
      console.log("Custom logic before actual submit");
      console.log(originalSubmit);  // This will now reference the actual original submit function

      // @ts-ignore
      const termsChecked = document.getElementById("termsCheckbox")?.checked;
      if (!termsChecked) {
        alert("You must agree to the terms and conditions.");
        return;
      }

      await originalSubmit();  // Call the actual original submit function
    };
  }**/
}

