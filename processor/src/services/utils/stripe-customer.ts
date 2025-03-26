import Stripe from 'stripe';
import { Cart } from '@commercetools/connect-payments-sdk';
import { stripeApi } from '../../clients/stripe.client';
import { getConfig } from '../../config/config';
import { paymentSDK } from '../../payment-sdk';

const stripe = stripeApi();
const config = getConfig();

export const getStripeCustomerId = async (cart: Cart, id?: string): Promise<string> => {
  const ctCustomerId = cart.customerId!;
  if (id) {
    const isValid = await validateStripeCustomerId(id, ctCustomerId);
    if (isValid) {
      return id;
    }
  }

  //TODO: Get the stripeCustomer from Customer info, not from cart
  const savedCustomerId = cart.custom?.fields?.stripeCustomerId;
  if (savedCustomerId) {
    const isValid = await validateStripeCustomerId(savedCustomerId, ctCustomerId);
    if (isValid) {
      return savedCustomerId;
    }
  }

  const email = cart.customerEmail || cart.shippingAddress?.email;
  if (!email) {
    throw 'Customer email not found.';
  }

  const existingCustomer = await findStripeCustomer(email, ctCustomerId);
  if (existingCustomer?.id) {
    return existingCustomer.id;
  }

  const newCustomer = await createStripeCustomer(cart, email);
  if (newCustomer?.id) {
    return newCustomer.id;
  } else {
    throw 'Failed to create stripe customer.';
  }
};

export const validateStripeCustomerId = async (stripeCustomerId: string, ctCustomerId: string): Promise<boolean> => {
  try {
    const customer = await stripeApi().customers.retrieve(stripeCustomerId);
    return Boolean(customer && !customer.deleted && customer.metadata?.ct_customer_id === ctCustomerId);
  } catch (e) {
    const error = e as Error;
    if (!error?.message.includes('No such customer')) {
      throw error;
    } else {
      return false;
    }
  }
};

export const findStripeCustomer = async (email: string, ctCustomerId: string): Promise<Stripe.Customer> => {
  const query = `email:'${email}' AND metadata['ct_customer_id']:'${ctCustomerId}'`;
  const customer = await stripe.customers.search({ query });
  return customer.data[0];
};

export const createStripeCustomer = async (cart: Cart, email: string): Promise<Stripe.Customer> => {
  const newCustomer = await stripe.customers.create({
    email,
    name: `${cart.shippingAddress?.firstName} ${cart.shippingAddress?.lastName}`.trim(),
    metadata: {
      ...(cart.customerId ? { ct_customer_id: cart.customerId } : null),
    },
  });

  return newCustomer;
};

export const saveStripeCustomerId = async (stripeCustomerId: string, cart: Cart): Promise<boolean> => {
  //TODO: Set the stripeCustomer in the Customer info, not in cart
  if (cart.custom?.fields?.stripeCustomerId === stripeCustomerId) {
    return true;
  }

  const apiClient = paymentSDK.ctAPI.client;
  const response = await apiClient
    .carts()
    .withId({ ID: cart.id })
    .post({
      body: {
        version: cart.version,
        actions: [
          {
            action: 'setCustomType',
            type: {
              typeId: 'type',
              key: 'stripe-customer-id-type',
            },
            fields: {
              stripeCustomerId: stripeCustomerId,
            },
          },
        ],
      },
    })
    .execute();
  return Boolean(response.body.custom?.fields?.stripeCustomerId);
};

export const createSession = async (stripeCustomerId: string) => {
  const paymentConfig = config.stripeSavedPaymentMethodConfig;
  const session = await stripe.customerSessions.create({
    customer: stripeCustomerId,
    components: {
      payment_element: {
        enabled: true,
        features: { ...paymentConfig },
      },
    },
  });

  return session;
};
