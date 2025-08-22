import { Cart, CommercetoolsCartService } from '@commercetools/connect-payments-sdk';
import { getCartIdFromContext } from '../libs/fastify/context/context';
import { wrapStripeError } from '../clients/stripe.client';
import {
  getShippingMethodsFromCart,
  removeShippingRate,
  updateShippingAddress,
  updateShippingRate,
} from './commerce-tools/shipping-client';
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
      let updatedCart = await updateShippingAddress(ctCart, address as _BaseAddress);
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
      const updatedCart = await updateShippingRate(ctCart, shippingRate.id);
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
      const updatedCart = await removeShippingRate(ctCart);
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
