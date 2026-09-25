import { Cart, Order } from '@commercetools/platform-sdk';
import { paymentSDK } from '../../payment-sdk';
import { OrderPaymentState } from '../types/stripe-payment.type';

const apiClient = paymentSDK.ctAPI.client;

export const createOrderFromCart = async (
  cart: Cart,
  paymentState: OrderPaymentState = OrderPaymentState.PAID,
  expectedVersion?: number,
): Promise<Order> => {
  // When the caller pins a version (post-address underpayment guard), mint from THAT exact snapshot so a
  // cart that moved after validation cannot be ordered (commercetools returns 409 → no order). When
  // omitted, preserve legacy behavior: re-read the latest version. See stripe-payment.service.ts guard B.
  const version = expectedVersion ?? (await paymentSDK.ctCartService.getCart({ id: cart.id })).version;

  const res = await apiClient
    .orders()
    .post({
      body: {
        cart: {
          id: cart.id,
          typeId: 'cart',
        },
        shipmentState: 'Pending',
        orderState: 'Open',
        version,
        paymentState,
      },
    })
    .execute();
  return res.body;
};

export const addOrderPayment = async (order: Order, paymentId: string) => {
  const response = await apiClient
    .orders()
    .withId({ ID: order.id })
    .post({
      body: {
        version: order.version,
        actions: [
          {
            action: 'addPayment',
            payment: {
              id: paymentId,
              typeId: 'payment',
            },
          },
        ],
      },
    })
    .execute();
  return response.body;
};
