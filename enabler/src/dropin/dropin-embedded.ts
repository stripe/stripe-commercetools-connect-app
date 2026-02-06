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
import {ExpressCheckoutPartialAddress, ShippingRate} from "@stripe/stripe-js/dist/stripe-js/elements/express-checkout";
import {ShippingMethodsResponseSchemaDTO} from "../dtos/mock-payment.dto.ts";

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
      (this.paymentElement as StripeExpressCheckoutElement).on('shippingaddresschange', async (event) => {
        const resolve = event.resolve;
        const reject = event.reject;
        const address = event.address;
        try {
          const res = await this.getShippingMethods(address as ExpressCheckoutPartialAddress);

          await this.updateElementTotalAmount(res);

          resolve(res);
        } catch (error) {
          console.error("Error fetching shipping methods:", error);
          reject();
        }
      });

      (this.paymentElement as StripeExpressCheckoutElement).on('shippingratechange', async (event) => {
        const resolve = event.resolve;
        const reject = event.reject;
        const shippingRate = event.shippingRate;

        try {
          const response = await this.updateShippingRate(shippingRate);
          await this.updateElementTotalAmount(response);
          resolve({
            shippingRates: response.shippingRates,
            lineItems: response.lineItems
          });
        } catch (error) {
          console.error("Error fetching shipping methods:", error);
          reject();
        }
      });

      (this.paymentElement as StripeExpressCheckoutElement).on('cancel', async () => {

        try {
          const response = await this.removeShippingRate();
          if(this.baseOptions.paymentMode !== 'setup') {
            this.baseOptions.elements.update({amount: response});
          }

        } catch (error) {
          console.error("Error removing shipping rates:", error);
        }
      });

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

      switch (this.baseOptions.paymentMode) {
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
      this.baseOptions.onError?.(error);
    }
  }

  private async createPayment(): Promise<void> {
    const paymentRes = await this.api.getPayment(this.baseOptions.stripeConfig?.paymentIntent?.paymentMethodOptions);
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

  private async createSetupIntent(): Promise<void> {
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

    this.baseOptions.onComplete?.({
      isSuccess: true,
      paymentReference: subscription.paymentReference,
      paymentIntent: setupIntentId,
    });
  }

  private async createSubscription(): Promise<void> {
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

    this.baseOptions.onComplete?.({
      isSuccess: true,
      paymentReference,
      paymentIntent: paymentIntentId,
    });
  }

  async getShippingMethods(address: ExpressCheckoutPartialAddress): Promise<ShippingMethodsResponseSchemaDTO> {
    try {
      const response = await this.api.getShippingMethods(address);
      return response;
    } catch (error) {
      console.error("Error fetching shipping methods:", error);
      throw error;
    }
  }

  async updateShippingRate(shippingRate: ShippingRate): Promise<ShippingMethodsResponseSchemaDTO> {
    try {
      const response = await this.api.updateShippingRate(shippingRate)
      return response;
    } catch (error) {
      console.error("Error fetching shipping methods:", error);
      throw error;
    }
  }

  async updateElementTotalAmount(res: ShippingMethodsResponseSchemaDTO) {
    const totalAmount = res.lineItems.reduce((acc, item) => acc + item.amount, 0);
    if(this.baseOptions.paymentMode !== 'setup') {
      await this.baseOptions.elements.update({amount: totalAmount});
    }
  }

  async removeShippingRate(): Promise<number> {
    try {
      const response = await this.api.removeShippingRate();
      const totalAmount = response.lineItems.reduce((acc, item) => acc + item.amount, 0);
      return totalAmount;
    } catch (error) {
      console.error("Error removing shipping rates:", error);
      throw error;
    }
  }
}
