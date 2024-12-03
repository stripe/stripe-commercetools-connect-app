
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
    console.log('dropin ------------')
    console.log(JSON.stringify(dropin, null, 2))
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
    this.dropinOptions.showPayButton = true;
    this.paymentElement = this.baseOptions.paymentElement;

  }


  async mount(selector: string) {
    if (this.baseOptions.paymentElement) {
      this.paymentElement.mount(selector);
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

      let { error, paymentIntent } = await this.baseOptions.sdk.confirmPayment({
        elements: this.baseOptions.elements,
        clientSecret: client_secret,
        confirmParams : {
          return_url : 'https://www.google.com'//`${this.returnURL}`//TODO MVP review the retunr_url that need to be here.
        },
        redirect : "if_required"
      });

      if (error) {
        this.baseOptions.onError?.(error);
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
      this.baseOptions.onComplete?.({isSuccess:true, paymentReference: paymentReference});


      //TODO MVP remove if, only testing the redirect of submit.
      if(false){
        const redirectUrl = new URL('https://www.google.com')//this.baseOptions.returnURL)

        redirectUrl.searchParams.set("payment_intent", paymentIntent.id);
        redirectUrl.searchParams.set("payment_intent_client_secret", paymentIntent.client_secret);
        redirectUrl.searchParams.set("redirect_status", paymentIntent.status);

        window.location.href = redirectUrl.href;
      }

    }

  }
}

