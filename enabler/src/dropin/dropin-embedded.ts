import { PaymentResponseSchemaDTO } from "../dtos/mock-payment.dto";
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

interface BillingAddress {
  name: string;
  email: string;
  phone: string;
  address: {
    city: string;
    country: string;
    line1: string;
    line2: string;
    postal_code: string;
    state: string;
  }
}

interface ConfirmPaymentProps {
  merchantReturnUrl: string;
  cartId: string;
  clientSecret: string;
  paymentReference: string;
  billingAddress?: BillingAddress;
}

interface ConfirmPaymentIntentProps {
  paymentIntentId: string;
  paymentReference: string;
}

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

  constructor(opts: {
    baseOptions: BaseOptions;
    dropinOptions: DropinOptions;
  }) {
    this.baseOptions = opts.baseOptions;
    this.dropinOptions = opts.dropinOptions;
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

      const {
        sClientSecret,
        paymentReference,
        merchantReturnUrl,
        cartId,
        billingAddress
      } = await this.getPayment();

      const { paymentIntent } = await this.confirmStripePayment({
        merchantReturnUrl,
        cartId,
        clientSecret: sClientSecret,
        paymentReference,
        ...(billingAddress && {billingAddress: JSON.parse(billingAddress) as BillingAddress}),
      });

      await this.confirmPaymentIntent({
        paymentIntentId: paymentIntent.id,
        paymentReference,
      });
    } catch (error) {
      this.baseOptions.onError?.(error);
    }
  }

  private async getPayment(): Promise<PaymentResponseSchemaDTO> {
    const apiUrl = new URL(`${this.baseOptions.processorUrl}/payments`);
    apiUrl.searchParams.append("customerId", this.baseOptions.stripeCustomerId);

    const response = await fetch(apiUrl.toString(), {
      method: "GET",
      headers: this.getHeadersConfig(),
    });

    if (!response.ok) {
      const error = await response.json();
      console.warn(`Error in processor getting Payment: ${error.message}`);
      throw error;
    } else {
      return await response.json();
    }
  }

  private async confirmStripePayment({
    merchantReturnUrl,
    cartId,
    clientSecret,
    paymentReference,
    billingAddress,
  }: ConfirmPaymentProps) {
    const returnUrl = new URL(merchantReturnUrl);
    returnUrl.searchParams.append("cartId", cartId);
    returnUrl.searchParams.append("paymentReference", paymentReference);

    const { error, paymentIntent } = await this.baseOptions.sdk.confirmPayment({
      elements: this.baseOptions.elements,
      clientSecret,
      confirmParams: {
        return_url: returnUrl.toString(),
        ...(billingAddress &&{
          payment_method_data: {
            billing_details: billingAddress
          }
        })
      },
      redirect: "if_required",
    });

    if (error) {
      throw error;
    }

    return { paymentIntent };
  }

  private async confirmPaymentIntent({
    paymentIntentId,
    paymentReference,
  }: ConfirmPaymentIntentProps) {
    const apiUrl = `${this.baseOptions.processorUrl}/confirmPayments/${paymentReference}`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: this.getHeadersConfig(),
      body: JSON.stringify({ paymentIntent: paymentIntentId }),
    });

    if (!response.ok) {
      throw "Error on /confirmPayments";
    }

    this.baseOptions.onComplete?.({
      isSuccess: true,
      paymentReference,
      paymentIntent: paymentIntentId,
    });
  }

  private getHeadersConfig(): HeadersInit {
    return {
      "Content-Type": "application/json",
      "x-session-id": this.baseOptions.sessionId,
    };
  }
}
