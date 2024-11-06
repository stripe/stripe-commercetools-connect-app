
import {
  DropinComponent,
  DropinOptions,
  PaymentDropinBuilder,
} from "../payment-enabler/payment-enabler";
import { BaseOptions } from "../payment-enabler/payment-enabler-mock";
import { Stripe } from "@stripe/stripe-js";
import {PaymentElement} from "../components/payment-elements/payment-element.ts";
import {ExpressCheckout} from "../components/payment-elements/express-checkout.ts";

export class DropinEmbeddedBuilder implements PaymentDropinBuilder {
  public dropinHasSubmit = true;

  private baseOptions: BaseOptions;

  constructor(baseOptions: BaseOptions) {
    console.log("----------dropin-constructor-embedded START" + baseOptions.configuration.processorURL);
    this.baseOptions = baseOptions;
  }

  build(config: DropinOptions): DropinComponent {
    console.log('DropinOptions----dropin-embedded START');
    const dropin = new DropinComponents({
      stripe: this.baseOptions.stripeSDK,
      dropinOptions: config,
      elements: this.baseOptions.element
    });

    dropin.init();
    return dropin;
  }
}

export class DropinComponents implements DropinComponent {
  private stripe: Stripe | null;
  private elements: PaymentElement | ExpressCheckout | null;
  private dropinOptions: DropinOptions;


  constructor(opts: {
    stripe: Stripe | null,
    elements: PaymentElement | ExpressCheckout | null,
    dropinOptions: DropinOptions
  }) {
    console.log(`+++++++${JSON.stringify(opts, null, 2)}`)
    this.stripe = opts.stripe;
    this.elements = opts.elements;
    this.dropinOptions = opts.dropinOptions;

  }

  init(): void {
    this.overrideOnSubmit();
    this.dropinOptions.onDropinReady?.();
  }

  mount(selector: string) {
    if (this.elements) {
      this.elements.mount(selector);
    } else {
      console.error("Payment Element not initialized");
    }
  }

  async submit(): Promise<void> {
    console.log('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<< Dropin embedded submit')
    if (!this.stripe || !this.elements) {
      throw new Error("Stripe is not initialized or Payment Element is not available");
    }

    console.log('Stripe payment element is submiting')
  }

  private overrideOnSubmit() {
    console.log('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<< Dropin embedded overrideOnSubmit')
    console.log('Setting up overridden submit in DropinComponents');
    console.log(this.elements.submit)
    console.log('Setting up overridden submit in DropinComponents');
    const originalSubmit = this.elements.submit.bind(this.elements);


    this.elements.submit = async () => {
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
  }
}

