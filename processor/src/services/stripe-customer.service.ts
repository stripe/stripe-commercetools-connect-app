import Stripe from 'stripe';
import { CommercetoolsCartService } from '@commercetools/connect-payments-sdk';
import {
  Address,
  Cart,
  Customer,
  CustomerSetCustomFieldAction,
  CustomerSetCustomTypeAction,
} from '@commercetools/platform-sdk';
import { getConfig } from '../config/config';
import { CustomerResponseSchemaDTO } from '../dtos/stripe-payment.dto';
import { getCartIdFromContext } from '../libs/fastify/context/context';
import { stripeApi, wrapStripeError } from '../clients/stripe.client';
import { log } from '../libs/logger';
import { stripeCustomerIdFieldName, stripeCustomerIdCustomType } from '../custom-types/custom-types';
import { isValidUUID } from '../utils';
import { getCustomFieldUpdateActions } from './commerce-tools/custom-type-helper';
import { getCustomerById, updateCustomerById } from './commerce-tools/customer-client';
import { METADATA_CUSTOMER_ID_FIELD } from '../constants';

const stripe = stripeApi();

export class StripeCustomerService {
  private ctCartService: CommercetoolsCartService;

  constructor(ctCartService: CommercetoolsCartService) {
    this.ctCartService = ctCartService;
  }

  /**
   * Validates if the customer exists in Stripe and creates a new customer if it does not
   * exist, to create a session for the Stripe customer.
   * @param {string} defaultStripeCustomerId - The stripe customer id to validate.
   * @returns Promise with the stripeCustomerId, ephemeralKey and sessionId.
   */
  public async getCustomerSession(defaultStripeCustomerId?: string): Promise<CustomerResponseSchemaDTO | undefined> {
    try {
      const cart = await this.ctCartService.getCart({ id: getCartIdFromContext() });
      const ctCustomerId = cart.customerId;
      if (!ctCustomerId) {
        log.warn('Cart does not have a customerId - Skipping customer creation');
        return;
      }

      const customer = await this.getCtCustomer(ctCustomerId);
      if (!customer) {
        log.info('Customer not found - Skipping Stripe Customer creation');
        return;
      }

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

    const savedCustomerId = customer?.custom?.fields?.[stripeCustomerIdFieldName];
    if (savedCustomerId) {
      const isValid = await this.validateStripeCustomerId(savedCustomerId, customer.id);
      if (isValid) {
        log.info('Customer has a valid Stripe Customer ID saved.', { stripeCustomerId: savedCustomerId });
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
      return Boolean(customer && !customer.deleted && customer.metadata?.[METADATA_CUSTOMER_ID_FIELD] === ctCustomerId);
    } catch (e) {
      log.warn('Error validating Stripe customer ID', { error: e });
      return false;
    }
  }

  public async findStripeCustomer(ctCustomerId: string): Promise<Stripe.Customer | undefined> {
    try {
      if (!isValidUUID(ctCustomerId)) {
        log.warn('Invalid ctCustomerId: Not a valid UUID:', { ctCustomerId });
        throw 'Invalid ctCustomerId: Not a valid UUID';
      }
      const query = `metadata['${METADATA_CUSTOMER_ID_FIELD}']:'${ctCustomerId}'`;
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
    return await stripe.customers.create({
      email,
      name: `${customer.firstName} ${customer.lastName}`.trim() || shippingAddress?.name,
      phone: shippingAddress?.phone,
      address: shippingAddress?.address,
      metadata: {
        ...(cart.customerId ? { [METADATA_CUSTOMER_ID_FIELD]: customer.id } : null),
      },
    });
  }

  public async saveStripeCustomerId(stripeCustomerId: string, customer: Customer): Promise<void> {
    /*
      TODO: commercetools insights on how to integrate the Stripe accountId into commercetools:
      We have plans to support recurring payments and saved payment methods in the next quarters.
      Not sure if you can wait until that so your implementation would be aligned with ours.
    */
    const fields: Record<string, string> = {
      [stripeCustomerIdFieldName]: stripeCustomerId,
    };
    const { id, version, custom } = customer;
    const updateFieldActions = await getCustomFieldUpdateActions<
      CustomerSetCustomTypeAction | CustomerSetCustomFieldAction
    >({
      fields,
      customFields: custom,
      customType: stripeCustomerIdCustomType,
    });
    await updateCustomerById({ id, version, actions: updateFieldActions });
    log.info(`Stripe Customer ID "${stripeCustomerId}" saved to customer "${id}".`);
  }

  public async createSession(stripeCustomerId: string): Promise<Stripe.CustomerSession | undefined> {
    const paymentConfig = getConfig().stripeSavedPaymentMethodConfig;
    return await stripe.customerSessions.create({
      customer: stripeCustomerId,
      components: {
        payment_element: {
          enabled: true,
          features: { ...paymentConfig },
        },
      },
    });
  }

  public async createEphemeralKey(stripeCustomerId: string) {
    const config = getConfig();
    const res = await stripe.ephemeralKeys.create(
      { customer: stripeCustomerId },
      { apiVersion: config.stripeApiVersion },
    );
    return res?.secret;
  }

  public async getCtCustomer(ctCustomerId: string): Promise<Customer | undefined> {
    try {
      return await getCustomerById(ctCustomerId);
    } catch (error) {
      log.warn(`Customer not found "${ctCustomerId}"`, { error });
      return;
    }
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

  public getBillingAddress(cart: Cart) {
    const prioritizedAddress = cart.billingAddress ?? cart.shippingAddress;
    if (!prioritizedAddress) {
      return undefined;
    }

    const getField = (field: keyof Address): string => {
      const value = prioritizedAddress?.[field];
      return typeof value === 'string' ? value : '';
    };

    return JSON.stringify({
      name: `${getField('firstName')} ${getField('lastName')}`.trim(),
      phone: getField('phone') || getField('mobile'),
      email: cart.customerEmail ?? '',
      address: {
        line1: `${getField('streetNumber')} ${getField('streetName')}`.trim(),
        line2: getField('additionalStreetInfo'),
        city: getField('city'),
        postal_code: getField('postalCode'),
        state: getField('state'),
        country: getField('country'),
      },
    });
  }
}
