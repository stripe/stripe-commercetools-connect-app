import dotenv from 'dotenv';
dotenv.config();

import { log } from '../libs/logger/index';

async function preUndeploy() {
  // TODO: Implement pre undeploy scripts if any
  const webhookId = process.env.STRIPE_WEBHOOK_ID || '';
  log.info(`----->>>>> pre-undeploy script, stripe webhook id:[${webhookId}]`);
}

async function run() {
  try {
    await preUndeploy();
  } catch (error) {
    if (error instanceof Error) {
      process.stderr.write(`Post-undeploy failed: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}
run();
