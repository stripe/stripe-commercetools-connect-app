import {
  DropinType, EnablerOptions,
  PaymentComponentBuilder,
  PaymentDropinBuilder,
  PaymentEnabler, PaymentResult,
} from "./payment-enabler";
import { DropinEmbeddedBuilder } from "../dropin/dropin-embedded";
import {
  Appearance,
  LayoutObject,
  loadStripe,
  Stripe,
  StripeElements,
  StripeExpressCheckoutElement,
  StripeExpressCheckoutElementOptions,
  StripePaymentElementOptions,
} from "@stripe/stripe-js";
import {StripePaymentElement} from "@stripe/stripe-js";
import {ConfigElementResponseSchemaDTO, ConfigResponseSchemaDTO} from "../dtos/mock-payment.dto.ts";


declare global {
  interface ImportMeta {
    // @ts-ignore
    env: any;
  }
}

export type BaseOptions = {
  sdk: Stripe;
  environment: string;
  processorUrl: string;
  sessionId: string;
  locale?: string;
  onComplete: (result: PaymentResult) => void;
  onError: (error?: any) => void;
  paymentElement: StripePaymentElement | StripeExpressCheckoutElement; // MVP https://docs.stripe.com/payments/payment-element | https://docs.stripe.com/elements/express-checkout-element
  paymentElementValue: 'paymentElement' | 'expressCheckout';
  elements: StripeElements; // MVP https://docs.stripe.com/js/elements_object
};

interface ElementsOptions {
  type: string;
  options: Record<string, any>;
  onComplete: (result: PaymentResult) => void;
  onError: (error?: any) => void;
  layout: LayoutObject;
  appearance: Appearance;
} 

export class MockPaymentEnabler implements PaymentEnabler {
  setupData: Promise<{ baseOptions: BaseOptions }>;

  constructor(options: EnablerOptions) {
    this.setupData = MockPaymentEnabler._Setup(options);
  }

  private static _Setup = async (
    options: EnablerOptions
  ): Promise<{ baseOptions: BaseOptions }> => {


    const [cartInfoResponse, configEnvResponse]: [ConfigElementResponseSchemaDTO, ConfigResponseSchemaDTO]
      = await MockPaymentEnabler.fetchConfigData(options);
    const stripeSDK = await MockPaymentEnabler.getStripeSDK(configEnvResponse);

    const elements= MockPaymentEnabler.getElements(stripeSDK, cartInfoResponse);
    const elementsOptions = MockPaymentEnabler.getElementsOptions(options, cartInfoResponse);

    return Promise.resolve({
      baseOptions: {
        sdk: stripeSDK,
        environment: configEnvResponse.publishableKey.includes("_test_") ? "test" : configEnvResponse.environment, // MVP do we get this from the env of processor? or we leave the responsability to the publishableKey from Stripe?
        processorUrl: options.processorUrl,
        sessionId: options.sessionId,
        onComplete: options.onComplete || (() => {}),
        onError: options.onError || (() => {}),
        paymentElement: MockPaymentEnabler.getPaymentElement(elementsOptions, options.paymentElementType, elements),
        paymentElementValue: cartInfoResponse.webElements,
        elements: elements
      },
    });
  };

  async createComponentBuilder(
    type: string
  ): Promise<PaymentComponentBuilder | never> {
    const { baseOptions } = await this.setupData;

    const supportedMethods = {
    };

    if (!Object.keys(supportedMethods).includes(type)) {
      throw new Error(
        `Component type not supported: ${type}. Supported types: ${Object.keys(
          supportedMethods
        ).join(", ")}`
      );
    }

    return new supportedMethods[type](baseOptions);
  }

  async createDropinBuilder(
    type: DropinType
  ): Promise<PaymentDropinBuilder | never> {

    const setupData= await this.setupData;
    if (!setupData) {
      throw new Error("StripePaymentEnabler not initialized");
    }
    const supportedMethods = {
      embedded: DropinEmbeddedBuilder,
      // hpp: DropinHppBuilder,
    };

    if (!Object.keys(supportedMethods).includes(type)) {
      throw new Error(
        `Component type not supported: ${type}. Supported types: ${Object.keys(
          supportedMethods
        ).join(", ")}`
      );
    }
    return new supportedMethods[type](setupData.baseOptions);
  }

  private static async getStripeSDK(configEnvResponse: ConfigResponseSchemaDTO): Promise<Stripe | null> {
    try {
      const sdk = await loadStripe(configEnvResponse.publishableKey);
      if (!sdk) throw new Error("Failed to load Stripe SDK.");
      return sdk;
    } catch (error) {
      console.error("Error loading Stripe SDK:", error);
      throw error; // or handle based on your requirements
    }
  }

  private static getElements(
    stripeSDK: Stripe | null,
    cartInfoResponse: ConfigElementResponseSchemaDTO
  ): StripeElements | null {
    if (!stripeSDK) return null;
    try {
      return stripeSDK.elements?.({
        mode: 'payment',
        amount: cartInfoResponse.cartInfo.amount,
        currency: cartInfoResponse.cartInfo.currency.toLowerCase(),
        appearance: JSON.parse(cartInfoResponse.appearance || "{}"),
        capture_method: cartInfoResponse.captureMethod,
      });
    } catch (error) {
      console.error("Error initializing elements:", error);
      return null;
    }
  }


  private static async fetchConfigData(
    options: EnablerOptions
  ): Promise<[ConfigElementResponseSchemaDTO, ConfigResponseSchemaDTO]> {
    const headers = MockPaymentEnabler.getFetchHeader(options);

    const [configElementResponse, configEnvResponse] = await Promise.all([
      fetch(`${options.processorUrl}/config-element/${options.paymentElementType}`, headers), // MVP this could be used by expressCheckout and Subscription
      fetch(`${options.processorUrl}/operations/config`, headers),
    ]);

    return Promise.all([configElementResponse.json(), configEnvResponse.json()]);
  }

  private static getFetchHeader(options: EnablerOptions): {method: string, headers: {[key: string]: string}} {
    return {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": options.sessionId,
      },
    }
  }

  private static getElementsOptions(
    options: EnablerOptions,
    config: ConfigElementResponseSchemaDTO
  ): ElementsOptions {
    const { appearance, layout } = config;

    return {
      type: 'payment',
      options: {},
      onComplete: options.onComplete,
      onError: options.onError,
      layout: this.getLayoutObject(layout),
      appearance: JSON.parse(appearance || '{}'),
    }
  }

  private static getPaymentElement(
    elementsOptions: ElementsOptions,
    paymentElementType: string,
    elements: StripeElements
  ): StripePaymentElement | StripeExpressCheckoutElement {
    if(paymentElementType === 'expressCheckout'){
      return elements.create('expressCheckout', elementsOptions as StripeExpressCheckoutElementOptions);
    } else {
      return elements.create('payment', elementsOptions as StripePaymentElementOptions)
    }
  }

  private static getLayoutObject(layout: string): LayoutObject {
    const defaultLayout: LayoutObject = {
      type: 'tabs',
      defaultCollapsed: false,
    };
    
    if (layout) {
      const parsedObject = JSON.parse(layout);
      const isValid = this.validateLayoutObject(parsedObject);
      if (isValid) {
        return parsedObject;
      }
    }
    return defaultLayout;
  }

  private static validateLayoutObject(layout: LayoutObject): boolean {
    if (!layout) return false;
    const validLayouts = ['tabs', 'accordion', 'auto'];
    return validLayouts.includes(layout.type);
  }
}

