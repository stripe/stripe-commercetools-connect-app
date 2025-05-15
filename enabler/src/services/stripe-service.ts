import {
  BillingDetails,
  PaymentIntent,
  SetupIntent,
  Stripe,
  StripeElements,
} from "@stripe/stripe-js";
import { SubscriptionResponseSchemaDTO } from "../dtos/mock-payment.dto";
import { parseJSON } from "../utils";

export interface StripeServiceProps {
  stripe: Stripe;
  elements: StripeElements;
}

export interface StripeService {
  confirmStripePayment: (
    data: SubscriptionResponseSchemaDTO
  ) => Promise<PaymentIntent>;
  confirmStripeSetupIntent: (data: {
    clientSecret: string;
    returnUrl: string;
    billingAddress?: string;
  }) => Promise<SetupIntent>;
}

export const stripeService = ({
  stripe,
  elements,
}: StripeServiceProps): StripeService => {
  const confirmStripePayment = async ({
    cartId,
    clientSecret,
    paymentReference,
    merchantReturnUrl,
    billingAddress,
  }: SubscriptionResponseSchemaDTO): Promise<PaymentIntent> => {
    const address = billingAddress
      ? parseJSON<BillingDetails>(billingAddress)
      : undefined;
    const returnUrl = new URL(merchantReturnUrl);
    returnUrl.searchParams.append("cartId", cartId);
    returnUrl.searchParams.append("paymentReference", paymentReference);

    const { error, paymentIntent } = await stripe.confirmPayment({
      confirmParams: {
        return_url: returnUrl.toString(),
        ...(address && {
          payment_method_data: {
            billing_details: address,
          },
        }),
      },
      redirect: "if_required",
      clientSecret,
      elements,
    });

    if (error) {
      throw error;
    }

    return paymentIntent;
  };

  const confirmStripeSetupIntent = async ({
    clientSecret,
    returnUrl,
    billingAddress,
  }: {
    clientSecret: string;
    returnUrl: string;
    billingAddress?: string;
  }) => {
    const address = billingAddress
      ? parseJSON<BillingDetails>(billingAddress)
      : undefined;
    const { error, setupIntent } = await stripe.confirmSetup({
      clientSecret: clientSecret,
      elements: elements,
      confirmParams: {
        return_url: returnUrl,
        ...(address
          ? {
              payment_method_data: {
                billing_details: address,
              },
            }
          : undefined),
      },
      redirect: "if_required",
    });

    if (error) {
      throw error;
    }

    return setupIntent;
  };

  return {
    confirmStripePayment,
    confirmStripeSetupIntent,
  };
};
