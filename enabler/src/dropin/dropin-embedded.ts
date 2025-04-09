import {
  DropinComponent,
  DropinOptions,
  PaymentDropinBuilder,
} from "../payment-enabler/payment-enabler";
import { BaseOptions } from "../payment-enabler/payment-enabler-mock";
import {
  StripeExpressCheckoutElement,
  StripePaymentElement,
} from "@stripe/stripe-js";
import { apiService, ApiService } from "../services/api-service";

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
  private paymentElement: StripeExpressCheckoutElement | StripePaymentElement;
  private dropinOptions: DropinOptions;
  private api: ApiService;

  constructor(opts: {
    baseOptions: BaseOptions;
    dropinOptions: DropinOptions;
  }) {
    this.baseOptions = opts.baseOptions;
    this.dropinOptions = opts.dropinOptions;
    this.api = apiService({
      baseApi: opts.baseOptions.processorUrl,
      sessionId: opts.baseOptions.sessionId,
      stripe: opts.baseOptions.sdk,
      elements: opts.baseOptions.elements,
    });
  }

  init(): void {
    this.dropinOptions.showPayButton = false;
    this.paymentElement = this.baseOptions.paymentElement;
  }

  async mount(selector: string) {
    if (this.baseOptions.paymentElementValue === "paymentElement") {
      this.paymentElement.mount(selector);
    } else {
      (this.paymentElement as StripeExpressCheckoutElement).mount(selector);
      (this.paymentElement as StripeExpressCheckoutElement).on(
        "confirm",
        async () => {
          await this.submit();
        }
      );
    }
  }

  async submit(): Promise<void> {
    try {
      const { error: submitError } = await this.baseOptions.elements.submit();

      if (submitError) {
        throw submitError;
      }

      const paymentRes = await this.api.getPayment(
        this.baseOptions.stripeCustomerId
      );
      const paymentIntent = await this.api.confirmStripePayment(paymentRes);
      await this.api.confirmPaymentIntent({
        paymentIntentId: paymentIntent.id,
        paymentReference: paymentRes.paymentReference,
      });

      this.baseOptions.onComplete?.({
        isSuccess: true,
        paymentReference: paymentRes.paymentReference,
        paymentIntent: paymentIntent.id,
      });
    } catch (error) {
      this.baseOptions.onError?.(error);
    }
  }
}
