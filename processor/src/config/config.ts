import Stripe from 'stripe';
import { parseJSON } from '../utils';

export type PaymentFeatures = Stripe.CustomerSessionCreateParams.Components.PaymentElement.Features;

const getSavedPaymentConfig = (): PaymentFeatures => {
  const config = process.env.STRIPE_SAVED_PAYMENT_METHODS_CONFIG;
  return {
    //default values disabled {"payment_method_save":"disabled"}
    ...(config ? parseJSON<PaymentFeatures>(config) : null),
  };
};

export const config = {
  // Required by Payment SDK
  projectKey: process.env.CTP_PROJECT_KEY || 'payment-integration',
  clientId: process.env.CTP_CLIENT_ID || 'xxx',
  clientSecret: process.env.CTP_CLIENT_SECRET || 'xxx',
  jwksUrl: process.env.CTP_JWKS_URL || 'https://mc-api.europe-west1.gcp.commercetools.com/.well-known/jwks.json',
  jwtIssuer: process.env.CTP_JWT_ISSUER || 'https://mc-api.europe-west1.gcp.commercetools.com',
  authUrl: process.env.CTP_AUTH_URL || 'https://auth.europe-west1.gcp.commercetools.com',
  apiUrl: process.env.CTP_API_URL || 'https://api.europe-west1.gcp.commercetools.com',
  sessionUrl: process.env.CTP_SESSION_URL || 'https://session.europe-west1.gcp.commercetools.com/',
  healthCheckTimeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || '5000'),

  // Required by logger
  loggerLevel: process.env.LOGGER_LEVEL || 'info',

  // Update with specific payment providers config
  mockClientKey: process.env.MOCK_CLIENT_KEY || 'stripe',
  mockEnvironment: process.env.MOCK_ENVIRONMENT || 'TEST',

  // Update with specific payment providers config
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || 'stripeSecretKey',
  stripeWebhookSigningSecret: process.env.STRIPE_WEBHOOK_SIGNING_SECRET || '',
  stripeCaptureMethod: process.env.STRIPE_CAPTURE_METHOD || 'automatic',
  stripePaymentElementAppearance: process.env.STRIPE_APPEARANCE_PAYMENT_ELEMENT,
  stripeExpressCheckoutAppearance: process.env.STRIPE_APPEARANCE_EXPRESS_CHECKOUT,
  stripeLayout: process.env.STRIPE_LAYOUT || '{"type":"tabs","defaultCollapsed":false}',
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  stripeApplePayWellKnown: process.env.STRIPE_APPLE_PAY_WELL_KNOWN || 'mockWellKnown',
  stripeApiVersion: process.env.STRIPE_API_VERSION || '2025-02-24.acacia',
  stripeSavedPaymentMethodConfig: getSavedPaymentConfig(),
  stripeCollectBillingAddress: process.env.STRIPE_COLLECT_BILLING_ADDRESS || 'auto',

  // Payment Providers config
  merchantReturnUrl: process.env.MERCHANT_RETURN_URL || '',
};

export const getConfig = () => {
  return config;
};
