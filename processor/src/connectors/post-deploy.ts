import dotenv from 'dotenv';
dotenv.config();

import { retrieveWebhookEndpoint, updateWebhookEndpoint } from './actions';

const STRIPE_WEBHOOKS_ROUTE = 'stripe/webhooks';
const CONNECT_SERVICE_URL = 'CONNECT_SERVICE_URL';
const STRIPE_WEBHOOK_ID = 'STRIPE_WEBHOOK_ID';
const msgError = 'Post-deploy failed:';

async function postDeploy(properties: any) {
  const applicationUrl = properties.get(CONNECT_SERVICE_URL);
  const stripeWebhookId = properties.get(STRIPE_WEBHOOK_ID) ?? '';

  if (properties) {
    if (stripeWebhookId === '') {
      process.stderr.write(`${msgError} STRIPE_WEBHOOK_ID var is not assigned.\n`);
    } else {
      const we = await retrieveWebhookEndpoint(stripeWebhookId);
      const weAppUrl = `${applicationUrl}${STRIPE_WEBHOOKS_ROUTE}`;
      if (we.url !== weAppUrl) {
        updateWebhookEndpoint(stripeWebhookId, weAppUrl);
      }
    }
  }
}

export async function runPostDeployScripts() {
  try {
    const properties = new Map(Object.entries(process.env));

    await postDeploy(properties);
  } catch (error) {
    if (error instanceof Error) {
      process.stderr.write(`${msgError} ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}

runPostDeployScripts();