import * as dotenv from 'dotenv';
dotenv.config();
import { removeCustomerCustomType, removeLineItemCustomType, removeProductTypeSubscription } from './actions';

async function preUndeploy() {
  await removeProductTypeSubscription();
  await removeLineItemCustomType();
  await removeCustomerCustomType();
}

export async function run() {
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
