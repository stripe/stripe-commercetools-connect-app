
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

      let { errors : processorError, sClientSecret : client_secret, paymentReference: paymentReference } = await fetch(`${this.baseOptions.processorUrl}/payments`,{
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

      await fetch(`${this.baseOptions.processorUrl}/confirmPayments/${paymentReference}`,{
        method : "POST",
        headers : {
          "Content-Type": "application/json",
          "x-session-id" : this.baseOptions.sessionId
        }, body : JSON.stringify({paymentIntent:paymentIntent.id})
      }).then( (response) => {
        if(response.status === 200){
          this.baseOptions.onComplete?.({isSuccess:true, paymentReference: paymentReference})
        }else {
          this.baseOptions.onError?.("Error on /confirmPayments");

        }
      })
        .catch((error)=> {
          this.baseOptions.onError?.(error);
        });



    }

  }
}

