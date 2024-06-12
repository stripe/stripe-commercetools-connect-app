import dotenv from 'dotenv';
dotenv.config();

import { createStripeWebhook } from './actions';

const CONNECT_APPLICATION_URL_KEY = 'CONNECT_SERVICE_URL';

async function postDeploy(properties: any) {
  const applicationUrl = properties.get(CONNECT_APPLICATION_URL_KEY);

  if (properties) {
    await createStripeWebhook(applicationUrl);
  }
}

async function runPostDeployScripts() {
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
