import dotenv from 'dotenv';
dotenv.config();

import { deleteStripeWebhook } from './actions';

async function preUndeploy() {
  await deleteStripeWebhook();
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
