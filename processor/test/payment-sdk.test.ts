import { setupPaymentSDK } from '@commercetools/connect-payments-sdk';
import { config } from '../src/config/config';
import { getRequestContext, updateRequestContext } from '../src/libs/fastify/context/context';
import { log } from '../src/libs/logger';
import { AppLogger } from '../src/payment-sdk';

jest.mock('@commercetools/connect-payments-sdk');
jest.mock('../src/config/config');
jest.mock('../src/libs/fastify/context/context');
jest.mock('../src/libs/logger/index', () => {
  return {
    log: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      // Add any additional methods as required by the library
    },
  };
});

describe('Payment-sdk test', () => {
  let logger: AppLogger;

  beforeEach(() => {
    logger = new AppLogger();
  });

  it('should log debug messages', () => {
    const debugSpy = jest.spyOn(log, 'debug');
    const message = 'Debug message';
    logger.debug({}, message);
    expect(debugSpy).toHaveBeenCalledWith(message, {});
  });

  it('should log info messages', () => {
    const infoSpy = jest.spyOn(log, 'info');
    const message = 'Info message';
    logger.info({}, message);
    expect(infoSpy).toHaveBeenCalledWith(message, {});
  });

  it('should log warn messages', () => {
    const warnSpy = jest.spyOn(log, 'warn');
    const message = 'Warn message';
    logger.warn({}, message);
    expect(warnSpy).toHaveBeenCalledWith(message, {});
  });

  it('should log error messages', () => {
    const errorSpy = jest.spyOn(log, 'error');
    const message = 'Error message';
    logger.error({}, message);
    expect(errorSpy).toHaveBeenCalledWith(message, {});
  });
});

describe('paymentSDK', () => {
  it('should set up payment SDK with the correct configuration', () => {
    expect(setupPaymentSDK).toHaveBeenCalledWith({
      apiUrl: config.apiUrl,
      authUrl: config.authUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      projectKey: config.projectKey,
      sessionUrl: config.sessionUrl,
      jwksUrl: config.jwksUrl,
      jwtIssuer: config.jwtIssuer,
      getContextFn: expect.any(Function),
      updateContextFn: expect.any(Function),
      logger: expect.any(AppLogger),
    });
  });

  it('should get context correctly', () => {
    const mockContext = {
      correlationId: 'test-correlation-id',
      requestId: 'test-request-id',
      authentication: {},
    };
    (getRequestContext as jest.Mock).mockReturnValue(mockContext);

    const sdkConfig = (setupPaymentSDK as jest.Mock).mock.calls[0][0];
    const context = sdkConfig.getContextFn();
    expect(context).toEqual(mockContext);
  });

  it('should update context correctly', () => {
    const mockUpdateContext = jest.fn();
    (updateRequestContext as jest.Mock).mockImplementation(mockUpdateContext);

    const contextUpdate = {
      correlationId: 'new-correlation-id',
      requestId: 'new-request-id',
      authentication: { user: 'test' },
    };

    const sdkConfig = (setupPaymentSDK as jest.Mock).mock.calls[0][0];
    sdkConfig.updateContextFn(contextUpdate);
    expect(mockUpdateContext).toHaveBeenCalledWith({
      correlationId: 'new-correlation-id',
      requestId: 'new-request-id',
      authentication: { user: 'test' },
    });
  });
});
