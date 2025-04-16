import { CommercetoolsClient } from '@commercetools/connect-payments-sdk/dist/commercetools/types/api.type';
import {
  FieldDefinition,
  Type,
  TypeDraft,
} from '@commercetools/platform-sdk/dist/declarations/src/generated/models/type';
import { Customer } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/customer';
import { stripeCustomerIdCustomType } from '../custom-types/custom-types';
import { paymentSDK } from '../payment-sdk';

export async function getTypeByKey(key: string): Promise<Type | undefined> {
  const apiClient = paymentSDK.ctAPI.client;
  const res = await apiClient
    .types()
    .get({ queryArgs: { where: `key="${key}"` } })
    .execute();
  return res.body.results[0] || undefined;
}

export function hasField(type: Type, fieldName: string): boolean {
  return type.fieldDefinitions.some((field) => field.name === fieldName);
}

export async function addFieldToType(
  apiClient: CommercetoolsClient,
  typeId: string,
  version: number,
  fieldDefinition: FieldDefinition,
) {
  await apiClient
    .types()
    .withId({ ID: typeId })
    .post({
      body: {
        version,
        actions: [
          {
            action: 'addFieldDefinition',
            fieldDefinition: fieldDefinition,
          },
        ],
      },
    })
    .execute();
}

export async function createCustomerCustomType(stripeCustomerIdCustomType: TypeDraft) {
  const apiClient = paymentSDK.ctAPI.client;
  await apiClient
    .types()
    .post({
      body: stripeCustomerIdCustomType,
    })
    .execute();
}

export async function assignCustomTypeToCustomer(
  client: CommercetoolsClient,
  customer: Customer,
): Promise<Customer | undefined> {
  if (customer.custom?.type?.id) return;

  const res = await client
    .customers()
    .withId({ ID: customer.id })
    .post({
      body: {
        version: customer.version,
        actions: [
          {
            action: 'setCustomType',
            type: {
              typeId: 'type',
              key: stripeCustomerIdCustomType.key,
            },
          },
        ],
      },
    })
    .execute();

  return res.body;
}

export async function getCustomerCustomType(client: CommercetoolsClient, customer: Customer): Promise<Type> {
  const typeId = customer.custom!.type.id;
  const res = await client.types().withId({ ID: typeId }).get().execute();
  return res.body;
}

export async function addFieldToCustomType(
  client: CommercetoolsClient,
  type: Type,
  fieldDefinition: FieldDefinition,
): Promise<Type> {
  const res = await client
    .types()
    .withId({ ID: type.id })
    .post({
      body: {
        version: type.version,
        actions: [
          {
            action: 'addFieldDefinition',
            fieldDefinition,
          },
        ],
      },
    })
    .execute();

  return res.body;
}
