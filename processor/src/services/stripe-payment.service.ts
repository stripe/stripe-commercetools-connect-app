import Stripe from 'stripe';
import { healthCheckCommercetoolsPermissions, statusHandler } from '@commercetools/connect-payments-sdk';
import {
  CancelPaymentRequest,
  CapturePaymentRequest,
  ConfigResponse,
  PaymentProviderModificationResponse,
  RefundPaymentRequest,
  StatusResponse,
} from './types/operation.type';

import { SupportedPaymentComponentsSchemaDTO } from '../dtos/operations/payment-componets.dto';
import { PaymentModificationStatus, PaymentTransactions } from '../dtos/operations/payment-intents.dto';
import packageJSON from '../../package.json';

import { AbstractPaymentService } from './abstract-payment.service';
import { getConfig } from '../config/config';
import { appLogger, paymentSDK } from '../payment-sdk';
import { CaptureMethod, StripeEvent, StripePaymentServiceOptions } from './types/stripe-payment.type';
import {
  CollectBillingAddressOptions,
  ConfigElementResponseSchemaDTO,
  CustomerResponseSchemaDTO,
  PaymentOutcome,
  PaymentResponseSchemaDTO,
} from '../dtos/stripe-payment.dto';
import {
  getCartIdFromContext,
  getMerchantReturnUrlFromContext,
  getPaymentInterfaceFromContext,
} from '../libs/fastify/context/context';
import { stripeApi, wrapStripeError } from '../clients/stripe.client';
import { log } from '../libs/logger';
import crypto from 'crypto';
import { StripeEventConverter } from './converters/stripeEventConverter';
import { Address, Cart, Customer, FieldDefinition } from '@commercetools/platform-sdk';
import { stripeCustomerIdCustomType } from '../custom-types/custom-types';
import {
  addFieldToCustomType,
  assignCustomTypeToCustomer,
  getCustomerCustomType,
  hasField,
} from '../helpers/customTypeHelper';
import { isValidUUID } from '../utils';

export class StripePaymentService extends AbstractPaymentService {
  private stripeEventConverter: StripeEventConverter;

  constructor(opts: StripePaymentServiceOptions) {
    super(opts.ctCartService, opts.ctPaymentService, opts.ctOrderService);
    this.stripeEventConverter = new StripeEventConverter();
  }

  /**
   * Get configurations
   *
   * @remarks
   * Implementation to provide mocking configuration information
   *
   * @returns Promise with mocking object containing configuration information
   */
  public async config(): Promise<ConfigResponse> {
    const config = getConfig();
    return {
      environment: config.mockEnvironment,
      publishableKey: config.stripePublishableKey,
    };
  }

  /**
   * Get status
   *
   * @remarks
   * Implementation to provide mocking status of external systems
   *
   * @returns Promise with mocking data containing a list of status from different external systems
   */
  public async status(): Promise<StatusResponse> {
    const handler = await statusHandler({
      timeout: getConfig().healthCheckTimeout,
      log: appLogger,
      checks: [
        healthCheckCommercetoolsPermissions({
          requiredPermissions: [
            'manage_payments',
            'view_sessions',
            'view_api_clients',
            'manage_orders',
            'introspect_oauth_tokens',
            'manage_checkout_payment_intents',
            'manage_types',
          ],
          ctAuthorizationService: paymentSDK.ctAuthorizationService,
          projectKey: getConfig().projectKey,
        }),
        async () => {
          try {
            const paymentMethods = await stripeApi().paymentMethods.list({
              limit: 3,
            });
            return {
              name: 'Stripe Status check',
              status: 'UP',
              message: 'Stripe api is working',
              details: {
                paymentMethods,
              },
            };
          } catch (e) {
            return {
              name: 'Stripe Status check',
              status: 'DOWN',
              message: 'The mock paymentAPI is down for some reason. Please check the logs for more details.',
              details: {
                error: e,
              },
            };
          }
        },
      ],
      metadataFn: async () => ({
        name: packageJSON.name,
        description: packageJSON.description,
        '@commercetools/connect-payments-sdk': packageJSON.dependencies['@commercetools/connect-payments-sdk'],
        stripe: packageJSON.dependencies['stripe'],
      }),
    })();

    return handler.body;
  }

  /**
   * Get supported payment components
   *
   * @remarks
   * Implementation to provide the mocking payment components supported by the processor.
   *
   * @returns Promise with mocking data containing a list of supported payment components
   */
  public async getSupportedPaymentComponents(): Promise<SupportedPaymentComponentsSchemaDTO> {
    return {
      dropins: [
        {
          type: 'embedded',
        },
      ],
      components: [],
    };
  }

  /**
   * Capture payment in Stripe.
   *
   * @remarks
   * MVP: capture the total amount
   *
   * @param {CapturePaymentRequest} request - Information about the ct payment and the amount.
   * @returns Promise with mocking data containing operation status and PSP reference
   */
  public async capturePayment(request: CapturePaymentRequest): Promise<PaymentProviderModificationResponse> {
    try {
      const paymentIntentId = request.payment.interfaceId as string;
      const amount = request.amount.centAmount;
      const response = await stripeApi().paymentIntents.capture(paymentIntentId, {
        amount_to_capture: amount,
      });

      if (response.status === 'succeeded') {
        return {
          outcome: PaymentModificationStatus.APPROVED,
          pspReference: response.id,
        };
      } else {
        log.warn('Stripe capture did not succeed as expected', { status: response.status, id: response.id });
        return {
          outcome: PaymentModificationStatus.REJECTED,
          pspReference: response.id,
        };
      }
    } catch (error) {
      log.error('Error capturing payment in Stripe', { error });
      return {
        outcome: PaymentModificationStatus.REJECTED,
        pspReference: request.payment.interfaceId as string,
      };
    }
  }

  /**
   * Cancel payment in Stripe.
   *
   * @param {CancelPaymentRequest} request - contains amount and {@link https://docs.commercetools.com/api/projects/payments | Payment } defined in composable commerce
   * @returns Promise with mocking data containing operation status and PSP reference
   */
  public async cancelPayment(request: CancelPaymentRequest): Promise<PaymentProviderModificationResponse> {
    try {
      const paymentIntentId = request.payment.interfaceId as string;
      await stripeApi().paymentIntents.cancel(paymentIntentId);
      return { outcome: PaymentModificationStatus.APPROVED, pspReference: paymentIntentId };
    } catch (error) {
      log.error('Error canceling payment in Stripe', { error });
      return {
        outcome: PaymentModificationStatus.REJECTED,
        pspReference: request.payment.interfaceId as string,
      };
    }
  }

  /**
   * Refund payment in Stripe.
   *
   * @param {RefundPaymentRequest} request - contains amount and {@link https://docs.commercetools.com/api/projects/payments | Payment } defined in composable commerce
   * @returns Promise with mocking data containing operation status and PSP reference
   */
  public async refundPayment(request: RefundPaymentRequest): Promise<PaymentProviderModificationResponse> {
    try {
      const paymentIntentId = request.payment.interfaceId as string;
      const amount = request.amount.centAmount;
      await stripeApi().refunds.create({
        payment_intent: paymentIntentId,
        amount: amount,
      });
      return { outcome: PaymentModificationStatus.RECEIVED, pspReference: paymentIntentId };
    } catch (error) {
      log.error('Error refunding payment in Stripe', { error });
      return {
        outcome: PaymentModificationStatus.REJECTED,
        pspReference: request.payment.interfaceId as string,
      };
    }
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
      const ctCustomerId = cart.customerId;
      if (!ctCustomerId) {
        log.warn('Cart does not have a customerId - Skipping customer creation');
        return;
      }

      const customer = await this.getCtCustomer(ctCustomerId);
      if (!customer) {
        log.info('Customer not found - Skipping customer creation');
        return;
      }

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

  /**
   * Creates a payment intent using the Stripe API and create commercetools payment with Initial transaction.
   *
   * @return Promise<PaymentResponseSchemaDTO> A Promise that resolves to a PaymentResponseSchemaDTO object containing the client secret and payment reference.
   */
  public async createPaymentIntentStripe(): Promise<PaymentResponseSchemaDTO> {
    const config = getConfig();
    const ctCart = await this.ctCartService.getCart({ id: getCartIdFromContext() });
    const customer = await this.getCtCustomer(ctCart.customerId!);
    const shippingAddress = this.getStripeCustomerAddress(ctCart.shippingAddress, customer?.addresses[0]);
    const amountPlanned = await this.ctCartService.getPaymentAmount({ cart: ctCart });
    const captureMethodConfig = config.stripeCaptureMethod;
    const merchantReturnUrl = getMerchantReturnUrlFromContext() || config.merchantReturnUrl;
    const setupFutureUsage = config.stripeSavedPaymentMethodConfig?.payment_method_save_usage;
    const stripeCustomerId = customer?.custom?.fields?.[stripeCustomerIdCustomType.fieldDefinitions[0].name];

    let paymentIntent!: Stripe.PaymentIntent;

    try {
      const idempotencyKey = crypto.randomUUID();
      paymentIntent = await stripeApi().paymentIntents.create(
        {
          ...(stripeCustomerId && {
            customer: stripeCustomerId,
            setup_future_usage: setupFutureUsage,
          }),
          amount: amountPlanned.centAmount,
          currency: amountPlanned.currencyCode,
          automatic_payment_methods: {
            enabled: true,
          },
          capture_method: captureMethodConfig as CaptureMethod,
          metadata: {
            cart_id: ctCart.id,
            ct_project_key: config.projectKey,
            ...(ctCart.customerId ? { ct_customer_id: ctCart.customerId } : null),
          },
          shipping: shippingAddress,
        },
        {
          idempotencyKey,
        },
      );
    } catch (e) {
      throw wrapStripeError(e);
    }

    log.info(`Stripe PaymentIntent created.`, {
      ctCartId: ctCart.id,
      stripePaymentIntentId: paymentIntent.id,
    });

    const ctPayment = await this.ctPaymentService.createPayment({
      amountPlanned,
      paymentMethodInfo: {
        paymentInterface: getPaymentInterfaceFromContext() || 'stripe',
        method: 'payment',
      },
      ...(ctCart.customerId && {
        customer: {
          typeId: 'customer',
          id: ctCart.customerId,
        },
      }),
      ...(!ctCart.customerId &&
        ctCart.anonymousId && {
          anonymousId: ctCart.anonymousId,
        }),
      transactions: [
        {
          type: PaymentTransactions.AUTHORIZATION,
          amount: amountPlanned,
          state: this.convertPaymentResultCode(PaymentOutcome.INITIAL as PaymentOutcome),
          interactionId: paymentIntent.id,
        },
      ],
    });

    await this.ctCartService.addPayment({
      resource: {
        id: ctCart.id,
        version: ctCart.version,
      },
      paymentId: ctPayment.id,
    });

    log.info(`commercetools Payment and initial transaction created.`, {
      ctCartId: ctCart.id,
      ctPayment: ctPayment.id,
      stripePaymentIntentId: paymentIntent.id,
      merchantReturnUrl: merchantReturnUrl,
    });

    try {
      const idempotencyKey = crypto.randomUUID();
      await stripeApi().paymentIntents.update(
        paymentIntent.id,
        {
          metadata: {
            ct_payment_id: ctPayment.id,
          },
        },
        { idempotencyKey },
      );
    } catch (e) {
      throw wrapStripeError(e);
    }

    log.info(`Stripe update Payment id metadata.`);

    return {
      sClientSecret: paymentIntent.client_secret ?? '',
      paymentReference: ctPayment.id,
      merchantReturnUrl: merchantReturnUrl,
      cartId: ctCart.id,
      ...(config.stripeCollectBillingAddress !== 'auto' && {
        billingAddress: this.getBillingAddress(ctCart),
      }),
    };
  }

  /**
   * Update the PaymentIntent in Stripe to mark the Authorization in commercetools as successful.
   *
   * @param {string} paymentIntentId - The Intent id created in Stripe.
   * @param {string} paymentReference - The identifier of the payment associated with the PaymentIntent in Stripe.
   * @return {Promise<void>} - A Promise that resolves when the PaymentIntent is successfully updated.
   */
  public async updatePaymentIntentStripeSuccessful(paymentIntentId: string, paymentReference: string): Promise<void> {
    try {
      const ctCart = await this.ctCartService.getCart({
        id: getCartIdFromContext(),
      });
      const ctPayment = await this.ctPaymentService.getPayment({
        id: paymentReference,
      });
      const amountPlanned = ctPayment.amountPlanned;

      log.info(`PaymentIntent confirmed.`, {
        ctCartId: ctCart.id,
        stripePaymentIntentId: ctPayment.interfaceId,
        amountPlanned: JSON.stringify(amountPlanned),
      });

      await this.ctPaymentService.updatePayment({
        id: ctPayment.id,
        pspReference: paymentIntentId,
        transaction: {
          interactionId: paymentIntentId,
          type: PaymentTransactions.AUTHORIZATION,
          amount: amountPlanned,
          state: this.convertPaymentResultCode(PaymentOutcome.AUTHORIZED as PaymentOutcome),
        },
      });
    } catch (error) {
      console.log('updatePaymentIntentStripeSuccessful error', JSON.stringify(error, null, 2));
    }
  }

  /**
   * Return the Stripe payment configuration and the cart amount planed information.
   *
   * @return {Promise<ConfigElementResponseSchemaDTO>} Returns a promise that resolves with the cart information, appearance, and capture method.
   */
  public async initializeCartPayment(paymentType: string): Promise<ConfigElementResponseSchemaDTO> {
    const {
      stripePaymentElementAppearance,
      stripeExpressCheckoutAppearance,
      stripeCaptureMethod,
      stripeSavedPaymentMethodConfig,
      stripeLayout,
      stripeCollectBillingAddress,
    } = getConfig();
    const ctCart = await this.ctCartService.getCart({ id: getCartIdFromContext() });
    const amountPlanned = await this.ctCartService.getPaymentAmount({ cart: ctCart });
    const webElement = paymentType; //getConfig().stripeWebElements;
    const appearance =
      webElement === 'paymentElement' ? stripePaymentElementAppearance : stripeExpressCheckoutAppearance;
    const setupFutureUsage = stripeSavedPaymentMethodConfig.payment_method_save_usage!;

    log.info(`Cart and ${webElement} config retrieved.`, {
      cartId: ctCart.id,
      cartInfo: {
        amount: amountPlanned.centAmount,
        currency: amountPlanned.currencyCode,
      },
      stripeElementAppearance: appearance,
      stripeCaptureMethod: stripeCaptureMethod,
      webElements: webElement,
      stripeSetupFutureUsage: setupFutureUsage,
      layout: stripeLayout,
      collectBillingAddress: stripeCollectBillingAddress,
    });

    return {
      cartInfo: {
        amount: amountPlanned.centAmount,
        currency: amountPlanned.currencyCode,
      },
      appearance: appearance,
      captureMethod: stripeCaptureMethod,
      webElements: webElement,
      setupFutureUsage: setupFutureUsage,
      layout: stripeLayout,
      collectBillingAddress: stripeCollectBillingAddress as CollectBillingAddressOptions,
    };
  }

  /**
   * Return the Stripe payment configuration and the cart amount planed information.
   *
   * @return {Promise<ConfigElementResponseSchemaDTO>} Returns a promise that resolves with the cart information, appearance, and capture method.
   */
  public applePayConfig(): string {
    return getConfig().stripeApplePayWellKnown;
  }

  private convertPaymentResultCode(resultCode: PaymentOutcome): string {
    switch (resultCode) {
      case PaymentOutcome.AUTHORIZED:
        return 'Success';
      case PaymentOutcome.REJECTED:
        return 'Failure';
      default:
        return 'Initial';
    }
  }

  /**
   * Retrieves modified payment data based on the given Stripe event.
   *
   * @param {Stripe.Event} event - The Stripe event object to extract data from.
   * @return {ModifyPayment} - An object containing modified payment data.
   */
  public async processStripeEvent(event: Stripe.Event): Promise<void> {
    log.info('Processing notification', { event: JSON.stringify(event.id) });
    try {
      const updateData = this.stripeEventConverter.convert(event);

      for (const tx of updateData.transactions) {
        const updatedPayment = await this.ctPaymentService.updatePayment({
          id: updateData.id,
          pspReference: updateData.pspReference,
          transaction: tx,
        });

        log.info('Payment updated after processing the notification', {
          paymentId: updatedPayment.id,
          version: updatedPayment.version,
          pspReference: updateData.pspReference,
          paymentMethod: updateData.paymentMethod,
          transaction: JSON.stringify(tx),
        });
      }

      if (event.type === StripeEvent.PAYMENT_INTENT__SUCCEEDED) {
        const ctCart = await this.ctCartService.getCartByPaymentId({ paymentId: updateData.id });
        await this.createOrder(ctCart, updateData.pspReference);
      }
    } catch (e) {
      log.error('Error processing notification', { error: e });
      return;
    }
  }

  public async createOrder(cart: Cart, paymentIntent: string | undefined) {
    const apiClient = paymentSDK.ctAPI.client;
    const order = await apiClient
      .orders()
      .post({
        body: {
          cart: {
            id: cart.id,
            typeId: 'cart',
          },
          shipmentState: 'Pending',
          orderState: 'Open',
          version: cart.version,
          paymentState: 'Paid',
        },
      })
      .execute();

    const idempotencyKey = crypto.randomUUID();

    if (paymentIntent)
      await stripeApi().paymentIntents.update(
        paymentIntent,
        {
          metadata: {
            ct_order_id: order.body.id,
          },
        },
        { idempotencyKey },
      );
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

    //TODO: Get the stripeCustomer from Customer info, not from cart
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
      const customer = await stripeApi().customers.retrieve(stripeCustomerId);
      return Boolean(customer && !customer.deleted && customer.metadata?.ct_customer_id === ctCustomerId);
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
      const query = `metadata['ct_customer_id']:'${ctCustomerId}'`;
      const customer = await stripeApi().customers.search({ query });
      return customer.data[0];
    } catch (e) {
      log.warn(`Error finding Stripe customer for ctCustomerId: ${ctCustomerId}`, { error: e });
      return undefined;
    }
  }

  public async createStripeCustomer(cart: Cart, customer: Customer): Promise<Stripe.Customer | undefined> {
    const shippingAddress = this.getStripeCustomerAddress(customer.addresses[0], cart.shippingAddress);
    const email = cart.customerEmail || customer.email || cart.shippingAddress?.email;
    return await stripeApi().customers.create({
      email,
      name: `${customer.firstName} ${customer.lastName}`.trim() || shippingAddress?.name,
      phone: shippingAddress?.phone,
      metadata: {
        ...(cart.customerId ? { ct_customer_id: customer.id } : null),
      },
      ...(shippingAddress?.address ? { address: shippingAddress.address } : null),
    });
  }

  public async saveStripeCustomerId(stripeCustomerId: string, customer: Customer): Promise<boolean> {
    // TODO: commercetools insights on how to integrate the Stripe accountId into commercetools:
    // We have plans to support recurring payments and saved payment methods in the next quarters.
    // Not sure if you can wait until that so your implementation would be aligned with ours.
    const customFieldName = stripeCustomerIdCustomType.fieldDefinitions[0].name;
    const latestCustomer = await this.getCtCustomer(customer.id);
    const response = await paymentSDK.ctAPI.client
      .customers()
      .withId({ ID: latestCustomer!.id })
      .post({
        body: {
          version: latestCustomer!.version,
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
    return await stripeApi().customerSessions.create({
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
    const stripe = stripeApi();
    const res = await stripe.ephemeralKeys.create(
      { customer: stripeCustomerId },
      { apiVersion: config.stripeApiVersion },
    );
    return res?.secret;
  }

  public async getCtCustomer(ctCustomerId: string): Promise<Customer | void> {
    return await paymentSDK.ctAPI.client
      .customers()
      .withId({ ID: ctCustomerId })
      .get()
      .execute()
      .then((response) => response.body)
      .catch((err) => {
        log.warn(`Customer not found ${ctCustomerId}`, { error: err });
        return;
      });
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

    const getField = (field: keyof Address): string | null => {
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
