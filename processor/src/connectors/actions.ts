import {
  launchpadPurchaseOrderCustomType,
  stripeCustomerIdCustomType,
  productTypeSubscription,
  typeLineItem,
} from '../custom-types/custom-types';
import { log } from '../libs/logger';
import { paymentSDK } from '../payment-sdk';
import Stripe from 'stripe';
import { stripeApi } from '../clients/stripe.client';
import { TypeDraft } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/type';
import { createCustomerCustomType, getTypeByKey } from '../helpers/customTypeHelper';

export async function createLaunchpadPurchaseOrderNumberCustomType(): Promise<void> {
  const apiClient = paymentSDK.ctAPI.client;

  const getRes = await apiClient
    .types()
    .get({ queryArgs: { where: `key="${launchpadPurchaseOrderCustomType.key}"` } })
    .execute();

  if (getRes.body.results.length) {
    log.info('Launchpad purchase order number custom type already exists. Skipping creation.');
  }
}

export async function retrieveWebhookEndpoint(weId: string): Promise<Stripe.WebhookEndpoint | undefined> {
  log.info(`[RETRIEVE_WEBHOOK_ENDPOINT] Starting the process for retrieving webhook endpoint[${weId}].`);

  try {
    return await stripeApi().webhookEndpoints.retrieve(weId);
  } catch (error) {
    log.error('[RETRIEVE_WEBHOOK_ENDPOINT]', error);
  }
}

export async function updateWebhookEndpoint(weId: string, weAppUrl: string): Promise<void> {
  log.info(
    `[UPDATE_WEBHOOK_ENDPOINT] Starting the process for updating webhook endpoint[${weId}] with url[${weAppUrl}].`,
  );

  try {
    await stripeApi().webhookEndpoints.update(weId, {
      enabled_events: [
        'charge.succeeded',
        'charge.captured',
        'payment_intent.succeeded',
        'charge.refunded',
        'payment_intent.canceled',
        'payment_intent.payment_failed',
        'payment_intent.requires_action',
      ],
      url: weAppUrl,
    });
  } catch (error) {
    log.error('[UPDATE_WEBHOOK_ENDPOINT]', error);
  }
}

export async function createStripeCustomTypeForCustomer(): Promise<void> {
  try {
    log.info('[ENSURE_STRIPE_CUSTOM_TYPE] Starting the process for ensuring Stripe custom type exist.');

    const existingType = await getTypeByKey(stripeCustomerIdCustomType.key);

    if (!existingType) {
      log.info('[ENSURE_STRIPE_CUSTOM_TYPE] Creating Stripe custom type.');
      await createCustomerCustomType(stripeCustomerIdCustomType as TypeDraft);
    }
  } catch (error) {
    log.error('[ENSURE_STRIPE_CUSTOM_TYPE] Error occurred while ensuring Stripe custom type.', error);
    throw new Error(error as string);
  }
}

export async function createProductTypeSubscription(): Promise<void> {
  log.info(`[CREATE_PRODUCT_TYPE_SUBSCRIPTION] Starting the process for creating product type subscription.`);

  try {
    const apiClient = paymentSDK.ctAPI.client;
    const keyLineItem = 'line-item-subscription';
    const keyProductType = 'subscription-information';

    const getResLineItem = await apiClient
      .types()
      .get({
        queryArgs: {
          where: `key="${keyLineItem}"`,
        },
      })
      .execute();

    if (getResLineItem.body.results.length) {
      log.info('Type line item for subscription already exists. Skipping creation.');
    } else {
      const createResLineItem = await apiClient
        .types()
        .post({
          body: typeLineItem,
        })
        .execute();
      log.info(`Type line item for subscription created successfully ${createResLineItem.body.id}.`);
    }

    const getResProductTypeSubscription = await apiClient
      .productTypes()
      .get({
        queryArgs: {
          where: `key="${keyProductType}"`,
        },
      })
      .execute();

    if (getResProductTypeSubscription.body.results.length) {
      log.info('Product type subscription already exists. Skipping creation.');
    } else {
      const createResProductTypeSubscription = await apiClient
        .productTypes()
        .post({
          body: productTypeSubscription,
        })
        .execute();
      log.info(`Product type subscription created successfully ${createResProductTypeSubscription.body.id}.`);
    }
  } catch (error: any) {
    log.error('[CREATE_PRODUCT_TYPE_SUBSCRIPTION]', error);
    throw new Error(error);
  }
}
