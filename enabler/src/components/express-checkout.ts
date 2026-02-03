import {
  ComponentOptions,
  PaymentComponent,
  PaymentComponentBuilder,
  PaymentMethod,
} from "../payment-enabler/payment-enabler";
import { BaseOptions } from "../payment-enabler/payment-enabler-mock";
import { StripeExpressCheckoutElement } from "@stripe/stripe-js";
import { apiService, ApiService } from "../services/api-service";
import { StripeService, stripeService } from "../services/stripe-service";
import { PaymentFlows } from "./payment-flows";
import { BaseComponent } from "./base";
import { ExpressCheckoutPartialAddress, ShippingRate } from "@stripe/stripe-js/dist/stripe-js/elements/express-checkout";
import { ShippingMethodsResponseSchemaDTO } from "../dtos/mock-payment.dto";

export class ExpressCheckoutBuilder implements PaymentComponentBuilder {
  public componentHasSubmit = false;
  private baseOptions: BaseOptions;

  constructor(baseOptions: BaseOptions) {
    this.baseOptions = baseOptions;
  }

  build(_config: ComponentOptions): PaymentComponent {
    const component = new ExpressCheckoutComponent(
      PaymentMethod.dropin,
      this.baseOptions,
      _config
    );
    return component;
  }
}

export class ExpressCheckoutComponent extends BaseComponent {
  private expressCheckoutElement: StripeExpressCheckoutElement;
  private api: ApiService;
  private stripe: StripeService;
  private paymentFlows: PaymentFlows;
  private baseOptions: BaseOptions;

  constructor(
    paymentMethod: PaymentMethod,
    baseOptions: BaseOptions,
    componentOptions: ComponentOptions
  ) {
    super(paymentMethod, baseOptions, componentOptions);
    this.baseOptions = baseOptions;
    this.expressCheckoutElement = baseOptions.paymentElement as StripeExpressCheckoutElement;
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
    this.expressCheckoutElement.mount(selector);

    this.expressCheckoutElement.on("shippingaddresschange", async (event) => {
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

    this.expressCheckoutElement.on("shippingratechange", async (event) => {
      const resolve = event.resolve;
      const reject = event.reject;
      const shippingRate = event.shippingRate;

      try {
        const response = await this.updateShippingRate(shippingRate);
        await this.updateElementTotalAmount(response);
        resolve({
          shippingRates: response.shippingRates,
          lineItems: response.lineItems,
        });
      } catch (error) {
        console.error("Error fetching shipping methods:", error);
        reject();
      }
    });

    this.expressCheckoutElement.on("cancel", async () => {
      try {
        const response = await this.removeShippingRate();
        if (this.baseOptions.paymentMode !== "setup") {
          this.baseOptions.elements.update({ amount: response });
        }
      } catch (error) {
        console.error("Error removing shipping rates:", error);
      }
    });

    this.expressCheckoutElement.on("confirm", async () => {
      await this.submit();
    });
  }

  async submit(): Promise<void> {
    await this.paymentFlows.submit();
  }

  private async getShippingMethods(
    address: ExpressCheckoutPartialAddress
  ): Promise<ShippingMethodsResponseSchemaDTO> {
    try {
      const response = await this.api.getShippingMethods(address);
      return response;
    } catch (error) {
      console.error("Error fetching shipping methods:", error);
      throw error;
    }
  }

  private async updateShippingRate(
    shippingRate: ShippingRate
  ): Promise<ShippingMethodsResponseSchemaDTO> {
    try {
      const response = await this.api.updateShippingRate(shippingRate);
      return response;
    } catch (error) {
      console.error("Error fetching shipping methods:", error);
      throw error;
    }
  }

  private async updateElementTotalAmount(res: ShippingMethodsResponseSchemaDTO): Promise<void> {
    const totalAmount = res.lineItems.reduce((acc, item) => acc + item.amount, 0);
    if (this.baseOptions.paymentMode !== "setup") {
      await this.baseOptions.elements.update({ amount: totalAmount });
    }
  }

  private async removeShippingRate(): Promise<number> {
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
