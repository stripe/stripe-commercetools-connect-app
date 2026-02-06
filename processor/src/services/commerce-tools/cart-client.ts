import { Cart, CartUpdateAction, CartDraft, Product, ProductVariant } from '@commercetools/platform-sdk';
import { paymentSDK } from '../../payment-sdk';
import { getCartIdFromContext } from '../../libs/fastify/context/context';
import { PaymentAmount } from '@commercetools/connect-payments-sdk/dist/commercetools/types/payment.type';
import { log } from '../../libs/logger';
import { lineItemStripeSubscriptionIdField, typeLineItem } from '../../custom-types/custom-types';

const apiClient = paymentSDK.ctAPI.client;

/**
 * Creates a new cart in commercetools using the provided cart draft.
 * @param cartDraft - The draft object containing cart details
 * @returns A promise that resolves to the created Cart object.
 */
export const createCartFromDraft = async (cartDraft: CartDraft): Promise<Cart> => {
  const cartResponse = await apiClient
    .carts()
    .post({
      body: cartDraft,
    })
    .execute();

  return cartResponse.body;
};

/**
 * Retrieves a cart by ID and expands related resources.
 * @param id - The cart ID. If not provided, retrieves it from context.
 * @returns A promise that resolves to the expanded Cart object.
 */
export const getCartExpanded = async (id?: string): Promise<Cart> => {
  const cart = await apiClient
    .carts()
    .withId({ ID: id ?? getCartIdFromContext() })
    .get({
      queryArgs: {
        expand: ['lineItems[*].productType', 'discountCodes[*].discountCode.cartDiscounts[*]'],
      },
    })
    .execute();
  return cart.body;
};

/**
 * Updates a cart by its ID with the specified update actions.
 * @param cart - The cart object to update.
 * @param actions - Array of update actions to apply.
 * @returns A promise that resolves to the updated Cart object.
 */
export const updateCartById = async (cart: Cart, actions: CartUpdateAction[]) => {
  const updatedCart = await apiClient
    .carts()
    .withId({ ID: cart.id })
    .post({
      body: {
        version: cart.version,
        actions,
      },
    })
    .execute();
  return updatedCart.body;
};

/**
 * Creates a cart with the specified product variant and price
 * @param product - The commercetools product
 * @param variant - The specific variant to add
 * @param price - The price information
 * @param priceId - The commercetools price ID
 * @param subscriptionId - The Stripe subscription ID
 * @returns A cart with the product added
 */
export const createCartWithProduct = async (
  product: Product,
  variant: ProductVariant,
  price: PaymentAmount,
  priceId: string,
  subscriptionId: string,
  quantity: number,
): Promise<Cart> => {
  try {
    // Create cart draft using the same pattern as createNewCartFromOrder
    const cartDraft: CartDraft = {
      currency: price.currencyCode,
    };

    // Create the cart
    const cartResponse = await apiClient
      .carts()
      .post({
        body: cartDraft,
      })
      .execute();

    let cart = cartResponse.body;

    const lineItemActions: CartUpdateAction[] = [
      {
        action: 'addLineItem',
        productId: product.id,
        variantId: variant.id,
        quantity: quantity,
        custom: {
          type: {
            typeId: 'type',
            key: typeLineItem.key,
          },
          fields: {
            [lineItemStripeSubscriptionIdField]: subscriptionId,
          },
        },
      },
    ];

    // Update cart with line item using the same pattern as createNewCartFromOrder
    cart = await updateCartById(cart, lineItemActions);

    // Get the expanded cart to ensure all data is loaded
    cart = await getCartExpanded(cart.id);

    log.info('Cart created with product', {
      cartId: cart.id,
      productId: product.id,
      variantId: variant.id,
      priceId: priceId,
      currency: price.currencyCode,
    });

    return cart;
  } catch (error) {
    log.error('Error creating cart with product', { error, productId: product.id, variantId: variant.id });
    throw error;
  }
};

/**
 * Freezes a cart to prevent modifications (products, quantities, discounts, addresses, shipping).
 * @param cart - The cart object to freeze.
 * @returns A promise that resolves to the frozen Cart object.
 */
export const freezeCart = async (cart: Cart): Promise<Cart> => {
  const actions: CartUpdateAction[] = [
    {
      action: 'freezeCart',
    },
  ];
  return await updateCartById(cart, actions);
};

/**
 * Unfreezes a cart to allow modifications again.
 * @param cart - The cart object to unfreeze.
 * @returns A promise that resolves to the unfrozen Cart object.
 */
export const unfreezeCart = async (cart: Cart): Promise<Cart> => {
  const actions: CartUpdateAction[] = [
    {
      action: 'unfreezeCart',
    },
  ];
  return await updateCartById(cart, actions);
};

/**
 * Checks if a cart is frozen.
 * @param cart - The cart object to check.
 * @returns True if the cart is frozen, false otherwise.
 */
export const isCartFrozen = (cart: Cart): boolean => {
  return 'frozen' in cart && (cart as Cart & { frozen?: boolean }).frozen === true;
};
