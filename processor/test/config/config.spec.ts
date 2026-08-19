import { describe, expect, test, beforeEach, afterEach, jest } from '@jest/globals';

describe('config', () => {
  const originalEnv = process.env;

  // Field-level problems are REPORTED and ignored rather than thrown (see validateBehaviorRule), so
  // the assertions below check console.error instead of a rejected boot. Spied rather than left to
  // print, so a passing run stays readable.
  let consoleError: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    consoleError.mockRestore();
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

  describe('stripePaymentBehaviorRules', () => {
    // Validation runs at module load time, so every case re-requires the module inside the
    // assertion. jest.resetModules() in beforeEach makes each require a fresh evaluation.

    test('should be undefined when the environment variable is absent', () => {
      delete process.env.STRIPE_PAYMENT_BEHAVIOR_RULES;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      expect(Config.getConfig().stripePaymentBehaviorRules).toBeUndefined();
    });

    test('should be undefined when the environment variable is an empty string', () => {
      process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      expect(Config.getConfig().stripePaymentBehaviorRules).toBeUndefined();
    });

    test('should parse a valid rules map', () => {
      process.env.STRIPE_PAYMENT_BEHAVIOR_RULES =
        '{"DE":{"euBankTransferCountry":"DE","captureMethod":"automatic"},"MX":{"captureMethod":"manual"}}';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      expect(Config.getConfig().stripePaymentBehaviorRules).toEqual({
        DE: { euBankTransferCountry: 'DE', captureMethod: 'automatic' },
        MX: { captureMethod: 'manual' },
      });
    });

    test('should parse an empty object', () => {
      process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{}';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      expect(Config.getConfig().stripePaymentBehaviorRules).toEqual({});
    });

    test('should ABORT STARTUP on malformed JSON, never silently yield {}', () => {
      // KI-017 / security finding H3: parseJSON() returns {} on error, which would drop every
      // per-country rule in silence and fall all carts back to STRIPE_CAPTURE_METHOD. A country
      // configured 'manual' would begin capturing at authorization with no error anywhere.
      process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{"bankTransfer":true}';
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../src/config/config');
      }).toThrow('STRIPE_PAYMENT_BEHAVIOR_RULES contains invalid JSON');
    });

    test('should abort startup when the value is a JSON array', () => {
      process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '[{"bankTransfer":true}]';
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../src/config/config');
      }).toThrow('must be a JSON object');
    });

    test('should abort startup when the value is JSON null', () => {
      process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = 'null';
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../src/config/config');
      }).toThrow('must be a JSON object');
    });

    test('should abort startup when a rule value is not an object', () => {
      process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":"manual"}';
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../src/config/config');
      }).toThrow('must be an object rule');
    });

    test('should abort startup when a rule value is an array', () => {
      process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":["manual"]}';
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../src/config/config');
      }).toThrow('must be an object rule');
    });

    test('should treat a whitespace-only value as not configured, not abort the deploy', () => {
      // A stray space in the CT Connect config UI must not brick a deployment.
      process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '   ';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      expect(Config.getConfig().stripePaymentBehaviorRules).toBeUndefined();
    });

    test('should tolerate surrounding whitespace around otherwise valid JSON', () => {
      process.env.STRIPE_PAYMENT_BEHAVIOR_RULES =
        '  {"DE":{"euBankTransferCountry":"DE","captureMethod":"automatic"}}  ';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      expect(Config.getConfig().stripePaymentBehaviorRules).toEqual({
        DE: { euBankTransferCountry: 'DE', captureMethod: 'automatic' },
      });
    });

    describe('per-field validation', () => {
      // Field-level validation is the difference between a config typo caught by a deploy check
      // and a config typo that breaks checkout for one country, at the till, for every shopper.

      test('should report and ignore when setupFutureUsage is null', () => {
        // Would otherwise pass boot and throw null.trim() inside createPaymentIntent, surfacing as
        // a wrapStripeError and looking like a Stripe fault rather than a config mistake.
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{"setupFutureUsage":null}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require('../../src/config/config')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('setupFutureUsage must be a string'));
      });

      test('should report and ignore when setupFutureUsage is a number', () => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{"setupFutureUsage":1}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require('../../src/config/config')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('setupFutureUsage must be a string'));
      });

      test('should report and ignore when setupFutureUsage is not a recognized value', () => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{"setupFutureUsage":"sometimes"}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require('../../src/config/config')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('setupFutureUsage must be one of'));
      });

      test('should canonicalize setupFutureUsage to trimmed lowercase', () => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{"setupFutureUsage":"  OFF_SESSION  "}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Config = require('../../src/config/config');
        expect(Config.getConfig().stripePaymentBehaviorRules).toEqual({ DE: { setupFutureUsage: 'off_session' } });
      });

      test('should accept the empty string as a setupFutureUsage value', () => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{"setupFutureUsage":""}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Config = require('../../src/config/config');
        expect(Config.getConfig().stripePaymentBehaviorRules).toEqual({ DE: { setupFutureUsage: '' } });
      });

      test('should report and ignore on a wrong-case captureMethod', () => {
        // Would otherwise reach the Stripe API and fail every MX checkout with a 400.
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"MX":{"captureMethod":"Manual"}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require('../../src/config/config')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('captureMethod must be one of'));
      });

      test('should report and ignore on a misspelled captureMethod', () => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"MX":{"captureMethod":"autmatic"}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require('../../src/config/config')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('captureMethod must be one of'));
      });

      test.each(['automatic', 'automatic_async', 'manual'])('should accept captureMethod %p', (value) => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = `{"MX":{"captureMethod":"${value}"}}`;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Config = require('../../src/config/config');
        expect(Config.getConfig().stripePaymentBehaviorRules).toEqual({ MX: { captureMethod: value } });
      });

      // KI-045: each field is valid alone, but pi_first always discards setup_future_usage, so a rule
      // asking for both would pass startup and then drop the mandate on every request.
      test('should report and ignore when a rule sets pi_first together with an off_session mandate', () => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{"flowType":"pi_first","setupFutureUsage":"off_session"}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require('../../src/config/config')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringMatching(/both flowType 'pi_first' and setupFutureUsage 'off_session'/),
        );
      });

      test('should report and ignore for the on_session mandate too', () => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"MX":{"flowType":"pi_first","setupFutureUsage":"on_session"}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require('../../src/config/config')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringMatching(/both flowType 'pi_first' and setupFutureUsage 'on_session'/),
        );
      });

      // The disabling spellings ask for exactly what pi_first produces, so they are redundant rather
      // than contradictory. Rejecting them would fail a harmless config.
      test.each(['', 'none', 'null', 'undefined'])(
        'should accept pi_first alongside the disabling setupFutureUsage spelling %p',
        (spelling) => {
          process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = `{"DE":{"flowType":"pi_first","setupFutureUsage":"${spelling}"}}`;
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const Config = require('../../src/config/config');
          expect(Config.config.stripePaymentBehaviorRules?.DE.flowType).toBe('pi_first');
        },
      );

      test('should accept a deferred rule that also sets a mandate', () => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{"flowType":"deferred","setupFutureUsage":"off_session"}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Config = require('../../src/config/config');
        expect(Config.config.stripePaymentBehaviorRules?.DE.setupFutureUsage).toBe('off_session');
      });

      test('should report and ignore on an unknown field, so a typo cannot look configured', () => {
        // {"DE":{"bankTransfers":true}} would otherwise read as enabled and do nothing.
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{"bankTransfers":true}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require('../../src/config/config')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("unknown field 'bankTransfers'"));
      });

      test('should name euBankTransferCountry among the supported fields', () => {
        // The error message is the only place an operator learns the field exists. If a field is added
        // to the validator and not to this message, a correct config reads as a typo.
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{"nope":true}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require('../../src/config/config')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(expect.stringMatching(/euBankTransferCountry/));
      });

      test.each(['DE', 'FR', 'IE', 'NL'])('should accept and carry through euBankTransferCountry %p', (country) => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = `{"DE":{"captureMethod":"automatic","euBankTransferCountry":"${country}"}}`;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Config = require('../../src/config/config');
        expect(Config.getConfig().stripePaymentBehaviorRules?.DE.euBankTransferCountry).toBe(country);
      });

      test('should uppercase-canonicalize euBankTransferCountry', () => {
        // Deliberately case-INSENSITIVE, unlike flowType and captureMethod. An ISO country code has one
        // conventional casing, so 'de' is a typo rather than a different value — whereas 'PI_FIRST' had
        // to fail loudly because accepting it would have silently meant 'deferred'.
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES =
          '{"DE":{"captureMethod":"automatic","euBankTransferCountry":"  de  "}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Config = require('../../src/config/config');
        expect(Config.getConfig().stripePaymentBehaviorRules?.DE.euBankTransferCountry).toBe('DE');
      });

      test('should report and ignore on a country Stripe does not accept for eu_bank_transfer', () => {
        // Measured: "The country provided (US) is not supported for `eu_bank_transfer` details."
        // Stripe types this field as a plain string, so this validator is the only guard.
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{"captureMethod":"automatic","euBankTransferCountry":"US"}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require('../../src/config/config')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringMatching(/euBankTransferCountry must be one of DE, FR, IE, NL/),
        );
      });

      test('should report and ignore when euBankTransferCountry is not a string', () => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{"euBankTransferCountry":1}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require('../../src/config/config')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('euBankTransferCountry must be a string'));
      });

      // THE bankTransfer FLAG IS GONE (ADR-011), and these tests replace the cross-field checks that
      // guarded it. The connector should not re-implement an on/off switch Stripe already owns in the
      // Dashboard — and once the measurements confirmed that, every job the flag did turned out to
      // belong to a field that already existed. `bankTransfer` is now simply an unknown field,
      // covered below.
      //
      // The pair that used to be rejected is now the SUPPORTED way to enable bank transfer in one
      // market: manual capture excludes customer_balance at Stripe's end, so a market that wants the
      // rail says captureMethod 'automatic' and one that does not says nothing.
      test('should accept a per-market automatic capture next to a global manual — the enable path', () => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES =
          '{"DE":{"captureMethod":"automatic","euBankTransferCountry":"DE"},"MX":{"captureMethod":"manual"}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Config = require('../../src/config/config');
        expect(Config.getConfig().stripePaymentBehaviorRules).toEqual({
          DE: { captureMethod: 'automatic', euBankTransferCountry: 'DE' },
          MX: { captureMethod: 'manual' },
        });
      });

      test('should accept euBankTransferCountry on its own, with no companion field', () => {
        // The IBAN override is independent of capture policy: a merchant already on the default
        // automatic capture needs nothing else.
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{"euBankTransferCountry":"DE"}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Config = require('../../src/config/config');
        expect(Config.getConfig().stripePaymentBehaviorRules?.DE).toEqual({ euBankTransferCountry: 'DE' });
      });

      test.each(['automatic', 'automatic_async'])(
        'should accept captureMethod %p alongside an IBAN country',
        (captureMethod) => {
          // 'automatic_async' is compatible with customer_balance — measured 2026-08-05, the
          // PaymentIntent keeps it and still resolves customer_balance in payment_method_types.
          process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = `{"DE":{"captureMethod":"${captureMethod}","euBankTransferCountry":"NL"}}`;
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const Config = require('../../src/config/config');
          expect(Config.getConfig().stripePaymentBehaviorRules?.DE).toEqual({
            captureMethod,
            euBankTransferCountry: 'NL',
          });
        },
      );

      test('should report and ignore on the removed bankTransfer flag rather than ignoring it', () => {
        // A merchant carrying the old config forward must be told, not silently given different
        // behavior. It falls through to the unknown-field branch, which names the supported set.
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{"bankTransfer":true}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require('../../src/config/config')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("unknown field 'bankTransfer'"));
      });

      // Manual capture is legitimate, shipped configuration for every other payment method. It now
      // carries no bank-transfer meaning at all beyond "this market will not offer the rail".
      test('should accept manual capture on a rule with no bank transfer intent', () => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"MX":{"captureMethod":"manual"}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Config = require('../../src/config/config');
        expect(Config.getConfig().stripePaymentBehaviorRules?.MX.captureMethod).toBe('manual');
      });

      // `flowType` was in this list until the pi_first flow was ported to this connector; it is now
      // validated and consumed (see the flowType cases below), so asserting that it is ignored would
      // assert the opposite of the truth. Kept as test.each of one element on purpose: the next
      // checkout-only field that arrives is one entry, not a new test.
      test.each(['collectBillingAddress'])(
        'should accept but ignore checkout-only field %p so one rules map can serve both connectors',
        (field) => {
          process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = `{"DE":{"${field}":"never","euBankTransferCountry":"DE","captureMethod":"automatic"}}`;
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const Config = require('../../src/config/config');
          // Ignored, not carried through — a consumer must never read a field this connector
          // does not implement.
          expect(Config.getConfig().stripePaymentBehaviorRules).toEqual({
            DE: { euBankTransferCountry: 'DE', captureMethod: 'automatic' },
          });
        },
      );

      test.each(['deferred', 'pi_first'])('should accept and carry through flowType %p', (value) => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = `{"DE":{"flowType":"${value}"}}`;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Config = require('../../src/config/config');
        expect(Config.getConfig().stripePaymentBehaviorRules).toEqual({ DE: { flowType: value } });
      });

      test('should report and ignore on a wrong-case flowType, which would silently mean deferred', () => {
        // 'PI_FIRST' fails the `=== 'pi_first'` comparison at the point of use, so without this the
        // merchant would believe pi_first is on while the cart ran the deferred flow.
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{"flowType":"PI_FIRST"}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require('../../src/config/config')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('flowType must be one of deferred, pi_first (case-sensitive)'),
        );
      });

      test('should report and ignore on a misspelled flowType', () => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{"flowType":"pi_frist"}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require('../../src/config/config')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('flowType must be one of'));
      });

      test('should report and ignore when flowType is not a string', () => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{"flowType":true}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require('../../src/config/config')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('flowType must be one of'));
      });

      test('should list flowType as supported in the unknown-field message', () => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{"flowTypes":"pi_first"}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require('../../src/config/config')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('Supported: flowType, captureMethod, setupFutureUsage, euBankTransferCountry'),
        );
      });

      test('should validate every rule in the map, not just the first', () => {
        // The bad MX value is reported and dropped; the good DE rule survives intact. This is the whole
        // point of degrading per field rather than per deployment.
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES =
          '{"DE":{"euBankTransferCountry":"DE","captureMethod":"automatic"},"MX":{"captureMethod":"Manual"}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Config = require('../../src/config/config');
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('captureMethod must be one of'));
        expect(Config.getConfig().stripePaymentBehaviorRules).toEqual({
          DE: { euBankTransferCountry: 'DE', captureMethod: 'automatic' },
          MX: {},
        });
      });

      test('should name the offending rule key in the report', () => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"store-mx":{"captureMethod":"nope"}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(() => require('../../src/config/config')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('STRIPE_PAYMENT_BEHAVIOR_RULES["store-mx"]'));
      });

      test('should accept an empty rule object', () => {
        process.env.STRIPE_PAYMENT_BEHAVIOR_RULES = '{"DE":{}}';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Config = require('../../src/config/config');
        expect(Config.getConfig().stripePaymentBehaviorRules).toEqual({ DE: {} });
      });
    });
  });

  describe('stripePaymentFlow', () => {
    // Same pattern as stripePaymentBehaviorRules: validation runs at module load time, so every case
    // re-requires the module inside the assertion.

    test('should default to deferred when the environment variable is absent', () => {
      delete process.env.STRIPE_PAYMENT_FLOW;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      expect(Config.getConfig().stripePaymentFlow).toBe('deferred');
    });

    test.each(['', '   '])('should read %p as unset rather than invalid, so a blank cannot brick a deploy', (raw) => {
      // STRIPE_PAYMENT_FLOW is optional and carries no default in connect.yaml, so the CT Connect
      // config UI can hand back a blank value for a variable nobody set. Aborting on that would fail
      // the deploy of an environment that simply does not use pi_first.
      process.env.STRIPE_PAYMENT_FLOW = raw;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      expect(Config.getConfig().stripePaymentFlow).toBe('deferred');
    });

    test.each(['deferred', 'pi_first'])('should accept %p', (value) => {
      process.env.STRIPE_PAYMENT_FLOW = value;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      expect(Config.getConfig().stripePaymentFlow).toBe(value);
    });

    test('should trim surrounding whitespace', () => {
      process.env.STRIPE_PAYMENT_FLOW = '  pi_first  ';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      expect(Config.getConfig().stripePaymentFlow).toBe('pi_first');
    });

    test('should fall back to deferred on a misspelled value, and say so loudly', () => {
      // CONVERGES WITH CHECKOUT, and reverses an earlier decision here to abort instead. The silent
      // fallback is a real cost — bank transfers stay off while the merchant believes pi_first is on,
      // which is exactly the symptom that took hours to diagnose during SB3-207 — but it is the smaller
      // one: aborting takes every payment on the deployment down over a typo, and leaves no running
      // service to fix it from. So: fall back, and make the report name the consequence.
      process.env.STRIPE_PAYMENT_FLOW = 'pi_frist';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      expect(Config.getConfig().stripePaymentFlow).toBe('deferred');
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('"pi_frist"'));
    });

    test('should name the consequence, not just the bad value', () => {
      // The whole reason a fallback is tolerable is that the operator finds out. A message that only
      // says "invalid value" would leave them hunting for why the tab never renders.
      process.env.STRIPE_PAYMENT_FLOW = 'nonsense';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../src/config/config');
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('disables bank transfers'));
    });

    test('should fall back to deferred on a wrong-case value', () => {
      // 'PI_FIRST' would fail the === 'pi_first' comparison at the point of use, so accepting it would
      // silently mean deferred anyway. Reported rather than quietly coerced.
      process.env.STRIPE_PAYMENT_FLOW = 'PI_FIRST';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Config = require('../../src/config/config');
      expect(Config.getConfig().stripePaymentFlow).toBe('deferred');
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('case-sensitive'));
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
