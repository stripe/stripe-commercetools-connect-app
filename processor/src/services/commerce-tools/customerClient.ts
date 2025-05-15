import { Customer, CustomerUpdateAction } from '@commercetools/platform-sdk';
import { paymentSDK } from '../../payment-sdk';

const apiClient = paymentSDK.ctAPI.client;

export const getCustomerById = async (id: string) => {
  const customer = await apiClient.customers().withId({ ID: id }).get().execute();
  return customer.body;
};

export async function updateCustomerById({
  id,
  version,
  actions,
}: {
  id: string;
  version: number;
  actions: CustomerUpdateAction[];
}): Promise<Customer> {
  const response = await apiClient.customers().withId({ ID: id }).post({ body: { version, actions } }).execute();
  return response.body;
}
