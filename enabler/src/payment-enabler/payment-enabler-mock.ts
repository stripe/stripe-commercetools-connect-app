import { BaseOptions } from '../components/base';
// import { FakeSdk } from '../fake-sdk';
import { PaymentComponentBuilder, PaymentEnabler } from './payment-enabler';

declare global {
  interface ImportMeta {
    // env: any;
  }
}

export class MockPaymentEnabler implements PaymentEnabler {
  setupData: Promise<{ baseOptions: BaseOptions }>;

  constructor() {
    // this.setupData = MockPaymentEnabler._Setup(options);
  }

  async createComponentBuilder(
    type: string
  ): Promise<PaymentComponentBuilder | never> {
    const { baseOptions } = await this.setupData;

    const supportedMethods = {
      // card: CardBuilder,
      // invoice: InvoiceBuilder,
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
