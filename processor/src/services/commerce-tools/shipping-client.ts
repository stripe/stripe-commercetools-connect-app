import { Cart, CartUpdateAction } from '@commercetools/platform-sdk';
import { paymentSDK } from '../../payment-sdk';
import { ShippingMethodPagedQueryResponse } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/shipping-method';
import { _BaseAddress } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/common';
import { updateCartById } from './cart-client';

const apiClient = paymentSDK.ctAPI.client;

export const getShippingMethodsFromCart = async (cart: Cart): Promise<ShippingMethodPagedQueryResponse> => {
  const response = await apiClient
    .shippingMethods()
    .matchingCart()
    .get({
      queryArgs: {
        cartId: cart.id,
      },
    })
    .execute();

  return response.body;
};

export const updateShippingAddress = async (cart: Cart, address: _BaseAddress) => {
  try {
    const actions = [
      {
        action: 'setShippingAddress',
        address: {
          country: address.country,
          state: address.state,
          city: address.city,
          streetName: address.streetName,
          streetNumber: address.streetNumber,
          postalCode: address.postalCode,
          additionalStreetInfo: address.additionalStreetInfo,
          region: address.region,
        },
      },
    ] as CartUpdateAction[];

    return await updateCartById(cart, actions);
  } catch (error) {
    console.error(`Error updating shipping address: ${error}`);
    throw error;
  }
};

export const updateShippingRate = async (cart: Cart, shippingRateId: string) => {
  try {
    const actions = [
      {
        action: 'setShippingMethod',
        shippingMethod: {
          typeId: 'shipping-method',
          id: shippingRateId,
        },
      },
    ] as CartUpdateAction[];

    return await updateCartById(cart, actions);
  } catch (error) {
    console.error(`Error updating shipping rate: ${error}`);
    throw error;
  }
};

export const removeShippingRate = async (cart: Cart) => {
  try {
    const actions = [
      {
        action: 'setShippingMethod',
      },
    ] as CartUpdateAction[];

    return await updateCartById(cart, actions);
  } catch (error) {
    console.error(`Error updating shipping rate: ${error}`);
    throw error;
  }
};
