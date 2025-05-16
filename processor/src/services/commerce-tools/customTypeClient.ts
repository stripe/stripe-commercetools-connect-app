import { Type, TypeDraft, TypeUpdateAction } from '@commercetools/platform-sdk';
import { KeyAndVersion } from './customTypeHelper';
import { paymentSDK } from '../../payment-sdk';

const apiClient = paymentSDK.ctAPI.client;

export async function getTypeByKey(key: string): Promise<Type | undefined> {
  const res = await apiClient
    .types()
    .get({ queryArgs: { where: `key="${key}"` } })
    .execute();
  return res.body.results[0] || undefined;
}

export async function getTypesByResourceTypeId(resourceTypeId: string) {
  const res = await apiClient
    .types()
    .get({
      queryArgs: {
        where: `resourceTypeIds contains any ("${resourceTypeId}")`,
      },
    })
    .execute();
  return res.body.results;
}

export async function createCustomType(customType: TypeDraft): Promise<string> {
  const res = await apiClient.types().post({ body: customType }).execute();
  return res.body.id;
}

export async function updateCustomTypeByKey({
  key,
  version,
  actions,
}: KeyAndVersion & { actions: TypeUpdateAction[] }) {
  await apiClient.types().withKey({ key }).post({ body: { version, actions } }).execute();
}

export async function deleteCustomTypeByKey({ key, version }: KeyAndVersion): Promise<void> {
  await apiClient
    .types()
    .withKey({ key })
    .delete({
      queryArgs: { version },
    })
    .execute();
}
