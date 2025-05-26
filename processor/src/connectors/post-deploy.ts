import * as dotenv from 'dotenv';
dotenv.config();

import {
  createCustomerCustomType,
  createLaunchpadPurchaseOrderNumberCustomType,
  createLineItemCustomType,
  createProductTypeSubscription,
  retrieveWebhookEndpoint,
  updateWebhookEndpoint,
} from './actions';

const STRIPE_WEBHOOKS_ROUTE = 'stripe/webhooks';
const CONNECT_SERVICE_URL = 'CONNECT_SERVICE_URL';
const STRIPE_WEBHOOK_ID = 'STRIPE_WEBHOOK_ID';
const msgError = 'Post-deploy failed:';

async function postDeploy(properties: Map<string, unknown>) {
  await createLaunchpadPurchaseOrderNumberCustomType();

  const applicationUrl = properties.get(CONNECT_SERVICE_URL) as string;
  const stripeWebhookId = (properties.get(STRIPE_WEBHOOK_ID) as string) ?? '';

  if (properties) {
    if (stripeWebhookId === '') {
      process.stderr.write(
        `${msgError} STRIPE_WEBHOOK_ID var is not assigned. Add the connector URL manually on the Stripe Webhook Dashboard\n`,
      );
    } else {
      const we = await retrieveWebhookEndpoint(stripeWebhookId);
      const weAppUrl = `${applicationUrl}${STRIPE_WEBHOOKS_ROUTE}`;
      if (we?.url !== weAppUrl) {
        await updateWebhookEndpoint(stripeWebhookId, weAppUrl);
      }
    }
  }

  await createProductTypeSubscription();
  await createLineItemCustomType();
  await createCustomerCustomType();
}

export async function runPostDeployScripts() {
  try {
    const properties = new Map(Object.entries(process.env));
    await postDeploy(properties);
  } catch (error) {
    if (error instanceof Error) {
      process.stderr.write(`Post-deploy failed: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}

runPostDeployScripts();
