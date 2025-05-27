import {
  launchpadPurchaseOrderCustomType,
  stripeCustomerIdCustomType,
  productTypeSubscription,
  typeLineItem,
} from '../custom-types/custom-types';
import { log } from '../libs/logger';
import Stripe from 'stripe';
import { stripeApi } from '../clients/stripe.client';
import { getTypeByKey } from '../services/commerce-tools/custom-type-client';
import {
  createProductType,
  deleteProductType,
  getProductsByProductTypeId,
  getProductTypeByKey,
} from '../services/commerce-tools/product-type-client';
import { addOrUpdateCustomType, deleteOrUpdateCustomType } from '../services/commerce-tools/custom-type-helper';

export async function handleRequest({
  loggerId,
  startMessage,
  throwError = true,
  fn,
}: {
  loggerId: string;
  startMessage: string;
  throwError?: boolean;
  fn: () => void;
}): Promise<void> {
  try {
    log.info(`${loggerId} ${startMessage}`);
    fn();
  } catch (error) {
    log.error(loggerId, error);
    if (throwError) {
      throw error;
    }
  }
}

export async function createLaunchpadPurchaseOrderNumberCustomType(): Promise<void> {
  const getRes = await getTypeByKey(launchpadPurchaseOrderCustomType.key);
  if (getRes) {
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

export async function createCustomerCustomType(): Promise<void> {
  await handleRequest({
    loggerId: '[CREATE_CUSTOMER_CUSTOM_TYPE]',
    startMessage: 'Starting the process for creating "Customer" Custom Type.',
    fn: async () => await addOrUpdateCustomType(stripeCustomerIdCustomType),
  });
}

export async function createLineItemCustomType(): Promise<void> {
  await handleRequest({
    loggerId: '[CREATE_LINE_ITEM_CUSTOM_TYPE]',
    startMessage: 'Starting the process for creating "Line Item" Custom Type.',
    fn: async () => await addOrUpdateCustomType(typeLineItem),
  });
}

export async function removeLineItemCustomType(): Promise<void> {
  await handleRequest({
    loggerId: '[REMOVE_LINE_ITEM_CUSTOM_TYPE]',
    startMessage: 'Starting the process for removing "Line Item" Custom Type.',
    fn: async () => await deleteOrUpdateCustomType(typeLineItem),
  });
}

export async function removeCustomerCustomType(): Promise<void> {
  await handleRequest({
    loggerId: '[REMOVE_CUSTOMER_CUSTOM_TYPE]',
    startMessage: 'Starting the process for removing "Customer" Custom Type.',
    fn: async () => {
      await deleteOrUpdateCustomType(stripeCustomerIdCustomType);
    },
  });
}

export async function createProductTypeSubscription(): Promise<void> {
  await handleRequest({
    loggerId: '[CREATE_PRODUCT_TYPE_SUBSCRIPTION]',
    startMessage: 'Starting the process for creating Product Type "Subscription".',
    fn: async () => {
      const productType = await getProductTypeByKey(productTypeSubscription.key!);
      if (productType) {
        log.info('Product type subscription already exists. Skipping creation.');
      } else {
        const newProductType = await createProductType(productTypeSubscription);
        log.info(`Product Type "${newProductType.key}" created successfully.`);
      }
    },
  });
}

export async function removeProductTypeSubscription(): Promise<void> {
  await handleRequest({
    loggerId: '[REMOVE_PRODUCT_TYPE_SUBSCRIPTION]',
    startMessage: 'Starting the process for removing Product Type "Subscription".',
    fn: async () => {
      const productTypeKey = productTypeSubscription.key!;
      const productType = await getProductTypeByKey(productTypeKey);
      if (!productType) {
        log.info(`Product Type "${productTypeKey}" is already deleted. Skipping deletion.`);
        return;
      }

      const products = await getProductsByProductTypeId(productType?.id);
      if (products.length) {
        log.warn(`Product Type "${productTypeKey}" is in use. Skipping deletion.`);
      } else {
        await deleteProductType({ key: productTypeKey, version: productType.version });
        log.info(`Product Type "${productTypeKey}" deleted successfully.`);
      }
    },
  });
}
