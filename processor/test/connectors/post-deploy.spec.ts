import { describe, test, expect, jest, afterEach, beforeEach } from '@jest/globals';
import * as Actions from '../../src/connectors/actions';
import * as PostDeploy from '../../src/connectors/post-deploy';
import { mock_Stripe_retrieveWebhookEnpoints_response } from '../utils/mock-actions-data';

jest.mock('../../src/connectors/actions');

describe('post-deploy', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = originalEnv;
  });

  test('runPostDeployScripts function succeded, should update the webhook endpoint URL when the URLs are different', async () => {
    process.env = { CONNECT_SERVICE_URL: 'https://yourApp.com/', STRIPE_WEBHOOK_ID: 'we_11111' };

    const mockRetrieveWe = jest
      .spyOn(Actions, 'retrieveWebhookEndpoint')
      .mockResolvedValue(mock_Stripe_retrieveWebhookEnpoints_response);
    const mockUpdateWe = jest.spyOn(Actions, 'updateWebhookEndpoint').mockResolvedValue();

    await PostDeploy.runPostDeployScripts();

    expect(mockRetrieveWe).toHaveBeenCalled();
    expect(mockUpdateWe).toHaveBeenCalled();
  });

  test('runPostDeployScripts function succeded, should not update the webhook endpoint URL when the URLs are the same', async () => {
    process.env = { CONNECT_SERVICE_URL: 'https://myApp.com/', STRIPE_WEBHOOK_ID: 'we_11111' };

    const mockRetrieveWe = jest
      .spyOn(Actions, 'retrieveWebhookEndpoint')
      .mockResolvedValue(mock_Stripe_retrieveWebhookEnpoints_response);
    const mockUpdateWe = jest.spyOn(Actions, 'updateWebhookEndpoint').mockResolvedValue();

    await PostDeploy.runPostDeployScripts();

    expect(mockRetrieveWe).toHaveBeenCalled();
    expect(mockUpdateWe).toHaveBeenCalledTimes(0);
  });

  test('runPostDeployScripts function failed, retrieveWebhookEndpoint() function throws an error and a log is recorded', async () => {
    process.env = { CONNECT_SERVICE_URL: 'https://yourApp.com/', STRIPE_WEBHOOK_ID: 'we_11111' };

    const mockError = new Error('No such webhook endpoint');
    const mockErrorMessage = `Post-deploy failed: ${mockError.message}\n`;
    const mockRetrieveWe = jest.spyOn(Actions, 'retrieveWebhookEndpoint').mockRejectedValueOnce(mockError);
    const writeSpy = jest.spyOn(process.stderr, 'write');

    await PostDeploy.runPostDeployScripts();

    expect(mockRetrieveWe).toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith(mockErrorMessage);
  });
});
