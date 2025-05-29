import { FastifyInstance } from 'fastify';
import { paymentSDK } from '../../payment-sdk';
import { configElementRoutes, paymentRoutes, stripeWebhooksRoutes } from '../../routes/stripe-payment.route';
import { StripePaymentService } from '../../services/stripe-payment.service';
import { StripeHeaderAuthHook } from '../../libs/fastify/hooks/stripe-header-auth.hook';
import { StripeCustomerService } from '../../services/stripe-customer.service';
import { customerRoutes } from '../../routes/stripe-customer.route';
import { subscriptionRoutes } from '../../routes/stripe-subscription.route';
import { StripeSubscriptionService } from '../../services/stripe-subscription.service';

export default async function (server: FastifyInstance) {
  const stripeCustomerService = new StripeCustomerService(paymentSDK.ctCartService);

  const stripeSubscriptionService = new StripeSubscriptionService({
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
    ctOrderService: paymentSDK.ctOrderService,
  });

  const stripePaymentService = new StripePaymentService({
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
    ctOrderService: paymentSDK.ctOrderService,
  });

  await server.register(customerRoutes, {
    customerService: stripeCustomerService,
    sessionHeaderAuthHook: paymentSDK.sessionHeaderAuthHookFn,
  });

  await server.register(subscriptionRoutes, {
    subscriptionService: stripeSubscriptionService,
    sessionHeaderAuthHook: paymentSDK.sessionHeaderAuthHookFn,
    oauth2AuthHook: paymentSDK.oauth2AuthHookFn,
    authorizationHook: paymentSDK.authorityAuthorizationHookFn,
  });

  await server.register(paymentRoutes, {
    paymentService: stripePaymentService,
    sessionHeaderAuthHook: paymentSDK.sessionHeaderAuthHookFn,
  });

  const stripeHeaderAuthHook = new StripeHeaderAuthHook();
  await server.register(stripeWebhooksRoutes, {
    paymentService: stripePaymentService,
    stripeHeaderAuthHook: stripeHeaderAuthHook,
  });

  await server.register(configElementRoutes, {
    paymentService: stripePaymentService,
    sessionHeaderAuthHook: paymentSDK.sessionHeaderAuthHookFn,
  });
}
