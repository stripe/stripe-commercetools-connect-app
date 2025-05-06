import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mock_SetCustomFieldActions } from '../../utils/mock-actions-data';
import { paymentSDK } from '../../../src/payment-sdk';
import { mockCtCustomerData } from '../../utils/mock-customer-data';
import { updateCustomerById } from '../../../src/services/commerce-tools/customerClient';

describe('ProductTypeHelper testing', () => {
  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('updateCustomerById', () => {
    it('should update the customer successfully', async () => {
      const executeMock = jest.fn().mockReturnValue(Promise.resolve({ body: mockCtCustomerData }));
      const client = paymentSDK.ctAPI.client;
      client.customers = jest.fn(() => ({
        withId: jest.fn(() => ({
          post: jest.fn(() => ({
            execute: executeMock,
          })),
        })),
      })) as never;
      const result = await updateCustomerById({
        id: 'customer-id',
        version: 1,
        actions: mock_SetCustomFieldActions,
      });
      expect(result).toEqual(mockCtCustomerData);
    });
  });
});
