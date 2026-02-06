import { Price, Product } from '@commercetools/platform-sdk';
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

/**
 * Gets a price from a product by price ID
 * @param product - The commercetools product
 * @param priceId - The price ID to find
 * @returns The price object or undefined if not found
 */
export const getPriceFromProduct = (product: Product, priceId: string): PaymentAmount | undefined => {
  try {
    // Check master variant prices first
    const masterVariant = product.masterData?.current?.masterVariant;
    const masterPrice = findPriceById(masterVariant?.prices, priceId);
    if (masterPrice) {
      return masterPrice;
    }

    // Check all variant prices if not found in master variant
    const variants = product.masterData?.current?.variants;
    if (variants) {
      for (const variant of variants) {
        const variantPrice = findPriceById(variant.prices, priceId);
        if (variantPrice) {
          return variantPrice;
        }
      }
    }

    return undefined;
  } catch (error) {
    log.error('Error getting price from product', { error, priceId, productId: product.id });
    return undefined;
  }
};

/**
 * Finds a price by ID in an array of prices and converts it to PaymentAmount format.
 * @param prices - Array of prices to search in.
 * @param priceId - The price ID to find.
 * @returns PaymentAmount object or undefined if not found.
 */
const findPriceById = (prices: Price[] | undefined, priceId: string): PaymentAmount | undefined => {
  if (!prices) {
    return undefined;
  }

  const price = prices.find((p) => p.id === priceId);
  if (!price) {
    return undefined;
  }

  return {
    centAmount: price.value.centAmount,
    currencyCode: price.value.currencyCode,
    fractionDigits: price.value.fractionDigits || 2,
  };
};
