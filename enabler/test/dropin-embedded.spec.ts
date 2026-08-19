import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../src/services/api-service');
jest.mock('../src/services/stripe-service');

import { apiService, ApiService } from '../src/services/api-service';
import { stripeService, StripeService } from '../src/services/stripe-service';
import { DropinComponents } from '../src/dropin/dropin-embedded';

const getPayment = jest.fn();
const confirmPaymentIntent = jest.fn();
const confirmStripePayment = jest.fn();
const onComplete = jest.fn();

type DropinCtorArgs = ConstructorParameters<typeof DropinComponents>[0];

function buildDropin(baseOptionsOverrides: Record<string, unknown> = {}): DropinComponents {
  const baseOptions = {
    processorUrl: 'http://processor.test',
    sessionId: 'sess_1',
    sdk: {},
    elements: {},
    onComplete,
    ...baseOptionsOverrides,
  };
  return new DropinComponents({
    baseOptions: baseOptions as unknown as DropinCtorArgs['baseOptions'],
    dropinOptions: {} as unknown as DropinCtorArgs['dropinOptions'],
  });
}

// createPayment is private; invoke it through a narrow cast.
function invokeCreatePayment(dropin: DropinComponents): Promise<void> {
  return (dropin as unknown as { createPayment: () => Promise<void> }).createPayment();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(apiService).mockReturnValue({ getPayment, confirmPaymentIntent } as unknown as ApiService);
  jest.mocked(stripeService).mockReturnValue({ confirmStripePayment } as unknown as StripeService);
  getPayment.mockResolvedValue({ paymentReference: 'ref_1' } as never);
  confirmStripePayment.mockResolvedValue({ id: 'pi_1' } as never);
});

describe('DropinComponents.createPayment (one-time confirmation outcome handling)', () => {
  it('reports a non-success result to the buyer when the outcome is pending (async settlement)', async () => {
    confirmPaymentIntent.mockResolvedValue({ outcome: 'pending' } as never);

    await invokeCreatePayment(buildDropin());

    expect(onComplete).toHaveBeenCalledWith({ isSuccess: false });
  });

  it('reports success to the buyer when the outcome is approved (card/wallet — AC3 regression)', async () => {
    confirmPaymentIntent.mockResolvedValue({ outcome: 'approved' } as never);

    await invokeCreatePayment(buildDropin());

    expect(onComplete).toHaveBeenCalledWith({
      isSuccess: true,
      paymentReference: 'ref_1',
      paymentIntent: 'pi_1',
    });
  });
});

describe('DropinComponents.createPayment — pi_first reads the cached PaymentIntent', () => {
  const piFirstResponse = {
    clientSecret: 'pi_1_secret_abc',
    paymentReference: 'ref_cached',
    merchantReturnUrl: 'https://merchant.test/return',
    cartId: 'cart_1',
  };

  beforeEach(() => {
    confirmPaymentIntent.mockResolvedValue({ outcome: 'approved' } as never);
  });

  it('12. uses the cached response and never calls getPayment (a second call = a second PaymentIntent)', async () => {
    await invokeCreatePayment(buildDropin({ flowType: 'pi_first', piFirstResponse }));

    expect(getPayment).not.toHaveBeenCalled();
    expect(confirmStripePayment).toHaveBeenCalledWith(piFirstResponse);
    expect(onComplete).toHaveBeenCalledWith({
      isSuccess: true,
      paymentReference: 'ref_cached',
      paymentIntent: 'pi_1',
    });
  });

  it('13. a cart the guards opted out of (flowType pi_first, no cache) pays via the DEFERRED path', async () => {
    // Regression test. An Express Checkout cart matching a pi_first rule reaches submit with
    // flowType 'pi_first' and NO cached response, because fetchPiFirstPayment deliberately skipped
    // the eager fetch. An earlier revision branched on flowType and threw here, which meant Express
    // could never complete a payment on any cart matching a pi_first rule. Branching on the cache
    // makes that state pay normally instead.
    await invokeCreatePayment(buildDropin({ flowType: 'pi_first' }));

    expect(getPayment).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({
      isSuccess: true,
      paymentReference: 'ref_1',
      paymentIntent: 'pi_1',
    });
  });

  it('14. RELEASE GATE — without pi_first, getPayment is still called with paymentMethodOptions', async () => {
    const paymentMethodOptions = { pix: { expires_after_seconds: 3600 } };

    await invokeCreatePayment(
      buildDropin({ stripeConfig: { paymentIntent: { paymentMethodOptions } } }),
    );

    expect(getPayment).toHaveBeenCalledWith(paymentMethodOptions);
  });
});
