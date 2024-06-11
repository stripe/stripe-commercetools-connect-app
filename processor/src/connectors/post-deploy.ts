import dotenv from 'dotenv';
dotenv.config();

import { stripeWebhooksSetup } from './actions';
import { log } from '../libs/logger/index';

const CONNECT_APPLICATION_URL_KEY = 'CONNECT_SERVICE_URL';

async function postDeploy(properties: any) {
  log.info('--->>> Executing postDeploy() -> ' + JSON.stringify(properties));

  const applicationUrl = properties.get(CONNECT_APPLICATION_URL_KEY);

  if (properties) {
    await stripeWebhooksSetup(applicationUrl);
  }
}

async function runPostDeployScripts() {
  try {
    const properties = new Map(Object.entries(process.env));
    log.info('--->>> Executing runPostDeployScripts()');
    await postDeploy(properties);
  } catch (error) {
    if (error instanceof Error) {
      process.stderr.write(`Post-deploy failed: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}

runPostDeployScripts();
