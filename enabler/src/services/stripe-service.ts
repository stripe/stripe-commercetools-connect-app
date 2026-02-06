import {
  BillingDetails,
  PaymentIntent,
  SetupIntent,
  Stripe,
  StripeElements,
} from "@stripe/stripe-js";
import {
  PaymentResponseSchemaDTO,
  SetupIntentResponseSchemaDTO,
} from "../dtos/mock-payment.dto";
import { parseJSON } from "../utils";

export interface StripeServiceProps {
  stripe: Stripe;
  elements: StripeElements;
}

export interface StripeService {
  confirmStripePayment: (
    data: PaymentResponseSchemaDTO
  ) => Promise<PaymentIntent>;
  confirmStripeSetupIntent: (
    data: SetupIntentResponseSchemaDTO
  ) => Promise<SetupIntent>;
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
  }: PaymentResponseSchemaDTO): Promise<PaymentIntent> => {
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

    if (paymentIntent.status === "requires_action") {
      // Boleto: voucher was generated successfully - this is the expected flow
      if (paymentIntent.next_action?.type === "boleto_display_details") {
        return paymentIntent;
      }

      // For all other requires_action types, follow the original flow
      const error: any = new Error("Payment requires additional action");
      error.type = "requires_action";
      error.next_action = paymentIntent.next_action;
      throw error;
    }
    if(paymentIntent.last_payment_error) {
      const error: any = new Error(`${paymentIntent.last_payment_error.message}`);
      error.type = "payment_failed";
      error.last_payment_error = paymentIntent.last_payment_error;
      throw error;
    } 

    return paymentIntent;
  };

  const confirmStripeSetupIntent = async ({
    clientSecret,
    merchantReturnUrl,
    billingAddress,
  }: SetupIntentResponseSchemaDTO) => {
    const address = billingAddress
      ? parseJSON<BillingDetails>(billingAddress)
      : undefined;
    const { error, setupIntent } = await stripe.confirmSetup({
      clientSecret: clientSecret,
      elements: elements,
      confirmParams: {
        return_url: merchantReturnUrl,
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
