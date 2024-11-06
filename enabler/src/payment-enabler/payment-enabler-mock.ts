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
import {PaymentElement} from "../components/payment-elements/payment-element.ts";
import {ExpressCheckout} from "../components/payment-elements/express-checkout.ts";
import {
  BaseConfiguration,
  StripeElementConfiguration
} from "../components/base-configuration.ts";



declare global {
  interface ImportMeta {
    // @ts-ignore
    env: any;
  }
}

export type ConfigElementResponse = {
  cartInfo: {
    amount: number,
    currency: string,
  },
  appearance?: string,
  captureMethod : "manual" | "automatic"
};

export type BaseOptions = {
  stripeSDK: Stripe;
  elementsSDK? : StripeElementConfiguration
  element : PaymentElement | ExpressCheckout
  configuration: BaseConfiguration
};

type StripeEnablerOptions = EnablerOptions & {
  onActionRequired?: (action: any) => Promise<void>;
  stripeElement: StripeElementType
};

export type StripeElementType = {
  type : string
  options : StripeExpressCheckoutElementOptions | StripePaymentElementOptions,
  onComplete : (result: PaymentResult) => void;
  onError: (error: any) => void;
}

export enum StripeElementTypes {
  payment = "payment",
  expressCheckout = "expressCheckout",
  subscription = "subscription",
}
type StripeElementParams = {
  stripeElement: StripeElementType;
  elements: StripeElements;
  stripeSDK: Stripe;
  configuration: BaseConfiguration;
};
export class MockPaymentEnabler implements PaymentEnabler {
  setupData: Promise<{ baseOptions: BaseOptions }>;

  constructor(options: StripeEnablerOptions) {
    this.setupData = MockPaymentEnabler._Setup(options);
    //this.elementsConfiguration
  }

  private static _Setup = async (
    options: StripeEnablerOptions
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
    const [configElementJson, configEnvJson] = await Promise.all([configElementResponse.json(), configEnvResponse.json()]);

    // Fetch SDK config from processor if needed, for example:
    // const configResponse = await fetch(instance.processorUrl + '/config', {
    //   method: 'GET',
    //   headers: { 'Content-Type': 'application/json', 'X-Session-Id': options.sessionId },

    // });
    // const configJson = awai  t configResponse.json();

    const stripeSDK = await MockPaymentEnabler.getStripeSDK(configEnvJson);

    const configuration: BaseConfiguration = MockPaymentEnabler.getConfiguration(configEnvJson, options)


    const stripeElementParams: StripeElementParams = {
      stripeElement: MockPaymentEnabler.getStripeElementType(options),
      elements: MockPaymentEnabler.getElements(stripeSDK, configElementJson),
      stripeSDK,
      configuration
    }


    return {
      baseOptions: {
        stripeSDK,
        element : await MockPaymentEnabler.getStripeElement(stripeElementParams),
        configuration
      },
    };

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

  private static getStripeElementType(options: StripeEnablerOptions): StripeElementType {
    return {
      type: 'payment',
      options: {},
      onComplete: options.onComplete,
      onError: options.onError,
    };
  }

  private static async getStripeElement( stripeElementParams :StripeElementParams):
    Promise<PaymentElement | ExpressCheckout> {
    const {stripeElement, elements, stripeSDK, configuration} = stripeElementParams
    switch(stripeElement.type) {
      case (StripeElementTypes.payment || StripeElementTypes.subscription) : {
        /**
         const element = elements.create('expressCheckout', stripeElement.options as StripeExpressCheckoutElementOptions);
         return new ExpressCheckout({
         element,
         stripeSDK,
         elementsSDK : elements,
         clientSecret : clientSecret,
         onComplete : stripeElement.onComplete,
         onError : stripeElement.onError,
         ...configuration
         });
         **/
        console.log('|||||||||||||||||||||||||||||||||||||||||||')

        const element = elements.create('payment', stripeElement.options as StripePaymentElementOptions);
        return new PaymentElement({
          element,
          stripeSDK,
          elementsSDK : elements,
          onComplete : stripeElement.onComplete,
          onError : stripeElement.onError,
          ...configuration
        });

      }
      case StripeElementTypes.expressCheckout : {
        const element = elements.create(stripeElement.type, stripeElement.options as StripeExpressCheckoutElementOptions);
        return new ExpressCheckout({
          element,
          stripeSDK,
          elementsSDK : elements,
          onComplete : stripeElement.onComplete,
          onError : stripeElement.onError,
          ...configuration
        });
      }
    }
  }
}
