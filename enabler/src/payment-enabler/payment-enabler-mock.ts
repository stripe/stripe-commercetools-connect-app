import {
  DropinType,
  EnablerOptions,
  PaymentComponentBuilder,
  PaymentDropinBuilder,
  PaymentEnabler,
  PaymentResult,
} from "./payment-enabler";
import {DropinEmbeddedBuilder} from "../dropin/dropin-embedded";
import {
  Appearance,
  LayoutObject,
  loadStripe,
  Stripe,
  StripeElements,
  StripeElementsOptionsMode,
  StripeExpressCheckoutElement,
  StripeExpressCheckoutElementOptions,
  StripePaymentElement,
  StripePaymentElementOptions,
} from "@stripe/stripe-js";
import {
  ConfigElementResponseSchemaDTO,
  ConfigResponseSchemaDTO,
  CustomerResponseSchemaDTO,
} from "../dtos/mock-payment.dto.ts";
import { parseJSON } from "../utils/index.ts";
import { apiService } from "../services/api-service.ts";

declare global {
  interface ImportMeta {
    // @ts-ignore
    env: any;
  }
}

export interface BaseOptions {
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
  paymentMode: StripeElementsOptionsMode['mode']
  stripeCustomerId?: string;
}

interface ElementsOptions {
  type: string;
  options: Record<string, any>;
  onComplete: (result: PaymentResult) => void;
  onError: (error?: any) => void;
  layout: LayoutObject;
  appearance: Appearance;
  fields: {
    billingDetails: {
      address: string;
    };
  };
  billingAddressRequired: boolean;
  shippingAddressRequired: boolean;
}

export class MockPaymentEnabler implements PaymentEnabler {
  setupData: Promise<{ baseOptions: BaseOptions }>;

  constructor(options: EnablerOptions) {
    this.setupData = MockPaymentEnabler._Setup(options);
  }

  private static _Setup = async (
    options: EnablerOptions
  ): Promise<{ baseOptions: BaseOptions }> => {
    const { getCustomerOptions, getConfigData } = apiService({
      baseApi: options.processorUrl,
      sessionId: options.sessionId,
    });
    
    const [cartInfoResponse, configEnvResponse] = await getConfigData(options.paymentElementType);
    const customer = await getCustomerOptions();
    const stripeSDK = await MockPaymentEnabler.getStripeSDK(configEnvResponse);
    const elements = MockPaymentEnabler.getElements(stripeSDK, cartInfoResponse, customer);
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
        elements: elements,
        paymentMode: cartInfoResponse.paymentMode,
        stripeCustomerId: customer ? customer?.stripeCustomerId : undefined,
      },
    });
  };

  async createComponentBuilder(
    type: string
  ): Promise<PaymentComponentBuilder | never> {
    const { baseOptions } = await this.setupData;
    const supportedMethods = {};

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
    const setupData = await this.setupData;
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
    cartInfoResponse: ConfigElementResponseSchemaDTO,
    customer?: CustomerResponseSchemaDTO
  ): StripeElements | null {
    if (!stripeSDK) return null;
    try {
      const {
        cartInfo,
        captureMethod,
        appearance,
        setupFutureUsage,
        paymentMode,
      } = cartInfoResponse;
      return stripeSDK.elements?.({
        mode: paymentMode,
        amount: paymentMode !== "setup" ? cartInfo.amount : undefined,
        currency: cartInfo.currency.toLowerCase(),
        appearance: parseJSON(appearance),
        captureMethod,
        ...(customer && {
          customerOptions: {
            customer: customer.stripeCustomerId,
            ephemeralKey: customer.ephemeralKey,
          },
          setupFutureUsage,
          customerSessionClientSecret: customer.sessionId,
        }),
      });
    } catch (error) {
      console.error("Error initializing elements:", error);
      return null;
    }
  }

  private static getElementsOptions(
    options: EnablerOptions,
    config: ConfigElementResponseSchemaDTO
  ): ElementsOptions {
    const { appearance, layout, collectBillingAddress } = config;
    return {
      type: 'payment',
      options: {},
      onComplete: options.onComplete,
      onError: options.onError,
      layout: this.getLayoutObject(layout),
      appearance: parseJSON(appearance),
      ...(collectBillingAddress !== 'auto' && {
        fields: {
          billingDetails: {
            address: collectBillingAddress,
          }
        }
      }),
      billingAddressRequired: true, // Used for express checkout, this will be updated in the future to be more dynamic
      shippingAddressRequired: true, // Used for express checkout, this will be updated in the future to be more dynamic
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
    if (layout) {
      const parsedObject = parseJSON<LayoutObject>(layout);
      const isValid = this.validateLayoutObject(parsedObject);
      if (isValid) {
        return parsedObject;
      }
    }

    return {
      type: 'tabs',
      defaultCollapsed: false,
    };
  }

  private static validateLayoutObject(layout: LayoutObject): boolean {
    if (!layout) return false;
    const validLayouts = ['tabs', 'accordion', 'auto'];
    return validLayouts.includes(layout.type);
  }
}
