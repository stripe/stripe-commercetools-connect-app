export interface PayPalConfig {
  clientId: string;
  environment: 'sandbox' | 'live';
  currency: string;
  amount: number;
}

export interface PayPalOrderResponse {
  orderId: string;
  status: string;
}

export interface PayPalCaptureResponse {
  orderId: string;
  status: string;
  captureId?: string;
  paymentReference?: string;
}

export interface PayPalServiceProps {
  baseApi: string;
  sessionId: string;
}

export interface PayPalService {
  getConfig: () => Promise<PayPalConfig>;
  captureOrder: (orderId: string) => Promise<PayPalCaptureResponse>;
  loadPayPalSDK: (clientId: string, currency: string, environment: 'sandbox' | 'live') => Promise<void>;
}

// PayPal SDK type declarations
declare global {
  interface Window {
    paypal?: {
      FUNDING: {
        PAYPAL: string;
        CARD: string;
        CREDIT: string;
        VENMO: string;
      };
      Buttons: (config: {
        fundingSource?: string;
        style?: {
          layout?: 'vertical' | 'horizontal';
          color?: 'gold' | 'blue' | 'silver' | 'white' | 'black';
          shape?: 'rect' | 'pill';
          label?: 'paypal' | 'checkout' | 'buynow' | 'pay';
          height?: number;
        };
        createOrder: (data: unknown, actions: {
          order: {
            create: (orderData: {
              intent: 'CAPTURE' | 'AUTHORIZE';
              purchase_units: Array<{
                reference_id?: string;
                description?: string;
                amount: {
                  currency_code: string;
                  value: string;
                };
              }>;
            }) => Promise<string>;
          };
        }) => Promise<string>;
        onApprove: (data: { orderID: string; payerID?: string }, actions: {
          order: {
            capture: () => Promise<{
              id: string;
              status: string;
              payer?: {
                payer_id?: string;
                email_address?: string;
                name?: {
                  given_name?: string;
                  surname?: string;
                };
              };
              purchase_units?: Array<{
                payments?: {
                  captures?: Array<{
                    id: string;
                    status: string;
                    amount: {
                      currency_code: string;
                      value: string;
                    };
                  }>;
                };
              }>;
            }>;
          };
        }) => Promise<void>;
        onError?: (err: Error) => void;
        onCancel?: (data?: unknown) => void;
      }) => {
        render: (selector: string) => Promise<void>;
      };
    };
  }
}

export const paypalService = ({
  baseApi,
  sessionId,
}: PayPalServiceProps): PayPalService => {
  const getHeadersConfig = (): HeadersInit => {
    return {
      "Content-Type": "application/json",
      "x-session-id": sessionId,
    };
  };

  const getConfig = async (): Promise<PayPalConfig> => {
    const response = await fetch(`${baseApi}/paypal/config`, {
      method: "GET",
      headers: getHeadersConfig(),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("Error getting PayPal config:", error.message);
      throw error;
    }

    return await response.json();
  };

  // Records the PayPal payment in commercetools after client-side capture
  const captureOrder = async (orderId: string): Promise<PayPalCaptureResponse> => {
    const response = await fetch(`${baseApi}/paypal/orders/${orderId}/capture`, {
      method: "POST",
      headers: getHeadersConfig(),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("Error capturing PayPal order:", error.message);
      throw error;
    }

    return await response.json();
  };

  const loadPayPalSDK = async (
    clientId: string,
    currency: string,
    environment: 'sandbox' | 'live'
  ): Promise<void> => {
    // Check if SDK is already loaded
    if (window.paypal) {
      return;
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const baseUrl = environment === 'live'
        ? 'https://www.paypal.com'
        : 'https://www.sandbox.paypal.com';

      script.src = `${baseUrl}/sdk/js?client-id=${clientId}&currency=${currency}&components=buttons&enable-funding=card`;
      script.async = true;

      script.onload = () => {
        if (window.paypal) {
          resolve();
        } else {
          reject(new Error("PayPal SDK loaded but paypal object not found"));
        }
      };

      script.onerror = () => {
        reject(new Error("Failed to load PayPal SDK"));
      };

      document.head.appendChild(script);
    });
  };

  return {
    getConfig,
    captureOrder,
    loadPayPalSDK,
  };
};
