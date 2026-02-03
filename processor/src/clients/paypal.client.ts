import { getConfig } from '../config/config';
import { log } from '../libs/logger';

export interface PayPalOrderRequest {
  intent: 'CAPTURE' | 'AUTHORIZE';
  purchase_units: Array<{
    amount: {
      currency_code: string;
      value: string;
    };
    reference_id?: string;
  }>;
}

export interface PayPalOrderResponse {
  id: string;
  status: string;
  links: Array<{
    href: string;
    rel: string;
    method: string;
  }>;
}

export interface PayPalCaptureResponse {
  id: string;
  status: string;
  purchase_units: Array<{
    reference_id: string;
    payments: {
      captures: Array<{
        id: string;
        status: string;
        amount: {
          currency_code: string;
          value: string;
        };
      }>;
    };
  }>;
}

export class PayPalApiError extends Error {
  public statusCode: number;
  public details: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = 'PayPalApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

class PayPalClient {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  private getBaseUrl(): string {
    const config = getConfig();
    return config.paypalEnvironment === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiry) {
      return this.accessToken;
    }

    const config = getConfig();
    const baseUrl = this.getBaseUrl();
    const auth = Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString('base64');

    const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('PayPal OAuth token request failed', { status: response.status, error: errorText });
      throw new PayPalApiError('Failed to obtain PayPal access token', response.status, errorText);
    }

    const data = await response.json();
    this.accessToken = data.access_token as string;
    // Set expiry 5 minutes before actual expiry to be safe
    this.tokenExpiry = now + (data.expires_in - 300) * 1000;

    return this.accessToken as string;
  }

  async createOrder(order: PayPalOrderRequest): Promise<PayPalOrderResponse> {
    const accessToken = await this.getAccessToken();
    const baseUrl = this.getBaseUrl();

    log.info('Creating PayPal order', { order });

    const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(order),
    });

    if (!response.ok) {
      const errorData = await response.json();
      log.error('PayPal create order failed', { status: response.status, error: errorData });
      throw new PayPalApiError('Failed to create PayPal order', response.status, errorData);
    }

    const data = await response.json();
    log.info('PayPal order created', { orderId: data.id, status: data.status });

    return data;
  }

  async captureOrder(orderId: string): Promise<PayPalCaptureResponse> {
    const accessToken = await this.getAccessToken();
    const baseUrl = this.getBaseUrl();

    log.info('Capturing PayPal order', { orderId });

    const response = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      log.error('PayPal capture order failed', { status: response.status, error: errorData });
      throw new PayPalApiError('Failed to capture PayPal order', response.status, errorData);
    }

    const data = await response.json();
    log.info('PayPal order captured', { orderId: data.id, status: data.status });

    return data;
  }
}

// Singleton instance
let paypalClientInstance: PayPalClient | null = null;

export const paypalApi = (): PayPalClient => {
  if (!paypalClientInstance) {
    paypalClientInstance = new PayPalClient();
  }
  return paypalClientInstance;
};

export const wrapPayPalError = (e: unknown): Error => {
  if (e instanceof PayPalApiError) {
    return e;
  }

  log.error('Unexpected error calling PayPal API:', e);
  return e instanceof Error ? e : new Error(String(e));
};
