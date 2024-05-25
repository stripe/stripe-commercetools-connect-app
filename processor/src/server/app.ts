import { paymentSDK } from '../payment-sdk';
import { StripePaymentService } from '../services/stripe-payment.service';

const paymentService = new StripePaymentService({
  ctCartService: paymentSDK.ctCartService,
  ctPaymentService: paymentSDK.ctPaymentService,
});

export const app = {
  services: {
    paymentService,
  },
};
