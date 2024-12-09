
import {
  DropinComponent,
  DropinOptions,
  PaymentDropinBuilder,
} from "../payment-enabler/payment-enabler";
import { BaseOptions } from "../payment-enabler/payment-enabler-mock";
import {
  StripeExpressCheckoutElement,
  StripeExpressCheckoutElementConfirmEvent,
  StripePaymentElement
} from "@stripe/stripe-js";

export class DropinEmbeddedExpressBuilder implements PaymentDropinBuilder {
  public dropinHasSubmit = false; // refering to if checkout is going to call the submit func
  private baseOptions: BaseOptions;

  constructor(baseOptions: BaseOptions) {
    this.baseOptions = baseOptions;
  }

  build(config: DropinOptions): DropinComponent {
    const dropin = new DropinComponents({
      baseOptions: this.baseOptions,
      dropinOptions: config,
    });

    config.showPayButton = false;

    dropin.init();
    console.log('dropin ------------')
    console.log(JSON.stringify(dropin, null, 2))
    return dropin;
  }
}

export class DropinComponents implements DropinComponent {
  private baseOptions: BaseOptions;
  private paymentElement : StripeExpressCheckoutElement | StripePaymentElement;
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
      (this.paymentElement as StripeExpressCheckoutElement).mount(selector);

      (this.paymentElement as StripeExpressCheckoutElement).on("confirm", async (event : StripeExpressCheckoutElementConfirmEvent) => {
        console.log(`paymentElement expressChecokut event: ${event}`)
        await this.submit();
      })

    } else {
      console.error("Payment Element not initialized");
    }
  }

  async submit(): Promise<void> {
    {
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

      let { error } = await this.baseOptions.sdk.confirmPayment({
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
      this.baseOptions.onComplete?.({isSuccess:true, paymentReference: paymentReference});

    }

  }
}

