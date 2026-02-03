import { StripeElements } from "@stripe/stripe-js";
import { ApiService } from "../services/api-service";
import { StripeService } from "../services/stripe-service";
import { PaymentResult } from "../payment-enabler/payment-enabler";

export interface PaymentFlowsOptions {
  api: ApiService;
  stripe: StripeService;
  elements: StripeElements;
  paymentMode: "payment" | "subscription" | "setup";
  onComplete?: (result: PaymentResult) => void;
  onError?: (error?: any) => void;
}

export class PaymentFlows {
  private api: ApiService;
  private stripe: StripeService;
  private elements: StripeElements;
  private paymentMode: "payment" | "subscription" | "setup";
  private onComplete?: (result: PaymentResult) => void;
  private onError?: (error?: any) => void;

  constructor(options: PaymentFlowsOptions) {
    this.api = options.api;
    this.stripe = options.stripe;
    this.elements = options.elements;
    this.paymentMode = options.paymentMode;
    this.onComplete = options.onComplete;
    this.onError = options.onError;
  }

  async submit(): Promise<void> {
    try {
      const { error: submitError } = await this.elements.submit();

      if (submitError) {
        throw submitError;
      }

      switch (this.paymentMode) {
        case "payment":
          await this.createPayment();
          break;
        case "subscription":
          await this.createSubscription();
          break;
        case "setup":
          await this.createSetupIntent();
          break;
        default:
          throw new Error("Invalid payment mode");
      }
    } catch (error) {
      this.onError?.(error);
    }
  }

  async createPayment(): Promise<void> {
    const paymentRes = await this.api.getPayment();
    const paymentIntent = await this.stripe.confirmStripePayment(paymentRes);
    await this.api.confirmPaymentIntent({
      paymentIntentId: paymentIntent.id,
      paymentReference: paymentRes.paymentReference,
    });

    this.onComplete?.({
      isSuccess: true,
      paymentReference: paymentRes.paymentReference,
      paymentIntent: paymentIntent.id,
    });
  }

  async createSetupIntent(): Promise<void> {
    const { clientSecret, merchantReturnUrl, billingAddress } =
      await this.api.createSetupIntent();

    const { id: setupIntentId } = await this.stripe.confirmStripeSetupIntent({
      merchantReturnUrl,
      clientSecret,
      billingAddress,
    });

    const subscription = await this.api.createSubscriptionFromSetupIntent(
      setupIntentId
    );

    await this.api.confirmSubscriptionPayment({
      subscriptionId: subscription.subscriptionId,
      paymentReference: subscription.paymentReference,
    });

    this.onComplete?.({
      isSuccess: true,
      paymentReference: subscription.paymentReference,
      paymentIntent: setupIntentId,
    });
  }

  async createSubscription(): Promise<void> {
    const {
      cartId,
      clientSecret,
      billingAddress,
      merchantReturnUrl,
      paymentReference,
      subscriptionId,
    } = await this.api.createSubscription();

    const { id: paymentIntentId } = await this.stripe.confirmStripePayment({
      cartId,
      clientSecret,
      billingAddress,
      merchantReturnUrl,
      paymentReference,
    });

    await this.api.confirmSubscriptionPayment({
      subscriptionId,
      paymentReference,
      paymentIntentId,
    });

    this.onComplete?.({
      isSuccess: true,
      paymentReference,
      paymentIntent: paymentIntentId,
    });
  }
}
