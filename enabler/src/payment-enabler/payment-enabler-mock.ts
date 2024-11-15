import {
  DropinType, EnablerOptions,
  PaymentComponentBuilder,
  PaymentDropinBuilder,
  PaymentEnabler, PaymentResult,
} from "./payment-enabler";
import { DropinEmbeddedBuilder } from "../dropin/dropin-embedded";
import {
  loadStripe,
  Stripe,
  StripeElements,
  StripeExpressCheckoutElementOptions,
  StripePaymentElementOptions
} from "@stripe/stripe-js";
import {
  BaseConfiguration,
} from "../components/base-configuration.ts";
import {StripePaymentElement} from "@stripe/stripe-js/dist/stripe-js/elements/index";


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
  paymentElement: StripePaymentElement;
  elements: StripeElements;
};



export type StripeElementType = {
  type : string
  options : StripeExpressCheckoutElementOptions | StripePaymentElementOptions,
  onComplete : (result: PaymentResult) => void;
  onError: (error: any) => void;
}

export enum StripeElementTypes {
  payment = "payment",
}

type StripeElementParams = {
  stripeElement: StripeElementType;
  elements: StripeElements;
  stripeSDK: Stripe;
  configuration: BaseConfiguration;
};

export class MockPaymentEnabler implements PaymentEnabler {
  setupData: Promise<{ baseOptions: BaseOptions }>;

  constructor(options: EnablerOptions) {
    this.setupData = MockPaymentEnabler._Setup(options);
  }

  private static _Setup = async (
    options: EnablerOptions
  ): Promise<{ baseOptions: BaseOptions }> => {

    //TODO: Dynamic value or all configurations for all elements
    const testingElementConfiguration = 'payment'//options.stripeElement.type.toLowerCase().toString()
    const [configElementResponse, configEnvResponse] = await Promise.all([
      fetch(options.processorUrl + `/get-config-element/${testingElementConfiguration}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Id": options.sessionId,
        },
      }),
      fetch(options.processorUrl + "/operations/config", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Id": options.sessionId,
        },
      }),
    ]);
    //const [configElementJson, configEnvJson] = await Promise.all([configElementResponse.json(), configEnvResponse.json()]);
    const [configElementJson, configEnvJson] = await Promise.all([configElementResponse.json(), configEnvResponse.json()]);

    const stripeSDK = await MockPaymentEnabler.getStripeSDK(configEnvJson);

    const configuration: BaseConfiguration = MockPaymentEnabler.getConfiguration(configEnvJson, options)

    console.log(configElementJson)
    const stripeElementParams: StripeElementParams = {
      stripeElement: MockPaymentEnabler.getStripeElementType(options),
      elements: MockPaymentEnabler.getElements(stripeSDK, configElementJson),
      stripeSDK,
      configuration
    }

    const elements= await MockPaymentEnabler.getElements(stripeSDK, configElementJson)

    const elementsOptions = {
      type: 'payment',
      options: {},
      onComplete: options.onComplete,
      onError: options.onError,
      //terms: {objet never}, //TODO review if need it
      layout: {
        type: 'tabs',
        defaultCollapsed: false,
      }
    }


    console.log(stripeElementParams)

    return Promise.resolve({
      baseOptions: {
        sdk: stripeSDK,
        environment: configuration.environment,
        processorUrl: configuration.processorURL,
        sessionId: configuration.sessionId,
        onComplete: options.onComplete || (() => {}),
        onError: options.onError || (() => {}),
        paymentElement: elements.create('payment', elementsOptions as StripePaymentElementOptions ),
        elements: elements,
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
    console.log('JSON.stringify(setupData.baseOptions, null, 2)');
    console.log(JSON.stringify(setupData.baseOptions, null, 2));
    console.log('JSON.stringify(setupData.baseOptions, null, 2)');
    return new supportedMethods[type](setupData.baseOptions);
  }

  private static async getStripeSDK(configEnvJson): Promise<Stripe | null> {
    try {
      const sdk = await loadStripe(configEnvJson.publishableKey);
      if (!sdk) throw new Error("Failed to load Stripe SDK.");
      return sdk;
    } catch (error) {
      console.error("Error loading Stripe SDK:", error);
      return null; // or handle based on your requirements
    }
  }

  private static getElements(stripeSDK: Stripe | null, configElementJson): StripeElements | null {
    if (!stripeSDK) return null;
    try {
      return stripeSDK.elements?.({
        mode: 'payment',
        amount: configElementJson.cartInfo.amount,
        currency: configElementJson.cartInfo.currency.toLowerCase(),
        appearance: JSON.parse(configElementJson.appearance || "{}"),
        capture_method: configElementJson.captureMethod,
      });
    } catch (error) {
      console.error("Error initializing elements:", error);
      return null;
    }
  }

  private static getConfiguration(configEnvJson, options): BaseConfiguration {
    const environment = configEnvJson.publishableKey.includes("_test_") ? "test" : configEnvJson.environment;
    return {
      environment,
      processorURL: options.processorUrl,
      returnURL: configEnvJson.returnURL,
      sessionId: options.sessionId,
      locale: configEnvJson.locale,
      publishableKey: configEnvJson.publishableKey,
    };
  }

  private static getStripeElementType(options: EnablerOptions): StripeElementType {
    return {
      type: 'payment',
      options: {},
      onComplete: options.onComplete,
      onError: options.onError,
    };
  }

  /**private static async getStripeElement( stripeElementParams :StripeElementParams):
    Promise<PaymentElement> {
    const {stripeElement, elements, stripeSDK, configuration} = stripeElementParams
      const element = elements.create('payment', stripeElement.options as StripePaymentElementOptions);
      return new PaymentElement({
        element,
        stripeSDK,
        paymentElement : elements,
        onComplete : stripeElement.onComplete,
        onError : stripeElement.onError,
        ...configuration
      });

    }**/
}
