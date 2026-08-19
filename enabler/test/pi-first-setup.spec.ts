import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../src/services/api-service');
jest.mock('@stripe/stripe-js', () => ({ loadStripe: jest.fn() }));

import { loadStripe } from '@stripe/stripe-js';
import { apiService, ApiService } from '../src/services/api-service';
import { MockPaymentEnabler, BaseOptions } from '../src/payment-enabler/payment-enabler-mock';
import { EnablerOptions } from '../src/payment-enabler/payment-enabler';

const getConfigData = jest.fn();
const getCustomerOptions = jest.fn();
const getPayment = jest.fn();

/** Captures what getElements() ultimately passed to stripe.elements(). */
const elementsFn = jest.fn();
const elementsCreate = jest.fn();

const CONFIG_ENV = { environment: 'test', publishableKey: 'pk_test_123' };

const PI_RESPONSE = {
  clientSecret: 'pi_1_secret_abc',
  paymentReference: 'ref_1',
  merchantReturnUrl: 'https://merchant.test/return',
  cartId: 'cart_1',
};

type CartInfoOverrides = Record<string, unknown>;

function buildCartInfo(overrides: CartInfoOverrides = {}): Record<string, unknown> {
  return {
    cartInfo: { amount: 4200, currency: 'USD' },
    appearance: '',
    captureMethod: 'automatic',
    webElements: 'paymentElement',
    setupFutureUsage: 'off_session',
    layout: '',
    collectBillingAddress: 'auto',
    paymentMode: 'payment',
    ...overrides,
  };
}

function buildOptions(overrides: Partial<EnablerOptions> = {}): EnablerOptions {
  return {
    processorUrl: 'http://processor.test',
    sessionId: 'sess_1',
    paymentElementType: 'paymentElement',
    locale: 'en',
    onComplete: jest.fn(),
    onError: jest.fn(),
    ...overrides,
  } as unknown as EnablerOptions;
}

async function runSetup(
  optionOverrides: Partial<EnablerOptions> = {},
  cartInfoOverrides: CartInfoOverrides = {},
): Promise<BaseOptions> {
  getConfigData.mockResolvedValue([buildCartInfo(cartInfoOverrides), CONFIG_ENV] as never);
  const enabler = new MockPaymentEnabler(buildOptions(optionOverrides));
  const { baseOptions } = await enabler.setupData;
  return baseOptions;
}

/** The single options object handed to stripe.elements(). */
function elementsArg(): Record<string, unknown> {
  expect(elementsFn).toHaveBeenCalledTimes(1);
  return elementsFn.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  jest.clearAllMocks();
  elementsCreate.mockReturnValue({ mount: jest.fn() });
  elementsFn.mockReturnValue({ create: elementsCreate });
  jest.mocked(loadStripe).mockResolvedValue({ elements: elementsFn } as never);
  jest.mocked(apiService).mockReturnValue({
    getConfigData,
    getCustomerOptions,
    getPayment,
  } as unknown as ApiService);
  getCustomerOptions.mockResolvedValue({
    stripeCustomerId: 'cus_1',
    ephemeralKey: 'ek_1',
    sessionId: 'cuss_1',
  } as never);
  getPayment.mockResolvedValue(PI_RESPONSE as never);
});

// ---------------------------------------------------------------------------
// RELEASE GATE — with flowType absent or 'deferred', and for every cart the
// eager fetch must skip, _Setup must behave exactly as it did before P2.
// These assertions are the gate: they check the literal shape of the object
// handed to stripe.elements(), not just that some call happened.
// ---------------------------------------------------------------------------

describe('_Setup release gate — the deferred path must be untouched', () => {
  it('1. flowType absent: no eager PaymentIntent fetch, deferred elements() shape', async () => {
    const baseOptions = await runSetup();

    expect(getPayment).not.toHaveBeenCalled();
    expect(baseOptions.piFirstResponse).toBeUndefined();
    expect(baseOptions.flowType).toBeUndefined();

    const arg = elementsArg();
    expect(arg).toMatchObject({ mode: 'payment', amount: 4200, currency: 'usd' });
    expect(arg).not.toHaveProperty('clientSecret');
    // customer-derived options still reach elements() on the deferred path
    expect(arg).toHaveProperty('customerOptions');
    expect(arg).toHaveProperty('setupFutureUsage', 'off_session');
    expect(arg).toHaveProperty('customerSessionClientSecret', 'cuss_1');
  });

  it("2. flowType 'deferred': no eager fetch, deferred elements() shape", async () => {
    const baseOptions = await runSetup({}, { flowType: 'deferred' });

    expect(getPayment).not.toHaveBeenCalled();
    expect(baseOptions.piFirstResponse).toBeUndefined();
    expect(baseOptions.flowType).toBe('deferred');
    expect(elementsArg()).toMatchObject({ mode: 'payment', amount: 4200, currency: 'usd' });
  });

  it('4. pi_first + expressCheckout: no eager fetch (elements.update({amount}) needs mode/amount)', async () => {
    const baseOptions = await runSetup(
      { paymentElementType: 'expressCheckout' },
      { flowType: 'pi_first', webElements: 'expressCheckout' },
    );

    expect(getPayment).not.toHaveBeenCalled();
    expect(baseOptions.piFirstResponse).toBeUndefined();
    expect(elementsArg()).toMatchObject({ mode: 'payment', amount: 4200, currency: 'usd' });
  });

  it('5. pi_first + paymentElementType undefined: no eager fetch (allow-list, not negation)', async () => {
    const baseOptions = await runSetup({ paymentElementType: undefined }, { flowType: 'pi_first' });

    expect(getPayment).not.toHaveBeenCalled();
    expect(baseOptions.piFirstResponse).toBeUndefined();
  });

  it("6. pi_first + paymentMode 'subscription': no eager fetch (submit calls createSubscription)", async () => {
    const baseOptions = await runSetup({}, { flowType: 'pi_first', paymentMode: 'subscription' });

    expect(getPayment).not.toHaveBeenCalled();
    expect(baseOptions.piFirstResponse).toBeUndefined();
  });

  it("7. pi_first + paymentMode 'setup': no eager fetch (submit calls createSetupIntent)", async () => {
    const baseOptions = await runSetup({}, { flowType: 'pi_first', paymentMode: 'setup' });

    expect(getPayment).not.toHaveBeenCalled();
    expect(baseOptions.piFirstResponse).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// pi_first behaviour
// ---------------------------------------------------------------------------

describe('_Setup under pi_first', () => {
  it('3. initializes elements() with clientSecret and omits the incompatible options', async () => {
    const baseOptions = await runSetup({}, { flowType: 'pi_first' });

    expect(baseOptions.flowType).toBe('pi_first');
    expect(baseOptions.piFirstResponse).toEqual(PI_RESPONSE);

    const arg = elementsArg();
    expect(arg).toHaveProperty('clientSecret', 'pi_1_secret_abc');
    expect(arg).toHaveProperty('locale', 'en');
    // Incompatible with clientSecret-based initialization — all must be absent.
    expect(arg).not.toHaveProperty('mode');
    expect(arg).not.toHaveProperty('amount');
    expect(arg).not.toHaveProperty('currency');
    expect(arg).not.toHaveProperty('captureMethod');
    expect(arg).not.toHaveProperty('customerOptions');
    expect(arg).not.toHaveProperty('setupFutureUsage');
    expect(arg).not.toHaveProperty('customerSessionClientSecret');
  });

  it('8. fetches the PaymentIntent once per enabler instance, across repeated builder creations', async () => {
    getConfigData.mockResolvedValue([buildCartInfo({ flowType: 'pi_first' }), CONFIG_ENV] as never);
    const enabler = new MockPaymentEnabler(buildOptions());

    await enabler.setupData;
    await enabler.createDropinBuilder('embedded' as never);
    await enabler.createDropinBuilder('embedded' as never);

    // Every extra call leaks BOTH an orphan PaymentIntent and an orphan CT Payment, because /payments
    // has no deterministic idempotency key. Note the scope of what this pins: _Setup runs once per
    // CONSTRUCTION and its promise is memoised in setupData, so one instance cannot double-fetch. It
    // does NOT pin anything about re-instantiation — a React remount or StrictMode double invoke
    // builds a new enabler and does fetch again. That gap is not closable from the enabler.
    expect(getPayment).toHaveBeenCalledTimes(1);
  });

  it('9. forwards stripeConfig.paymentIntent.paymentMethodOptions to the eager fetch', async () => {
    const paymentMethodOptions = { pix: { expires_after_seconds: 3600 } };

    await runSetup(
      { stripeConfig: { paymentIntent: { paymentMethodOptions } } },
      { flowType: 'pi_first' },
    );

    expect(getPayment).toHaveBeenCalledWith(paymentMethodOptions);
  });

  it('10. rejects and notifies onError when the processor response has no clientSecret', async () => {
    getPayment.mockResolvedValue({ ...PI_RESPONSE, clientSecret: undefined } as never);
    const onError = jest.fn();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runSetup({ onError }, { flowType: 'pi_first' })).rejects.toThrow(
      /missing clientSecret or paymentReference/,
    );
    // _Setup's rejection reaches no error handler on its own, so onError must be called explicitly.
    expect(onError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it('11. rejects when the processor response has no paymentReference', async () => {
    getPayment.mockResolvedValue({ ...PI_RESPONSE, paymentReference: undefined } as never);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runSetup({}, { flowType: 'pi_first' })).rejects.toThrow(
      /missing clientSecret or paymentReference/,
    );
    consoleError.mockRestore();
  });

  it('15. logs the commercetools identifiers of the orphaned pair, and never the clientSecret', async () => {
    getPayment.mockResolvedValue({ ...PI_RESPONSE, clientSecret: undefined } as never);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runSetup({}, { flowType: 'pi_first' })).rejects.toThrow();

    // The PaymentIntent, the CT Payment and the cart freeze already happened server-side; these ids
    // are the only handle an operator has to find the orphan.
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('orphaned') as unknown as string,
      expect.objectContaining({ cartId: 'cart_1', paymentReference: 'ref_1' }) as unknown as object,
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('pi_1_secret_abc');
    consoleError.mockRestore();
  });
});

describe('_Setup — flowType is diagnostic, never a discriminator', () => {
  // The assertion that would have caught the bug where Express Checkout on a pi_first cart could
  // never pay: flowType reports what the PROCESSOR decided, which is not what this Element did.
  it.each([
    ['expressCheckout element', { paymentElementType: 'expressCheckout' }, {}],
    ['subscription cart', {}, { paymentMode: 'subscription' }],
    ['setup-intent cart', {}, { paymentMode: 'setup' }],
    ['unset element type', { paymentElementType: undefined }, {}],
  ])(
    '16. %s: keeps flowType pi_first while leaving piFirstResponse undefined',
    async (_label, optionOverrides, cartInfoOverrides) => {
      const baseOptions = await runSetup(optionOverrides as Partial<EnablerOptions>, {
        flowType: 'pi_first',
        ...cartInfoOverrides,
      });

      expect(baseOptions.flowType).toBe('pi_first');
      expect(baseOptions.piFirstResponse).toBeUndefined();
      expect(getPayment).not.toHaveBeenCalled();
    },
  );
});
