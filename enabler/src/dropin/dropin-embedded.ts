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
import { StripeService, stripeService } from "../services/stripe-service";
import { SubscriptionResponseSchemaDTO } from "../dtos/mock-payment.dto";

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
  private stripe: StripeService;

  constructor(opts: {
    baseOptions: BaseOptions;
    dropinOptions: DropinOptions;
  }) {
    this.baseOptions = opts.baseOptions;
    this.dropinOptions = opts.dropinOptions;
    this.api = apiService({
      baseApi: opts.baseOptions.processorUrl,
      sessionId: opts.baseOptions.sessionId,
    });
    this.stripe = stripeService({
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

      if (this.baseOptions.isSubscription) {
        await this.createSubscription();
      } else {
        await this.createPayment();
      }
    } catch (error) {
      this.baseOptions.onError?.(error);
    }
  }

  private async createPayment(): Promise<void> {
    const paymentRes = await this.api.getPayment();
    const paymentIntent = await this.stripe.confirmStripePayment(paymentRes);
    await this.api.confirmPaymentIntent({
      paymentIntentId: paymentIntent.id,
      paymentReference: paymentRes.paymentReference,
    });

    this.baseOptions.onComplete?.({
      isSuccess: true,
      paymentReference: paymentRes.paymentReference,
      paymentIntent: paymentIntent.id,
    });
  }

  private async createSubscription(): Promise<void> {
    const res = await this.api.createSubscription();

    if (res.subscriptionId && res.paymentReference) {
      await this.confirmSubscriptionPayment(res);
    } else {
      await this.createSubscriptionWithSetupIntent(res);
    }
  }

  private async confirmSubscriptionPayment(
    payment: SubscriptionResponseSchemaDTO
  ): Promise<void> {
    const paymentIntent = await this.stripe.confirmStripePayment(payment);

    await this.api.confirmSubscriptionPayment({
      subscriptionId: payment.subscriptionId,
      paymentReference: payment.paymentReference,
      paymentIntentId: paymentIntent.id,
    });

    this.baseOptions.onComplete?.({
      isSuccess: true,
      paymentReference: payment.paymentReference,
      paymentIntent: paymentIntent.id,
    });
  }

  private async createSubscriptionWithSetupIntent({
    clientSecret,
    merchantReturnUrl,
    billingAddress,
  }: SubscriptionResponseSchemaDTO): Promise<void> {
    const { id: setupIntentId } = await this.stripe.confirmStripeSetupIntent({
      returnUrl: merchantReturnUrl,
      clientSecret,
      billingAddress,
    });

    const subscription = await this.api.createSubscriptionFromSetupIntent(setupIntentId);

    await this.api.confirmSubscriptionPayment({
      subscriptionId: subscription.subscriptionId,
      paymentReference: subscription.paymentReference,
    });

    this.baseOptions.onComplete?.({
      isSuccess: true,
      paymentReference: subscription.paymentReference,
      paymentIntent: setupIntentId,
    });
  }
}
