import { stripeWebhooksSetup } from './actions';

async function postDeploy(properties: any) {
  if (properties) {
    await stripeWebhooksSetup();
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
