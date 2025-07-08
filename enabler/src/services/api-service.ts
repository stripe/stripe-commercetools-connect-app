import {
  ConfigElementResponseSchemaDTO,
  ConfigResponseSchemaDTO,
  ConfirmPaymentRequestSchemaDTO,
  CustomerResponseSchemaDTO,
  PaymentResponseSchemaDTO,
  SetupIntentResponseSchemaDTO,
  ShippingMethodsResponseSchemaDTO,
  SubscriptionFromSetupIntentResponseSchemaDTO,
  SubscriptionResponseSchemaDTO,
} from "../dtos/mock-payment.dto";
import {ExpressCheckoutPartialAddress, ShippingRate} from "@stripe/stripe-js/dist/stripe-js/elements/express-checkout";

export interface ApiServiceProps {
  baseApi: string;
  sessionId: string;
}

export interface ConfirmSubscriptionProps {
  subscriptionId: string;
  paymentReference: string;
  paymentIntentId?: string;
}

export interface ApiService {
  getHeadersConfig: () => HeadersInit;
  getCustomerOptions: () => Promise<CustomerResponseSchemaDTO | undefined>;
  getConfigData: (
    paymentMethodType: string
  ) => Promise<[ConfigElementResponseSchemaDTO, ConfigResponseSchemaDTO]>;
  getPayment: (stripeCustomerId?: string) => Promise<PaymentResponseSchemaDTO>;
  confirmPaymentIntent: (data: ConfirmPaymentRequestSchemaDTO) => Promise<void>;
  createSetupIntent: () => Promise<SetupIntentResponseSchemaDTO>;
  createSubscription: () => Promise<SubscriptionResponseSchemaDTO>;
  createSubscriptionFromSetupIntent: (
    setupIntentId: string
  ) => Promise<SubscriptionFromSetupIntentResponseSchemaDTO>;
  confirmSubscriptionPayment: (data: ConfirmSubscriptionProps) => Promise<void>;
  getShippingMethods: (data: ExpressCheckoutPartialAddress) => Promise<ShippingMethodsResponseSchemaDTO>;
  updateShippingRate: (data: ShippingRate) => Promise<ShippingMethodsResponseSchemaDTO>;
  removeShippingRate: () => Promise<ShippingMethodsResponseSchemaDTO>;
}

export const apiService = ({
  baseApi,
  sessionId,
}: ApiServiceProps): ApiService => {
  const getHeadersConfig = (): HeadersInit => {
    return {
      "Content-Type": "application/json",
      "x-session-id": sessionId,
    };
  };

  const getCustomerOptions = async (): Promise<
    CustomerResponseSchemaDTO | undefined
  > => {
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
      fetch(`${baseApi}/config-element/${paymentElementType}`, headers),
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

  const getPayment = async (): Promise<PaymentResponseSchemaDTO> => {
    const apiUrl = new URL(`${baseApi}/payments`);
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
      throw "Error in processor confirming PaymentIntent";
    }
  };

  const createSetupIntent = async (): Promise<SetupIntentResponseSchemaDTO> => {
    const apiUrl = `${baseApi}/setupIntent`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: getHeadersConfig(),
      body: "{}",
    });

    if (!response.ok) {
      const error = await response.json();
      console.warn(
        `Error in processor creating Setup Intent: ${error.message}`
      );
      throw error;
    }
    return await response.json();
  }

  const createSubscription = async (): Promise<SubscriptionResponseSchemaDTO> => {
    const apiUrl = `${baseApi}/subscription`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: getHeadersConfig(),
      body: "{}",
    });

    if (!response.ok) {
      const error = await response.json();
      console.warn(
        `Error in processor creating Subscription: ${error.message}`
      );
      throw error;
    }
    return await response.json();
  };

  const createSubscriptionFromSetupIntent = async (
    setupIntentId: string
  ): Promise<SubscriptionFromSetupIntentResponseSchemaDTO> => {
    const apiUrl = `${baseApi}/subscription/withSetupIntent`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: getHeadersConfig(),
      body: JSON.stringify({ setupIntentId }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.warn(
        `Error in processor creating Subscription from Setup Intent: ${error.message}`
      );
      throw error;
    }

    return await response.json();
  };

  const confirmSubscriptionPayment = async (
    props: ConfirmSubscriptionProps
  ): Promise<void> => {
    const apiUrl = `${baseApi}/subscription/confirm`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: getHeadersConfig(),
      body: JSON.stringify(props),
    });

    if (!response.ok) {
      throw "Error in processor confirming Subscription Payment";
    }
  };

  const getShippingMethods = async (
    data: ExpressCheckoutPartialAddress
  ): Promise<ShippingMethodsResponseSchemaDTO> => {
    const apiUrl = `${baseApi}/shipping-methods`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: getHeadersConfig(),
      body: JSON.stringify({
        country: data.country,
        state: data.state,
        city: data.city,
        postalCode: data.postal_code,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.warn(`Error in processor getting shipping methods: ${error.message}`);
      throw error;
    }
    return await response.json();
  }

  const updateShippingRate = async (
    data: ShippingRate
  ): Promise<ShippingMethodsResponseSchemaDTO> => {
    const apiUrl = `${baseApi}/shipping-methods/update`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: getHeadersConfig(),
      body: JSON.stringify({
        id: data.id,
        amount: data.amount,
        displayName: data.displayName
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.warn(`Error in processor updating shipping rate: ${error.message}`);
      throw error;
    }

    return await response.json();
  }

  const removeShippingRate = async (
  ): Promise<ShippingMethodsResponseSchemaDTO> => {
    const apiUrl = `${baseApi}/shipping-methods/remove`;
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: getHeadersConfig(),
    });
    if (!response.ok) {
      const error = await response.json();
      console.warn(`Error in processor removing shipping rate: ${error.message}`);
      throw error;
    }

    return await response.json();
  }

  return {
    getHeadersConfig,
    getCustomerOptions,
    getConfigData,
    getPayment,
    confirmPaymentIntent,
    createSetupIntent,
    createSubscription,
    createSubscriptionFromSetupIntent,
    confirmSubscriptionPayment,
    getShippingMethods,
    updateShippingRate,
    removeShippingRate
  };
};
