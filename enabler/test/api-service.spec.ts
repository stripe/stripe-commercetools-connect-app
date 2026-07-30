import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { apiService } from '../src/services/api-service';

describe('apiService.confirmPaymentIntent', () => {
  const baseApi = 'http://processor.test';
  const service = apiService({ baseApi, sessionId: 'sess_1' });
  const request = { paymentIntentId: 'pi_1', paymentReference: 'ref_1' };

  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    (global as unknown as { fetch: unknown }).fetch = mockFetch;
  });

  it('returns the approved outcome on a 200 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ outcome: 'approved' }),
    } as never);

    await expect(service.confirmPaymentIntent(request)).resolves.toEqual({ outcome: 'approved' });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://processor.test/confirmPayments/ref_1',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns the pending outcome on a 202 response (2xx is not treated as an error)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ outcome: 'pending' }),
    } as never);

    await expect(service.confirmPaymentIntent(request)).resolves.toEqual({ outcome: 'pending' });
  });

  it('throws when the processor responds with a non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({}),
    } as never);

    await expect(service.confirmPaymentIntent(request)).rejects.toBeDefined();
  });
});
