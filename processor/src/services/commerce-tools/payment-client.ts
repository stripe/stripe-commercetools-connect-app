import { Payment } from '@commercetools/platform-sdk';
import { paymentSDK } from '../../payment-sdk';

const apiClient = paymentSDK.ctAPI.client;

/**
 * Sets the native `paymentStatus.interfaceCode` / `interfaceText` on a CT Payment.
 *
 * These are standard Payment fields (NOT custom fields / custom types): a lightweight, human-readable
 * flag on the payment. Used to surface a payment for attention (e.g. an ACH late return that is
 * handled in the Stripe Dashboard) without changing its financial state (transactions / order stay
 * untouched). The connect-payments-sdk `updatePayment` only exposes transaction-level actions, so this
 * goes through the raw CT API client, like the other commerce-tools clients.
 */
export const setPaymentStatusInterface = async (
  payment: Payment,
  interfaceCode: string,
  interfaceText: string,
): Promise<Payment> => {
  const response = await apiClient
    .payments()
    .withId({ ID: payment.id })
    .post({
      body: {
        version: payment.version,
        actions: [
          { action: 'setStatusInterfaceCode', interfaceCode },
          { action: 'setStatusInterfaceText', interfaceText },
        ],
      },
    })
    .execute();

  return response.body;
};
