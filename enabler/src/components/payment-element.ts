import {
  ComponentOptions,
  PaymentComponent,
  PaymentComponentBuilder,
  PaymentMethod,
} from "../payment-enabler/payment-enabler";
import { BaseOptions } from "../payment-enabler/payment-enabler-mock";
import { StripePaymentElement } from "@stripe/stripe-js";
import { apiService, ApiService } from "../services/api-service";
import { StripeService, stripeService } from "../services/stripe-service";
import { PaymentFlows } from "./payment-flows";
import { BaseComponent } from "./base";

export class PaymentElementBuilder implements PaymentComponentBuilder {
  public componentHasSubmit = true;
  private baseOptions: BaseOptions;

  constructor(baseOptions: BaseOptions) {
    this.baseOptions = baseOptions;
  }

  build(_config: ComponentOptions): PaymentComponent {
    const component = new PaymentElementComponent(
      PaymentMethod.card,
      this.baseOptions,
      _config
    );
    return component;
  }
}

export class PaymentElementComponent extends BaseComponent {
  private paymentElement: StripePaymentElement;
  private api: ApiService;
  private stripe: StripeService;
  private paymentFlows: PaymentFlows;

  constructor(
    paymentMethod: PaymentMethod,
    baseOptions: BaseOptions,
    componentOptions: ComponentOptions
  ) {
    super(paymentMethod, baseOptions, componentOptions);
    this.paymentElement = baseOptions.paymentElement as StripePaymentElement;
    this.api = apiService({
      baseApi: baseOptions.processorUrl,
      sessionId: baseOptions.sessionId,
    });
    this.stripe = stripeService({
      stripe: baseOptions.sdk,
      elements: baseOptions.elements,
    });
    this.paymentFlows = new PaymentFlows({
      api: this.api,
      stripe: this.stripe,
      elements: baseOptions.elements,
      paymentMode: baseOptions.paymentMode,
      onComplete: baseOptions.onComplete,
      onError: baseOptions.onError,
    });
  }

  mount(selector: string): void {
    this.paymentElement.mount(selector);
  }

  async submit(): Promise<void> {
    await this.paymentFlows.submit();
  }
}
