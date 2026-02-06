import { Cart, CommercetoolsCartService } from '@commercetools/connect-payments-sdk';
import { getCartIdFromContext } from '../libs/fastify/context/context';
import { wrapStripeError } from '../clients/stripe.client';
import {
  getShippingMethodsFromCart,
  removeShippingRate,
  updateShippingAddress,
  updateShippingRate,
} from './commerce-tools/shipping-client';
import { freezeCart, unfreezeCart, isCartFrozen } from './commerce-tools/cart-client';
import { ShippingMethod } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/shipping-method';
import { StripeShippingServiceOptions } from './types/stripe-shipping.type';
import { log } from '../libs/logger';
import { getLocalizedString } from '../utils';
import { _BaseAddress } from '@commercetools/platform-sdk/dist/declarations/src/generated/models/common';
import {
  ShippingMethodsRequestSchemaDTO,
  ShippingMethodsResponseSchemaDTO,
  ShippingUpdateRequestSchemaDTO,
} from '../dtos/operations/shipping.dto';

export class StripeShippingService {
  private ctCartService: CommercetoolsCartService;

  constructor(opts: StripeShippingServiceOptions) {
    this.ctCartService = opts.ctCartService;
  }

  public async getShippingMethods(address: ShippingMethodsRequestSchemaDTO): Promise<ShippingMethodsResponseSchemaDTO> {
    try {
      const ctCart = await this.ctCartService.getCart({ id: getCartIdFromContext() });

      // Unfreeze cart temporarily for Express Checkout shipping updates
      let cartToUpdate = ctCart;
      const wasFrozen = isCartFrozen(ctCart);

      if (wasFrozen) {
        try {
          cartToUpdate = await unfreezeCart(ctCart);
          log.info(`Cart temporarily unfrozen for Express Checkout shipping address update.`, {
            ctCartId: cartToUpdate.id,
          });
        } catch (error) {
          log.error(`Error unfreezing cart for shipping address update.`, {
            error,
            ctCartId: ctCart.id,
          });
          throw wrapStripeError(error);
        }
      }

      let updatedCart = await updateShippingAddress(cartToUpdate, address as _BaseAddress);
      const response = await getShippingMethodsFromCart(updatedCart);

      if (response.results.length === 0) {
        throw new Error('No shipping methods found for the given address.');
      }

      const shippingMethods = response.results.map((shippingMethod: ShippingMethod) => {
        const zoneRate = shippingMethod.zoneRates[0];
        const shippingRate = zoneRate?.shippingRates[0];
        return {
          id: shippingMethod.id,
          displayName: shippingMethod.name,
          amount: shippingRate?.price?.centAmount ?? 0,
        };
      });
      if (updatedCart && updatedCart.shippingInfo && updatedCart.shippingInfo?.shippingMethod) {
        const shippingMethodId = updatedCart.shippingInfo.shippingMethod.id;
        const index = shippingMethods.findIndex((method) => method.id === shippingMethodId);
        if (index > -1) {
          const [shippingMethod] = shippingMethods.splice(index, 1);
          shippingMethods.unshift(shippingMethod);
        }
      } else {
        updatedCart = await updateShippingRate(updatedCart, shippingMethods[0].id);
      }

      // Re-freeze cart after shipping updates
      if (wasFrozen) {
        try {
          updatedCart = await freezeCart(updatedCart);
          log.info(`Cart re-frozen after Express Checkout shipping address update.`, {
            ctCartId: updatedCart.id,
          });
        } catch (error) {
          log.error(`Error re-freezing cart after shipping address update.`, {
            error,
            ctCartId: updatedCart.id,
          });
          // Continue even if re-freeze fails
        }
      }

      const lineItems = await this.getCartLineItems(updatedCart);

      return {
        shippingRates: shippingMethods,
        lineItems,
      };
    } catch (error) {
      throw wrapStripeError(error);
    }
  }

  public async updateShippingRate(
    shippingRate: ShippingUpdateRequestSchemaDTO,
  ): Promise<ShippingMethodsResponseSchemaDTO> {
    try {
      const ctCart = await this.ctCartService.getCart({ id: getCartIdFromContext() });

      // Unfreeze cart temporarily for Express Checkout shipping method update
      let cartToUpdate = ctCart;
      const wasFrozen = isCartFrozen(ctCart);

      if (wasFrozen) {
        try {
          cartToUpdate = await unfreezeCart(ctCart);
          log.info(`Cart temporarily unfrozen for Express Checkout shipping method update.`, {
            ctCartId: cartToUpdate.id,
          });
        } catch (error) {
          log.error(`Error unfreezing cart for shipping method update.`, {
            error,
            ctCartId: ctCart.id,
          });
          throw wrapStripeError(error);
        }
      }

      let updatedCart = await updateShippingRate(cartToUpdate, shippingRate.id);

      // Re-freeze cart after shipping method update
      if (wasFrozen) {
        try {
          updatedCart = await freezeCart(updatedCart);
          log.info(`Cart re-frozen after Express Checkout shipping method update.`, {
            ctCartId: updatedCart.id,
          });
        } catch (error) {
          log.error(`Error re-freezing cart after shipping method update.`, {
            error,
            ctCartId: updatedCart.id,
          });
          // Continue even if re-freeze fails
        }
      }

      const lineItems = await this.getCartLineItems(updatedCart);
      return {
        lineItems: lineItems,
      };
    } catch (error) {
      throw wrapStripeError(error);
    }
  }

  public async removeShippingRate(): Promise<ShippingMethodsResponseSchemaDTO> {
    try {
      const ctCart = await this.ctCartService.getCart({ id: getCartIdFromContext() });

      // Unfreeze cart when user cancels Express Checkout
      let cartToUpdate = ctCart;
      const wasFrozen = isCartFrozen(ctCart);

      if (wasFrozen) {
        try {
          cartToUpdate = await unfreezeCart(ctCart);
          log.info(`Cart unfrozen after Express Checkout cancellation.`, {
            ctCartId: cartToUpdate.id,
          });
        } catch (error) {
          log.error(`Error unfreezing cart after Express Checkout cancellation.`, {
            error,
            ctCartId: ctCart.id,
          });
          throw wrapStripeError(error);
        }
      }

      const updatedCart = await removeShippingRate(cartToUpdate);

      // Note: Cart remains unfrozen after cancellation to allow user to modify cart
      // We don't re-freeze here because the payment flow was cancelled

      const lineItems = await this.getCartLineItems(updatedCart);
      return {
        lineItems: lineItems,
      };
    } catch (error) {
      throw wrapStripeError(error);
    }
  }

  private async getCartLineItems(ctCart: Cart) {
    try {
      const lineItems = ctCart.lineItems.map((item) => ({
        name: getLocalizedString(item.name),
        amount: item.totalPrice.centAmount,
      }));
      if (ctCart.shippingInfo && ctCart.shippingInfo.price) {
        lineItems.push({
          name: 'Shipping',
          amount: ctCart.shippingInfo.price.centAmount,
        });
      }
      return lineItems;
    } catch (error) {
      log.error(`Error getting cart line items: ${error}`);
      return [];
    }
  }
}
