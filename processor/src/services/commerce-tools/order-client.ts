import { Cart, Order } from '@commercetools/platform-sdk';
import { paymentSDK } from '../../payment-sdk';

const apiClient = paymentSDK.ctAPI.client;

export const createOrderFromCart = async (cart: Cart) => {
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
        version: cart.version,
        paymentState: 'Paid',
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
