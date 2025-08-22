import { Product } from '@commercetools/platform-sdk';
import { paymentSDK } from '../../payment-sdk';
import { PaymentAmount } from '@commercetools/connect-payments-sdk/dist/commercetools/types/payment.type';
import { log } from '../../libs/logger';

const apiClient = paymentSDK.ctAPI.client;

/**
 * Gets a product by ID with expanded price information
 * @param productId - The commercetools product ID
 * @returns The product with expanded price data or undefined if not found
 */
export const getProductById = async (productId: string): Promise<Product | undefined> => {
  try {
    const response = await apiClient
      .products()
      .withId({ ID: productId })
      .get({
        queryArgs: {
          expand: [
            'masterData.current.masterVariant.prices[*].discounted.discount',
            'masterData.current.variants[*].prices[*].discounted.discount',
          ],
        },
      })
      .execute();

    return response.body;
  } catch (error) {
    log.error('Error getting product by ID', { error, productId });
    return undefined;
  }
};

/**
 * Gets the current price of a product from its master variant
 * @param productId - The commercetools product ID
 * @returns The current price or undefined if not found
 */
export const getProductMasterPrice = async (productId: string): Promise<PaymentAmount | undefined> => {
  try {
    const product = await getProductById(productId);

    if (!product || !product.masterData?.current?.masterVariant?.prices?.[0]) {
      log.warn('No product or price found for product ID', { productId });
      return undefined;
    }

    const price = product.masterData.current.masterVariant.prices[0];

    return {
      centAmount: price.value.centAmount,
      currencyCode: price.value.currencyCode,
      fractionDigits: price.value.fractionDigits || 2,
    };
  } catch (error) {
    log.error('Error getting product master price', { error, productId });
    return undefined;
  }
};
