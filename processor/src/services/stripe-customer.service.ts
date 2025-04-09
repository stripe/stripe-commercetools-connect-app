import Stripe from 'stripe';
import { CommercetoolsCartService } from '@commercetools/connect-payments-sdk';
import { Address, Cart, Customer, FieldDefinition } from '@commercetools/platform-sdk';
import { getConfig } from '../config/config';
import { paymentSDK } from '../payment-sdk';
import { CustomerResponseSchemaDTO } from '../dtos/stripe-payment.dto';
import { getCartIdFromContext } from '../libs/fastify/context/context';
import { stripeApi, wrapStripeError } from '../clients/stripe.client';
import { log } from '../libs/logger';
import { stripeCustomerIdCustomType } from '../custom-types/custom-types';
import {
  addFieldToCustomType,
  assignCustomTypeToCustomer,
  getCustomerCustomType,
  hasField,
} from '../helpers/customTypeHelper';

const stripe = stripeApi();

export class StripeCustomerService {
  private ctCartService: CommercetoolsCartService;

  constructor(ctCartService: CommercetoolsCartService) {
    this.ctCartService = ctCartService;
  }

  /**
   * Validates if the customer exists in Stripe and creates a new customer if it does not exist, to create a session
   * for the Stripe customer.
   * @param {string} defaultStripeCustomerId - The stripe customer id to validate.
   * @returns Promise with the stripeCustomerId, ephemeralKey and sessionId.
   */
  public async getCustomerSession(defaultStripeCustomerId?: string): Promise<CustomerResponseSchemaDTO | undefined> {
    try {
      const cart = await this.ctCartService.getCart({ id: getCartIdFromContext() });
      const ctCustomerId = cart.customerId || cart.anonymousId;
      if (!ctCustomerId) {
        log.warn('Cart does not have a customerId or anonymousId - Skipping customer creation');
        return;
      }

      const customer = await this.getCtCustomer(ctCustomerId);
      await this.ensureCustomerCustomFields(customer);
      log.info(
        `Customer has a custom field call ${stripeCustomerIdCustomType.fieldDefinitions[0].name} - customer session creation`,
      );
      const stripeCustomerId = await this.retrieveOrCreateStripeCustomerId(cart, customer, defaultStripeCustomerId);
      if (!stripeCustomerId) {
        throw 'Failed to get stripe customer id.';
      }

      const ephemeralKey = await this.createEphemeralKey(stripeCustomerId);
      if (!ephemeralKey) {
        throw 'Failed to create ephemeral key.';
      }

      const session = await this.createSession(stripeCustomerId);
      if (!session) {
        throw 'Failed to create session.';
      }

      return {
        stripeCustomerId,
        ephemeralKey: ephemeralKey,
        sessionId: session.client_secret,
      };
    } catch (error) {
      throw wrapStripeError(error);
    }
  }

  public async retrieveOrCreateStripeCustomerId(
    cart: Cart,
    customer: Customer,
    stripeCustomerId?: string,
  ): Promise<string | undefined> {
    if (stripeCustomerId) {
      const isValid = await this.validateStripeCustomerId(stripeCustomerId, customer.id);
      if (isValid) {
        return stripeCustomerId;
      }
    }

    const customFieldName = stripeCustomerIdCustomType.fieldDefinitions[0].name;
    const savedCustomerId = customer?.custom?.fields?.[customFieldName];
    if (savedCustomerId) {
      const isValid = await this.validateStripeCustomerId(savedCustomerId, customer.id);
      if (isValid) {
        return savedCustomerId;
      }
    }

    const existingCustomer = await this.findStripeCustomer(customer.id);
    if (existingCustomer) {
      await this.saveStripeCustomerId(existingCustomer?.id, customer);
      return existingCustomer.id;
    }

    const newCustomer = await this.createStripeCustomer(cart, customer);
    if (newCustomer) {
      await this.saveStripeCustomerId(newCustomer?.id, customer);
      return newCustomer.id;
    } else {
      throw 'Failed to create stripe customer.';
    }
  }

  public async validateStripeCustomerId(stripeCustomerId: string, ctCustomerId: string): Promise<boolean> {
    try {
      const customer = await stripe.customers.retrieve(stripeCustomerId);
      return Boolean(customer && !customer.deleted && customer.metadata?.ct_customer_id === ctCustomerId);
    } catch (e) {
      log.warn('Error validating Stripe customer ID', { error: e });
      return false;
    }
  }

  public async findStripeCustomer(ctCustomerId: string): Promise<Stripe.Customer | undefined> {
    try {
      const query = `metadata['ct_customer_id']:'${ctCustomerId}'`;
      const customer = await stripe.customers.search({ query });
      return customer.data[0];
    } catch (e) {
      log.warn(`Error finding Stripe customer for ctCustomerId: ${ctCustomerId}`, { error: e });
      return undefined;
    }
  }

  public async createStripeCustomer(cart: Cart, customer: Customer): Promise<Stripe.Customer | undefined> {
    const shippingAddress = this.getStripeCustomerAddress(customer.addresses[0], cart.shippingAddress);
    const email = cart.customerEmail || customer.email || cart.shippingAddress?.email;
    const newCustomer = await stripe.customers.create({
      email,
      name: `${customer.firstName} ${customer.lastName}`.trim() || shippingAddress?.name,
      phone: shippingAddress?.phone,
      address: shippingAddress?.address,
      metadata: {
        ...(cart.customerId ? { ct_customer_id: customer.id } : null),
      },
    });

    return newCustomer;
  }

  public async saveStripeCustomerId(stripeCustomerId: string, customer: Customer): Promise<boolean> {
    const customFieldName = stripeCustomerIdCustomType.fieldDefinitions[0].name;
    if (customer.custom?.fields?.[customFieldName] === stripeCustomerId) {
      return true;
    }

    // TODO: commercetools insights on how to integrate the Stripe accountId into commercetools:
    // We have plans to support recurring payments and saved payment methods in the next quarters.
    // Not sure if you can wait until that so your implementation would be aligned with ours.
    const latestCustomer = await this.getCtCustomer(customer.id);
    const response = await paymentSDK.ctAPI.client
      .customers()
      .withId({ ID: latestCustomer.id })
      .post({
        body: {
          version: latestCustomer.version,
          actions: [
            {
              action: 'setCustomField',
              name: customFieldName,
              value: stripeCustomerId,
            },
          ],
        },
      })
      .execute();
    return Boolean(response.body.custom?.fields?.[customFieldName]);
  }

  public async createSession(stripeCustomerId: string): Promise<Stripe.CustomerSession | undefined> {
    const paymentConfig = getConfig().stripeSavedPaymentMethodConfig;
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
  }

  public async createEphemeralKey(stripeCustomerId: string) {
    const config = getConfig();
    const res = await stripe.ephemeralKeys.create(
      { customer: stripeCustomerId },
      { apiVersion: config.stripeApiVersion },
    );
    return res?.secret;
  }

  public async getCtCustomer(ctCustomerId: string): Promise<Customer> {
    const response = await paymentSDK.ctAPI.client.customers().withId({ ID: ctCustomerId }).get().execute();
    if (!response.body) {
      log.error('Customer not found', { ctCustomerId });
      throw `Customer with ID ${ctCustomerId} not found`;
    }
    return response.body;
  }

  public getStripeCustomerAddress(prioritizedAddress: Address | undefined, fallbackAddress: Address | undefined) {
    if (!prioritizedAddress && !fallbackAddress) {
      return undefined;
    }

    const getField = (field: keyof Address): string => {
      const value = prioritizedAddress?.[field] ?? fallbackAddress?.[field];
      return typeof value === 'string' ? value : '';
    };

    return {
      name: `${getField('firstName')} ${getField('lastName')}`.trim(),
      phone: getField('phone') || getField('mobile'),
      address: {
        line1: `${getField('streetNumber')} ${getField('streetName')}`.trim(),
        line2: getField('additionalStreetInfo'),
        city: getField('city'),
        postal_code: getField('postalCode'),
        state: getField('state'),
        country: getField('country'),
      },
    };
  }

  public async ensureCustomerCustomFields(customer: Customer): Promise<boolean> {
    const client = paymentSDK.ctAPI.client;
    const fieldDef = stripeCustomerIdCustomType.fieldDefinitions[0] as FieldDefinition;

    const updatedCustomer = await assignCustomTypeToCustomer(client, customer);
    const effectiveCustomer = updatedCustomer || customer;

    const customerType = await getCustomerCustomType(client, effectiveCustomer);

    const fieldExists = hasField(customerType, fieldDef.name);
    if (!fieldExists) {
      const updatedType = await addFieldToCustomType(client, customerType, fieldDef);
      return hasField(updatedType, fieldDef.name);
    }

    return true;
  }
}
