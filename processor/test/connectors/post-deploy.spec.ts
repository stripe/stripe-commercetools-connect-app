import { describe, test, expect, jest, afterEach, beforeEach } from '@jest/globals';
import * as Actions from '../../src/connectors/actions';
import * as PostDeploy from '../../src/connectors/post-deploy';
import { mock_Stripe_retrieveWebhookEnpoints_response } from '../utils/mock-actions-data';

jest.mock('../../src/connectors/actions');

describe('runPostDeployScripts', () => {
  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should update the webhook endpoint URL when the URLs are different', async () => {
    process.env = { CONNECT_SERVICE_URL: 'https://yourApp.com/', STRIPE_WEBHOOK_ID: 'we_11111' };

    const mockRetrieveWe = jest
      .spyOn(Actions, 'retrieveWebhookEndpoint')
      .mockResolvedValue(mock_Stripe_retrieveWebhookEnpoints_response);
    const mockUpdateWe = jest.spyOn(Actions, 'updateWebhookEndpoint').mockResolvedValue();

    await PostDeploy.runPostDeployScripts();

    expect(mockRetrieveWe).toHaveBeenCalled();
    expect(mockUpdateWe).toHaveBeenCalled();
  });

  test('should not update the webhook endpoint URL when the URLs are the same', async () => {
    process.env = { CONNECT_SERVICE_URL: 'https://myApp.com/', STRIPE_WEBHOOK_ID: 'we_11111' };

    const mockRetrieveWe = jest
      .spyOn(Actions, 'retrieveWebhookEndpoint')
      .mockResolvedValue(mock_Stripe_retrieveWebhookEnpoints_response);
    const mockUpdateWe = jest.spyOn(Actions, 'updateWebhookEndpoint').mockResolvedValue();

    await PostDeploy.runPostDeployScripts();

    expect(mockRetrieveWe).toHaveBeenCalled();
    expect(mockUpdateWe).toHaveBeenCalledTimes(0);
  });

  test('should throw an error when a call to Stripe throws an error', async () => {
    process.env = { CONNECT_SERVICE_URL: 'https://yourApp.com/', STRIPE_WEBHOOK_ID: 'we_11111' };
    process.exitCode = '0';

    const exitCodeMock = jest.fn();

    Object.defineProperty(process, 'exitCode', {
      configurable: true,
      get: () => undefined,
      set: exitCodeMock,
    });

    const mockError = new Error('No such webhook endpoint');
    const mockErrorMessage = `Post-deploy failed: ${mockError.message}\n`;
    const mockRetrieveWe = jest.spyOn(Actions, 'retrieveWebhookEndpoint').mockRejectedValueOnce(mockError);
    const writeSpy = jest.spyOn(process.stderr, 'write');

    await PostDeploy.runPostDeployScripts();

    expect(mockRetrieveWe).toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith(mockErrorMessage);
    expect(exitCodeMock).toHaveBeenCalledWith(1);
    Object.defineProperty(process, 'exitCode', {
      value: '0',
    });
  });

  test('should throw an error when the STRIPE_WEBHOOK_ID var is not assigned', async () => {
    process.env = { CONNECT_SERVICE_URL: 'https://yourApp.com/' };

    const mockErrorMessage = `Post-deploy failed: STRIPE_WEBHOOK_ID var is not assigned. Add the connector URL manually on the Stripe Webhook Dashboard\n`;
    const writeSpy = jest.spyOn(process.stderr, 'write');

    await PostDeploy.runPostDeployScripts();

    expect(writeSpy).toHaveBeenCalledWith(mockErrorMessage);
  });
});
