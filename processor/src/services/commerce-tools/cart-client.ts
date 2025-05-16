import { Cart, CartUpdateAction } from '@commercetools/platform-sdk';
import { paymentSDK } from '../../payment-sdk';
import { getCartIdFromContext } from '../../libs/fastify/context/context';

const apiClient = paymentSDK.ctAPI.client;

export const getCartExpanded = async (id?: string): Promise<Cart> => {
  const cart = await apiClient
    .carts()
    .withId({ ID: id ?? getCartIdFromContext() })
    .get({ queryArgs: { expand: 'lineItems[*].productType' } })
    .execute();
  return cart.body;
};

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
