import { describe, expect, test, beforeEach, afterEach, jest } from '@jest/globals';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('subscriptionPaymentHandling', () => {
    test('should default to createOrder when no environment variable is set', () => {
      delete process.env.STRIPE_SUBSCRIPTION_PAYMENT_HANDLING;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      const config = Config.getConfig();
      expect(config.subscriptionPaymentHandling).toBe('createOrder');
    });

    test('should use environment variable value when set to createOrder', () => {
      process.env.STRIPE_SUBSCRIPTION_PAYMENT_HANDLING = 'createOrder';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      const config = Config.getConfig();
      expect(config.subscriptionPaymentHandling).toBe('createOrder');
    });

    test('should use environment variable value when set to addPaymentToOrder', () => {
      process.env.STRIPE_SUBSCRIPTION_PAYMENT_HANDLING = 'addPaymentToOrder';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      const config = Config.getConfig();
      expect(config.subscriptionPaymentHandling).toBe('addPaymentToOrder');
    });

    test('should use environment variable value when set to upcomingInvoice', () => {
      process.env.STRIPE_SUBSCRIPTION_PAYMENT_HANDLING = 'upcomingInvoice';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      const config = Config.getConfig();
      expect(config.subscriptionPaymentHandling).toBe('upcomingInvoice');
    });

    test('should have correct type definition', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      const config = Config.getConfig();
      // This test ensures TypeScript compilation works with the new type
      expect(['createOrder', 'addPaymentToOrder', 'upcomingInvoice']).toContain(config.subscriptionPaymentHandling);
    });
  });

  describe('getConfig function', () => {
    test('should return the same config object on multiple calls', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      const config1 = Config.getConfig();
      const config2 = Config.getConfig();
      expect(config1).toBe(config2);
    });

    test('should return config with all required properties', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      const config = Config.getConfig();
      expect(config).toHaveProperty('projectKey');
      expect(config).toHaveProperty('stripeSecretKey');
      expect(config).toHaveProperty('subscriptionPaymentHandling');
    });
  });
});
