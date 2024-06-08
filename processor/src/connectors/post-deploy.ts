import dotenv from 'dotenv';
dotenv.config();

import { stripeWebhooksSetup } from './actions';
import { log } from '../libs/logger/index';

async function postDeploy(properties: any) {
  log.info('--->>> Executing postDeploy() -> ' + JSON.stringify(properties));
  if (properties) {
    await stripeWebhooksSetup();
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
