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

function buildDropin(): DropinComponents {
  const baseOptions = {
    processorUrl: 'http://processor.test',
    sessionId: 'sess_1',
    sdk: {},
    elements: {},
    onComplete,
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
