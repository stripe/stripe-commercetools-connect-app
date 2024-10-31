import { CardBuilder } from "../components/payment-methods/card/card";
import { InvoiceBuilder } from "../components/payment-methods/invoice/invoice";
import { PurchaseOrderBuilder } from "../components/payment-methods/purchase-order/purchase-order";
import { FakeSdk } from "../fake-sdk";
import {
  DropinType,
  EnablerOptions,
  PaymentComponentBuilder,
  PaymentDropinBuilder,
  PaymentEnabler,
  PaymentResult,
} from "./payment-enabler";
import { DropinEmbeddedBuilder } from "../dropin/dropin-embedded";

declare global {
  interface ImportMeta {
    env: any;
  }
}

export type BaseOptions = {
  sdk: FakeSdk;
  processorUrl: string;
  sessionId: string;
  environment: string;
  locale?: string;
  onComplete: (result: PaymentResult) => void;
  onError: (error?: any) => void;
};

export class MockPaymentEnabler implements PaymentEnabler {
  setupData: Promise<{ baseOptions: BaseOptions }>;

  constructor(options: EnablerOptions) {
    this.setupData = MockPaymentEnabler._Setup(options);
  }

  private static _Setup = async (
    options: EnablerOptions
  ): Promise<{ baseOptions: BaseOptions }> => {
    // Fetch SDK config from processor if needed, for example:

    // const configResponse = await fetch(instance.processorUrl + '/config', {
    //   method: 'GET',
    //   headers: { 'Content-Type': 'application/json', 'X-Session-Id': options.sessionId },
    // });

    // const configJson = await configResponse.json();

    const sdkOptions = {
      // environment: configJson.environment,
      environment: "test",
    };

    return Promise.resolve({
      baseOptions: {
        sdk: new FakeSdk(sdkOptions),
        processorUrl: options.processorUrl,
        sessionId: options.sessionId,
        environment: sdkOptions.environment,
        onComplete: options.onComplete || (() => {}),
        onError: options.onError || (() => {}),
      },
    });
  };

  async createComponentBuilder(
    type: string
  ): Promise<PaymentComponentBuilder | never> {
    const { baseOptions } = await this.setupData;

    const supportedMethods = {
      card: CardBuilder,
      invoice: InvoiceBuilder,
      purchaseorder: PurchaseOrderBuilder,
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
    const { baseOptions } = await this.setupData;

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

    return new supportedMethods[type](baseOptions);
  }
}
