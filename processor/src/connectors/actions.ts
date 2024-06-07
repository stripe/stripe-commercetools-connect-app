import Stripe from 'stripe';
import { getConfig } from '../config/config';
import { log } from '../libs/logger/index';
import { stripeApi } from '../clients/stripe.client';

export async function stripeWebhooksSetup(): Promise<void> {
  try {
    const processorAppEndpoint = await getProcessorAppEndpoint();

    const webhookEndpoint: Stripe.Response<Stripe.WebhookEndpoint> = await stripeApi().webhookEndpoints.create({
      enabled_events: [
        'payment_intent.payment_failed',
        'payment_intent.succeeded',
        'payment_intent.amount_capturable_updated',
        'charge.refunded',
        'payment_intent.canceled',
      ],
      url: `${processorAppEndpoint}stripe/webhooks`,
    });

    process.env.STRIPE_WEBHOOK_SECRET = webhookEndpoint.secret;
    // save this for pre-undeploy script (delete webhook if the deployment is deleted)
    process.env.STRIPE_WEBHOOK_ID = webhookEndpoint.id;
    log.info('--->>> at stripeWebhooksSetup(), STRIPE_WEBHOOK_SECRET: ' + process.env.STRIPE_WEBHOOK_SECRET);

    log.info(JSON.stringify(webhookEndpoint));
  } catch (error) {
    log.error('[REGISTER_STRIPE_WEBHOOK]', error);
  }
}

async function getProcessorAppEndpoint(): Promise<string> {
  let endpoint = '';

  const deployments = await getDeploymentByKey();

  deployments.results.forEach((deployment: any) => {
    const appsProcessor = deployment.applications.filter((app: any) => app.applicationName === 'processor');

    appsProcessor.forEach((app: any) => {
      app.securedConfiguration.forEach((config: any) => {
        if (config.key === 'STRIPE_SECRET_KEY') {
          endpoint = app.url;
        }
      });
    });
  });

  return endpoint;
}

async function getDeploymentByKey() {
  const accessToken = await getAccessToken();
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };

  return await fetch(`${getConfig().connectUrl}/${getConfig().projectKey}/deployments`, {
    method: 'GET',
    headers,
  },
  )
    .then((response) => {
      if (response.ok) {
        return response.json();
      }

      throw new Error(`Status ${response.status}`);
    })
    .then((data) => {
      return data;
    })
    .catch((error) => {
      log.error(`Error at getting deployment information from commercetools`, error);
      throw new Error(error);
    });
}

async function getAccessToken() {
  const credentials = `${getConfig().clientId}:${getConfig().clientSecret}`;
  const basicAuthHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;
  const headers = {
    Accept: 'application/json',
    Authorization: `${basicAuthHeader}`,
  };

  return await fetch(`${getConfig().authUrl}/oauth/token?grant_type=client_credentials&scope=${getConfig().scope}`, {
    method: 'POST',
    headers,
  })
    .then((response) => {
      if (response.ok) {
        return response.json();
      }

      throw new Error(`Status ${response.status}`);
    })
    .then((data) => {
      return data.access_token;
    })
    .catch((error) => {
      log.error(`Error at getting authentication token from commercetools`, error);
      throw new Error(error);
    });
}