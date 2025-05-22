import Stripe from 'stripe';
import { SubscriptionAttributes } from '../../src/services/types/stripe-subscription.type';
import { mockStripeCustomerId } from './mock-customer-data';
import { commonLastResponse, commonPaymentResult } from './mock-payment-results';

export const mockSubscriptionAttributes: SubscriptionAttributes = {
  description: 'Test subscription',
  recurring_interval: 'month',
  recurring_interval_count: 1,
  off_session: true,
  collection_method: 'charge_automatically',
};

export const setupIntentIdMock = 'seti_test_id';

export const setupIntentResponseMock: Stripe.Response<Stripe.SetupIntent> = {
  id: setupIntentIdMock,
  object: 'setup_intent',
  application: null,
  automatic_payment_methods: {
    allow_redirects: 'always',
    enabled: true,
  },
  cancellation_reason: null,
  client_secret: 'seti_client_secret',
  created: 1747767462,
  customer: mockStripeCustomerId,
  description: null,
  flow_directions: null,
  last_setup_error: null,
  latest_attempt: null,
  livemode: false,
  mandate: null,
  metadata: {},
  next_action: null,
  on_behalf_of: null,
  payment_method: 'pm_mock_id',
  payment_method_configuration_details: null,
  payment_method_options: null,
  payment_method_types: ['card'],
  single_use_mandate: null,
  status: 'requires_payment_method',
  usage: 'off_session',
  lastResponse: commonLastResponse,
};

export const stripePriceIdMock = 'price_mock_1234567890';
export const stripeProductIdMock = 'prod_mock_id';

export const subscriptionResponseMock = {
  id: 'sub_mock_id',
  latest_invoice: {
    id: 'in_mock_id',
    payment_intent: commonPaymentResult,
  },
} as unknown as Stripe.Response<Stripe.Subscription>;

export const subscriptionWithoutPaymentResponseMock = {
  id: 'sub_mock_id',
  latest_invoice: '',
} as unknown as Stripe.Response<Stripe.Subscription>;

export const stripeProductDataMock: Stripe.Response<Stripe.Product> = {
  id: stripeProductIdMock,
  object: 'product',
  active: true,
  created: 1678833149,
  default_price: null,
  description: null,
  images: [],
  marketing_features: [],
  livemode: false,
  metadata: {},
  name: 'Test product',
  package_dimensions: null,
  shippable: null,
  statement_descriptor: null,
  tax_code: null,
  unit_label: null,
  updated: 1678833149,
  url: null,
  type: 'service',
  lastResponse: commonLastResponse,
};

export const stripeProductResponseMock: Stripe.Response<Stripe.ApiSearchResult<Stripe.Product>> = {
  data: [stripeProductDataMock],
  has_more: false,
  object: 'search_result',
  lastResponse: commonLastResponse,
  next_page: null,
  url: '',
};

export const stripeProductEmptyResponseMock: Stripe.Response<Stripe.ApiSearchResult<Stripe.Product>> = {
  data: [],
  has_more: false,
  object: 'search_result',
  lastResponse: commonLastResponse,
  next_page: null,
  url: '',
};

export const stripePriceDataMock: Stripe.Response<Stripe.Price> = {
  id: stripePriceIdMock,
  object: 'price',
  active: true,
  billing_scheme: 'per_unit',
  created: 1679431181,
  currency: 'usd',
  custom_unit_amount: null,
  livemode: false,
  lookup_key: null,
  metadata: {},
  nickname: 'Test price',
  product: stripeProductIdMock,
  recurring: {
    interval: 'month',
    interval_count: 1,
    trial_period_days: null,
    usage_type: 'licensed',
    aggregate_usage: null,
    meter: null,
  },
  tax_behavior: 'unspecified',
  tiers_mode: null,
  transform_quantity: null,
  type: 'recurring',
  unit_amount: 150000,
  unit_amount_decimal: '150000',
  lastResponse: commonLastResponse,
};

const differentStripePriceMock: Stripe.Response<Stripe.Price> = { ...stripePriceDataMock, unit_amount: 2000 };

export const stripePriceResponseMock: Stripe.Response<Stripe.ApiSearchResult<Stripe.Price>> = {
  data: [stripePriceDataMock],
  has_more: false,
  lastResponse: commonLastResponse,
  next_page: null,
  url: '',
  object: 'search_result',
};

export const stripeDifferentPriceResponseMock: Stripe.Response<Stripe.ApiSearchResult<Stripe.Price>> = {
  data: [differentStripePriceMock],
  has_more: false,
  object: 'search_result',
  lastResponse: commonLastResponse,
  next_page: null,
  url: '',
};

export const stripePriceEmptyResponseMock: Stripe.Response<Stripe.ApiSearchResult<Stripe.Price>> = {
  data: [],
  has_more: false,
  object: 'search_result',
  lastResponse: commonLastResponse,
  next_page: null,
  url: '',
};
