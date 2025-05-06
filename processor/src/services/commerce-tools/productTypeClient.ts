import { ProductType, ProductTypeDraft } from '@commercetools/platform-sdk';
import { paymentSDK } from '../../payment-sdk';
import { KeyAndVersion } from './customTypeHelper';

const apiClient = paymentSDK.ctAPI.client;

export async function getProductTypeByKey(key: string): Promise<ProductType | undefined> {
  const res = await apiClient
    .productTypes()
    .get({ queryArgs: { where: `key="${key}"` } })
    .execute();
  return res.body.results[0] || undefined;
}

export async function getProductsByProductTypeId(productTypeId?: string, limit = 1) {
  const res = await apiClient
    .products()
    .get({ queryArgs: { where: `productType(id="${productTypeId}")`, limit } })
    .execute();
  return res.body.results;
}

export async function deleteProductType({ key, version }: KeyAndVersion) {
  await apiClient.productTypes().withKey({ key }).delete({ queryArgs: { version } }).execute();
}

export async function createProductType(body: ProductTypeDraft) {
  const newProductType = await apiClient.productTypes().post({ body }).execute();
  return newProductType.body;
}
