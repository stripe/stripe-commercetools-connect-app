import * as dotenv from 'dotenv';
dotenv.config();

import {
  createLaunchpadPurchaseOrderNumberCustomType,
  createStripeCustomTypeForCustomer,
  retrieveWebhookEndpoint,
  updateWebhookEndpoint,
} from './actions';

const STRIPE_WEBHOOKS_ROUTE = 'stripe/webhooks';
const CONNECT_SERVICE_URL = 'CONNECT_SERVICE_URL';
const STRIPE_WEBHOOK_ID = 'STRIPE_WEBHOOK_ID';
const msgError = 'Post-deploy failed:';

async function postDeploy(_properties: Map<string, unknown>) {
  await createLaunchpadPurchaseOrderNumberCustomType();

  const applicationUrl = _properties.get(CONNECT_SERVICE_URL) as string;
  const stripeWebhookId = (_properties.get(STRIPE_WEBHOOK_ID) as string) ?? '';

  if (_properties) {
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

  await createStripeCustomTypeForCustomer();
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
