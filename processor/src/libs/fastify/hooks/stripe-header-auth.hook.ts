import { FastifyRequest } from 'fastify';
import { ErrorAuthErrorResponse } from '@commercetools/connect-payments-sdk';

export class StripeHeaderAuthHook {
  public authenticate() {
    return async (request: FastifyRequest): Promise<void> => {
      if (request.headers['stripe-signature']) {
        return;
      }
      throw new ErrorAuthErrorResponse('Stripe signature is not valid');
    };
  }
}
