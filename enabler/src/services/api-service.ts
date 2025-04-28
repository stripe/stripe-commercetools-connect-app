import { PaymentIntent, Stripe, StripeElements } from "@stripe/stripe-js";
import {
  ConfigElementResponseSchemaDTO,
  ConfigResponseSchemaDTO,
  ConfirmPaymentRequestSchemaDTO,
  CustomerResponseSchemaDTO,
  PaymentResponseSchemaDTO,
} from "../dtos/mock-payment.dto";
import { parseJSON } from "../utils";

export interface ApiServiceProps {
  baseApi: string;
  sessionId: string;
  stripe: Stripe;
  elements: StripeElements;
}

export interface BillingAddress {
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
  };
}

export interface ApiService {
  getHeadersConfig: () => HeadersInit;
  getCustomerOptions: () => Promise<CustomerResponseSchemaDTO>;
  getConfigData: (
    paymentMethodType: string
  ) => Promise<[ConfigElementResponseSchemaDTO, ConfigResponseSchemaDTO]>;
  getPayment: (stripeCustomerId?: string) => Promise<PaymentResponseSchemaDTO>;
  confirmPaymentIntent: (data: ConfirmPaymentRequestSchemaDTO) => Promise<void>;
  confirmStripePayment: (
    data: PaymentResponseSchemaDTO
  ) => Promise<PaymentIntent>;
}

export const apiService = ({
  baseApi,
  sessionId,
  stripe,
  elements,
}: ApiServiceProps): ApiService => {
  const getHeadersConfig = (): HeadersInit => {
    return {
      "Content-Type": "application/json",
      "x-session-id": sessionId,
    };
  };

  const getCustomerOptions = async (): Promise<CustomerResponseSchemaDTO> => {
    const apiUrl = new URL(`${baseApi}/customer/session`);
    const response = await fetch(apiUrl.toString(), {
      method: "GET",
      headers: getHeadersConfig(),
    });

    if (response.status === 204) {
      return undefined;
    }

    return await response.json();
  };

  const getConfigData = async (
    paymentElementType: string
  ): Promise<[ConfigElementResponseSchemaDTO, ConfigResponseSchemaDTO]> => {
    const headers: RequestInit = {
      method: "GET",
      headers: getHeadersConfig(),
    };
    const [configElementResponse, configEnvResponse] = await Promise.all([
      fetch(`${baseApi}/config-element/${paymentElementType}`, headers), // MVP this could be used by expressCheckout and Subscription
      fetch(`${baseApi}/operations/config`, headers),
    ]);

    if (!configElementResponse.ok) {
      const error =
        (await configElementResponse.json()) ||
        "Error in configElementResponse";
      throw error;
    }

    if (!configEnvResponse.ok) {
      const error =
        (await configEnvResponse.json()) || "Error in configEnvResponse";
      throw error;
    }

    return Promise.all([
      configElementResponse.json(),
      configEnvResponse.json(),
    ]);
  };

  const getPayment = async (
    stripeCustomerId?: string
  ): Promise<PaymentResponseSchemaDTO> => {
    const apiUrl = new URL(`${baseApi}/payments`);
    apiUrl.searchParams.append("stripeCustomerId", stripeCustomerId || "");
    const response = await fetch(apiUrl.toString(), {
      method: "GET",
      headers: getHeadersConfig(),
    });

    if (!response.ok) {
      const error = await response.json();
      console.warn(`Error in processor getting Payment: ${error.message}`);
      throw error;
    }
    return await response.json();
  };

  const confirmPaymentIntent = async ({
    paymentIntentId,
    paymentReference,
  }: ConfirmPaymentRequestSchemaDTO): Promise<void> => {
    const apiUrl = `${baseApi}/confirmPayments/${paymentReference}`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: getHeadersConfig(),
      body: JSON.stringify({ paymentIntent: paymentIntentId }),
    });

    if (!response.ok) {
      throw "Error on /confirmPayments";
    }
  };

  const confirmStripePayment = async ({
    cartId,
    clientSecret,
    paymentReference,
    merchantReturnUrl,
    billingAddress,
  }: PaymentResponseSchemaDTO): Promise<PaymentIntent> => {
    const address = billingAddress
      ? parseJSON<BillingAddress>(billingAddress)
      : undefined;
    const returnUrl = new URL(merchantReturnUrl);
    returnUrl.searchParams.append("cartId", cartId);
    returnUrl.searchParams.append("paymentReference", paymentReference);

    const { error, paymentIntent } = await stripe.confirmPayment({
      confirmParams: {
        return_url: returnUrl.toString(),
        ...(address && {
          payment_method_data: {
            billing_details: address,
          },
        }),
      },
      redirect: "if_required",
      clientSecret,
      elements,
    });

    if (error) {
      throw error;
    }

    return paymentIntent;
  };

  return {
    getHeadersConfig,
    getCustomerOptions,
    getConfigData,
    getPayment,
    confirmPaymentIntent,
    confirmStripePayment,
  };
};
