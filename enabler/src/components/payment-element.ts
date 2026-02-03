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
import { paypalService, PayPalService, PayPalConfig } from "../services/paypal-service";

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
  private paypalApi: PayPalService;
  private baseOptions: BaseOptions;
  private paypalMounted = false;

  constructor(
    paymentMethod: PaymentMethod,
    baseOptions: BaseOptions,
    componentOptions: ComponentOptions
  ) {
    super(paymentMethod, baseOptions, componentOptions);
    this.baseOptions = baseOptions;
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
    this.paypalApi = paypalService({
      baseApi: baseOptions.processorUrl,
      sessionId: baseOptions.sessionId,
    });
  }

  mount(selector: string): void {
    // Mount Stripe Payment Element
    this.paymentElement.mount(selector);

    // Mount PayPal button after Stripe element
    this.mountPayPalButton(selector);
  }

  private async mountPayPalButton(selector: string): Promise<void> {
    if (this.paypalMounted) {
      return;
    }

    try {
      // Get PayPal configuration from processor
      const config = await this.paypalApi.getConfig();

      // Skip if PayPal is not configured
      if (!config.clientId) {
        console.log("PayPal not configured, skipping PayPal button");
        return;
      }

      // Load PayPal SDK
      await this.paypalApi.loadPayPalSDK(
        config.clientId,
        config.currency,
        config.environment
      );

      if (!window.paypal) {
        console.error("PayPal SDK not loaded");
        return;
      }

      // Create PayPal container after the Stripe element
      const stripeElement = document.querySelector(selector);
      if (!stripeElement) {
        console.error("Stripe element container not found");
        return;
      }

      // Create PayPal container
      const paypalContainer = document.createElement("div");
      paypalContainer.id = "paypal-button-container";
      paypalContainer.style.marginTop = "16px";

      // Add separator
      const separator = document.createElement("div");
      separator.style.display = "flex";
      separator.style.alignItems = "center";
      separator.style.margin = "16px 0";
      separator.innerHTML = `
        <div style="flex: 1; height: 1px; background-color: #e0e0e0;"></div>
        <span style="padding: 0 16px; color: #666; font-size: 14px;">Or pay with</span>
        <div style="flex: 1; height: 1px; background-color: #e0e0e0;"></div>
      `;

      // Insert after Stripe element
      stripeElement.parentNode?.insertBefore(separator, stripeElement.nextSibling);
      separator.parentNode?.insertBefore(paypalContainer, separator.nextSibling);

      // Render PayPal button
      await this.renderPayPalButton(config, paypalContainer.id);

      this.paypalMounted = true;
    } catch (error) {
      console.error("Failed to mount PayPal button:", error);
    }
  }

  private async renderPayPalButton(config: PayPalConfig, containerId: string): Promise<void> {
    if (!window.paypal) {
      return;
    }

    const paypalApi = this.paypalApi;
    const onComplete = this.baseOptions.onComplete;
    const onError = this.baseOptions.onError;

    await window.paypal.Buttons({
      fundingSource: window.paypal.FUNDING.PAYPAL,
      style: {
        layout: 'horizontal',
        color: 'gold',
        shape: 'rect',
        label: 'paypal',
        height: 44,
      },
      // Client-side order creation using PayPal SDK actions
      createOrder: async (_data, actions) => {
        try {
          // Convert cents to dollars for PayPal (expects decimal format)
          const totalValue = (config.amount / 100).toFixed(2);

          if (parseFloat(totalValue) <= 0) {
            console.error("Cart total is zero or negative, cannot create PayPal order");
            throw new Error("Cart total must be greater than zero");
          }

          // Create order using PayPal SDK actions (client-side)
          return await actions.order.create({
            intent: 'CAPTURE',
            purchase_units: [
              {
                reference_id: 'ORDER',
                description: 'Order Payment',
                amount: {
                  currency_code: config.currency,
                  value: totalValue,
                },
              },
            ],
          });
        } catch (error) {
          console.error("Error creating PayPal order:", error);
          onError(error);
          throw error;
        }
      },
      // Client-side order capture, then notify backend
      onApprove: async (data, actions) => {
        try {
          // Capture the order using PayPal SDK actions (client-side)
          const captureDetails = await actions.order.capture();

          console.log("PayPal order captured:", captureDetails);

          // Notify the processor backend to create payment record
          const result = await paypalApi.captureOrder(data.orderID);

          onComplete({
            isSuccess: true,
            paymentReference: result.paymentReference || result.orderId,
            paymentIntent: data.orderID,
          });
        } catch (error) {
          console.error("Error capturing PayPal order:", error);
          onError(error);
        }
      },
      onError: (err: Error) => {
        console.error("PayPal error:", err);
        onError(err);
      },
      onCancel: () => {
        console.log("PayPal payment cancelled by user");
      },
    }).render(`#${containerId}`);
  }

  async submit(): Promise<void> {
    await this.paymentFlows.submit();
  }
}
