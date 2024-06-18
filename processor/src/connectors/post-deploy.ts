import dotenv from 'dotenv';
dotenv.config();

import { retrieveWebhookEndpoint, updateWebhookEndpoint } from './actions';

const STRIPE_WEBHOOKS_ROUTE = 'stripe/webhooks';
const CONNECT_SERVICE_URL = 'CONNECT_SERVICE_URL';
const STRIPE_WEBHOOK_ID = 'STRIPE_WEBHOOK_ID';

async function postDeploy(properties: any) {
  const applicationUrl = properties.get(CONNECT_SERVICE_URL);
  const stripeWebhookId = properties.get(STRIPE_WEBHOOK_ID) || '';

  if (properties) {
    const we = await retrieveWebhookEndpoint(stripeWebhookId);
    const weAppUrl = `${applicationUrl}${STRIPE_WEBHOOKS_ROUTE}`;
    if (we.url !== weAppUrl) {
      updateWebhookEndpoint(stripeWebhookId, weAppUrl);
    }
  }
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
