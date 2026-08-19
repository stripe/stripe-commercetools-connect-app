import {
  DropinType,
  EnablerOptions,
  PaymentComponentBuilder,
  PaymentDropinBuilder,
  PaymentEnabler,
  PaymentResult,
  StripeConfig,
} from "./payment-enabler";
import { DropinEmbeddedBuilder } from "../dropin/dropin-embedded";
import {
  Appearance,
  LayoutObject,
  loadStripe,
  Stripe,
  StripeElementLocale,
  StripeElements,
  StripeElementsOptionsMode,
  StripeExpressCheckoutElement,
  StripeExpressCheckoutElementOptions,
  StripePaymentElement,
  StripePaymentElementOptions,
} from "@stripe/stripe-js";
import {
  ConfigElementResponseSchemaDTO,
  ConfigResponseSchemaDTO,
  CustomerResponseSchemaDTO,
  PaymentResponseSchemaDTO,
} from "../dtos/mock-payment.dto.ts";
import { parseJSON } from "../utils/index.ts";
import { apiService, ApiService } from "../services/api-service.ts";

declare global {
  interface ImportMeta {
    // @ts-ignore
    env: any;
  }
}

export interface BaseOptions {
  sdk: Stripe;
  environment: string;
  processorUrl: string;
  sessionId: string;
  locale?: string;
  onComplete: (result: PaymentResult) => void;
  onError: (error?: any) => void;
  paymentElement: StripePaymentElement | StripeExpressCheckoutElement; // MVP https://docs.stripe.com/payments/payment-element | https://docs.stripe.com/elements/express-checkout-element
  paymentElementValue: "paymentElement" | "expressCheckout";
  elements: StripeElements; // MVP https://docs.stripe.com/js/elements_object
  paymentMode: StripeElementsOptionsMode["mode"];
  stripeCustomerId?: string;
  stripeConfig?: StripeConfig;
  /**
   * Elements initialization strategy the processor resolved for this cart. DIAGNOSTIC ONLY — do not
   * branch on it. It reports what the processor decided, which is not the same as what this Element
   * actually did: fetchPiFirstPayment() can opt a 'pi_first' cart back out (Express Checkout, or a
   * subscription/setup cart), leaving this 'pi_first' with no piFirstResponse. Branch on
   * piFirstResponse instead, which is the state that actually determines how submit must behave.
   */
  flowType?: "deferred" | "pi_first";
  /**
   * Full /payments response cached by _Setup() when the eager fetch ran. Its presence is the single
   * source of truth for "this Element is bound to a pre-created PaymentIntent": createPayment() reads
   * from here and never calls getPayment() again. Held in a closure only: never persisted to
   * localStorage or sessionStorage, and never included in an onError or telemetry payload.
   */
  piFirstResponse?: PaymentResponseSchemaDTO;
}

interface ElementsOptions {
  type: string;
  options: Record<string, any>;
  onComplete: (result: PaymentResult) => void;
  onError: (error?: any) => void;
  layout: LayoutObject;
  appearance: Appearance;
  fields?: StripePaymentElementOptions["fields"];
  billingAddressRequired: boolean;
  shippingAddressRequired: boolean;
}

export class MockPaymentEnabler implements PaymentEnabler {
  setupData: Promise<{ baseOptions: BaseOptions }>;

  constructor(options: EnablerOptions) {
    this.setupData = MockPaymentEnabler._Setup(options);
  }

  private static _Setup = async (
    options: EnablerOptions,
  ): Promise<{ baseOptions: BaseOptions }> => {
    const { getCustomerOptions, getConfigData, getPayment } = apiService({
      baseApi: options.processorUrl,
      sessionId: options.sessionId,
    });
    //TEST: options.paymentElementType = 'expressCheckout'; to test express checkout uncomment this line
    const [cartInfoResponse, configEnvResponse] = await getConfigData(
      options.paymentElementType,
    );
    const customer = await getCustomerOptions();
    const stripeSDK = await MockPaymentEnabler.getStripeSDK(configEnvResponse);

    // Merge frontend options with backend configuration (frontend overrides backend)
    const mergedConfig = MockPaymentEnabler.mergeConfiguration(
      cartInfoResponse,
      options,
    );

    const piFirstResponse = await MockPaymentEnabler.fetchPiFirstPayment(
      options,
      cartInfoResponse,
      getPayment,
    );

    const elements = MockPaymentEnabler.getElements(
      stripeSDK,
      mergedConfig,
      customer,
      options.locale,
      piFirstResponse?.clientSecret,
    );
    const elementsOptions = MockPaymentEnabler.getElementsOptions(
      options,
      mergedConfig,
    );

    return Promise.resolve({
      baseOptions: {
        sdk: stripeSDK,
        environment: configEnvResponse.publishableKey.includes("_test_")
          ? "test"
          : configEnvResponse.environment, // MVP do we get this from the env of processor? or we leave the responsability to the publishableKey from Stripe?
        processorUrl: options.processorUrl,
        sessionId: options.sessionId,
        onComplete: options.onComplete || (() => {}),
        onError: options.onError || (() => {}),
        paymentElement: MockPaymentEnabler.getPaymentElement(
          elementsOptions,
          options.paymentElementType,
          elements,
        ),
        paymentElementValue: mergedConfig.webElements,
        elements: elements,
        paymentMode: mergedConfig.paymentMode,
        stripeCustomerId: customer ? customer?.stripeCustomerId : undefined,
        stripeConfig: options.stripeConfig,
        ...(cartInfoResponse.flowType && {
          flowType: cartInfoResponse.flowType,
        }),
        ...(piFirstResponse && { piFirstResponse }),
      },
    });
  };

  async createComponentBuilder(
    type: string,
  ): Promise<PaymentComponentBuilder | never> {
    const { baseOptions } = await this.setupData;
    const supportedMethods = {};

    if (!Object.keys(supportedMethods).includes(type)) {
      throw new Error(
        `Component type not supported: ${type}. Supported types: ${Object.keys(
          supportedMethods,
        ).join(", ")}`,
      );
    }

    return new supportedMethods[type](baseOptions);
  }

  async createDropinBuilder(
    type: DropinType,
  ): Promise<PaymentDropinBuilder | never> {
    const setupData = await this.setupData;
    if (!setupData) {
      throw new Error("StripePaymentEnabler not initialized");
    }
    const supportedMethods = {
      embedded: DropinEmbeddedBuilder,
      // hpp: DropinHppBuilder,
    };

    if (!Object.keys(supportedMethods).includes(type)) {
      throw new Error(
        `Component type not supported: ${type}. Supported types: ${Object.keys(
          supportedMethods,
        ).join(", ")}`,
      );
    }
    return new supportedMethods[type](setupData.baseOptions);
  }

  private static async getStripeSDK(
    configEnvResponse: ConfigResponseSchemaDTO,
  ): Promise<Stripe | null> {
    try {
      const sdk = await loadStripe(configEnvResponse.publishableKey);
      if (!sdk) throw new Error("Failed to load Stripe SDK.");
      return sdk;
    } catch (error) {
      console.error("Error loading Stripe SDK:", error);
      throw error; // or handle based on your requirements
    }
  }

  /**
   * pi_first: create the PaymentIntent BEFORE the Element mounts, so there is a clientSecret to hand
   * to stripe.elements({ clientSecret }). Bank transfers (customer_balance) and BLIK cannot use the
   * deferred intent flow at all — Stripe requires clientSecret-based initialization for them.
   *
   * Returns undefined for every cart that must stay on the deferred path — which is more than just
   * "flowType is not pi_first": each guard below opts a pi_first cart back out. Whenever it returns
   * undefined, getElements takes its existing branch and createPayment() still calls getPayment() at
   * submit, so behaviour is identical to before this port. That is the release-gate property.
   *
   * MUST NOT be retried. The processor's /payments has no deterministic idempotency key (it uses
   * crypto.randomUUID()) and handleCtPaymentCreation always creates a NEW commercetools Payment rather
   * than reusing the cart's existing one, so every extra call leaks an orphan PaymentIntent AND an
   * orphan CT Payment.
   *
   * Be precise about the guarantee this actually gives, because it is weaker than "once per mount":
   * _Setup() runs once per MockPaymentEnabler CONSTRUCTION, and its promise is memoised in setupData,
   * so repeated createDropinBuilder()/mount() calls on one instance reuse the same PaymentIntent. But
   * anything that re-instantiates the enabler — a React remount, StrictMode's double invoke, a
   * storefront that constructs one per render — fetches again and orphans the previous pair. Nothing
   * in the enabler can prevent that; deduplication has to come from a deterministic idempotency key on
   * the processor, or from reusing the cart's existing Initial CT Payment. This is an OPEN risk, not a
   * solved one.
   *
   * flowType is read from the RAW processor response, never from mergeConfiguration's output.
   * mergeConfiguration exists to let a frontend stripeConfig override presentation (appearance,
   * layout, collectBillingAddress). flowType is not presentation: the processor resolves it from
   * merchant configuration via resolveTrustedPaymentBehavior precisely so a shopper cannot select it.
   * Reading the raw response keeps that true by construction if someone later widens
   * mergeConfiguration, rather than relying on nobody widening it.
   */
  private static async fetchPiFirstPayment(
    options: EnablerOptions,
    cartInfoResponse: ConfigElementResponseSchemaDTO,
    getPayment: ApiService["getPayment"],
  ): Promise<PaymentResponseSchemaDTO | undefined> {
    if (cartInfoResponse.flowType !== "pi_first") return undefined;

    // Payment Element only. Express Checkout elements need { mode, amount, currency }: the dropin
    // calls elements.update({ amount }) from updateElementTotalAmount when the shopper changes
    // shipping address or rate, and again from the 'cancel' handler when the wallet sheet is
    // dismissed — update() is rejected on a clientSecret-based instance. Without this guard, Express
    // would break for every cart matching a pi_first rule. Written as an allow-list rather than
    // !== 'expressCheckout' because EnablerOptions types paymentElementType as a plain string: no
    // type guarantees the values, so an unset or unrecognised one must also stay on the deferred
    // path, which is the safe side.
    if (options.paymentElementType !== "paymentElement") return undefined;

    // One-time payments only. paymentMode is 'subscription' or 'setup' for a cart carrying a
    // subscription line item, and in those modes submit() calls createSubscription() or
    // createSetupIntent() and NEVER getPayment(). An eager /payments call there would create a
    // one-time PaymentIntent plus a CT Payment that nothing ever confirms — orphans with no
    // compensating path, not even the webhook fixup. ct-connect-stripe-checkout needs no such guard
    // because it hardcodes mode: 'payment'; this connector resolves three modes.
    //
    // SIDE EFFECT WORTH NAMING, because the obvious reading of it is wrong: this line is also why a
    // subscription cart shows NO bank-transfer tab. That is a limitation of THIS CONNECTOR, not of
    // Stripe. Stripe's bank transfer documentation lists recurring payments as supported and lists
    // Subscriptions among the products where the method can be enabled from the Dashboard.
    //
    // The reason we have not built it is a real product gap rather than a missing flag. A one-time
    // bank transfer is pushed by the shopper against that specific PaymentIntent, with a reference.
    // A subscription renewal instead DEBITS THE CUSTOMER'S STRIPE CASH BALANCE, which the shopper
    // must have PRE-FUNDED — that is what Stripe's footnote means by "requires customer action to
    // ensure there are always sufficient funds". Supporting it needs a top-up flow the storefront
    // does not have, handling for a renewal that finds an empty balance, and reconciliation of
    // customer_cash_balance_transaction events against commercetools, which today is log-only
    // (see the processor's cash balance handler and KI-041 on unreconciled clawbacks).
    //
    // Bank transfer is one-time payments only — see ADR-011.
    //
    // So this line is not a gap awaiting work: it is the product boundary, implemented. The
    // pre-funded balance model described above is exactly why. Do not relax this guard to "add
    // subscription support" — that support was considered and declined.
    //
    // The same ADR records the guest constraint: bank transfer only works for a registered
    // customer flow, because the Payment Element will not render it without a Stripe Customer object.
    // For a reference implementation of the whole workflow, Stripe's Salesforce Commerce Cloud
    // connector is public and already does this.
    if (cartInfoResponse.paymentMode !== "payment") return undefined;

    // The same options createPayment() would have sent at submit. Under pi_first the PaymentIntent is
    // created here instead, so not forwarding them would silently drop the merchant's per-method
    // configuration (pix.expires_after_seconds, boleto.expires_after_days, ...).
    const response = await getPayment(
      options.stripeConfig?.paymentIntent?.paymentMethodOptions,
    );

    // Fail loudly rather than mount an Element bound to nothing. The field is `clientSecret`:
    // ct-connect-stripe-checkout names the same field `sClientSecret`, so a textual port of its
    // validation would read undefined here and throw on every valid response.
    if (!response.clientSecret || !response.paymentReference) {
      // By the time we get here the PaymentIntent, the commercetools Payment and the cart freeze have
      // ALREADY happened server-side, so this response describes an orphan. Log the commercetools
      // identifiers — never the clientSecret, and never the response object, which would put a Stripe
      // payload in the console — because they are the only handle an operator has to find it.
      console.error(
        "pi_first: unusable /payments response; a PaymentIntent and CT Payment are likely orphaned",
        {
          cartId: response.cartId,
          paymentReference: response.paymentReference,
          hasClientSecret: Boolean(response.clientSecret),
        },
      );
      const error = new Error(
        "pi_first: /payments response is missing clientSecret or paymentReference",
      );
      // Notify the merchant explicitly. _Setup()'s rejection reaches nobody's error handler on its
      // own: options.onError is wired only into the dropin's submit() catch, and the constructor
      // stores this promise without awaiting it, so the rejection would surface as an unhandled
      // rejection in the console and nowhere else. Still throw afterwards, so setupData rejects and
      // createDropinBuilder() fails instead of handing back an Element bound to no PaymentIntent.
      options.onError?.(error);
      throw error;
    }

    return response;
  }

  private static getElements(
    stripeSDK: Stripe | null,
    cartInfoResponse: ConfigElementResponseSchemaDTO,
    customer?: CustomerResponseSchemaDTO,
    locale?: string,
    piClientSecret?: string,
  ): StripeElements | null {
    if (!stripeSDK) return null;
    try {
      const {
        cartInfo,
        captureMethod,
        appearance,
        setupFutureUsage,
        paymentMode,
      } = cartInfoResponse;
      if (piClientSecret) {
        // pi_first: bind Elements to the PaymentIntent fetchPiFirstPayment already created.
        //
        // Two different reasons for the omissions below, and they must not be conflated:
        //
        // FORCED by the SDK type. StripeElementsOptionsClientSecret declares `mode?: never` and does
        // not declare `amount`, `setupFutureUsage` or `captureMethod` at all — those live on
        // StripeElementsOptionsModeBase. The PaymentIntent already carries all four, set by the
        // processor, so there is nothing to lose here.
        //
        // CHOSEN by us. `customerOptions` and `customerSessionClientSecret` ARE permitted alongside
        // clientSecret — StripeElementsOptionsClientSecret extends BaseStripeElementsOptions, which
        // declares both. We omit them anyway, and the cost is real: pi_first carts do not display the
        // shopper's saved payment methods. Three reasons it is still the right trade-off. It matches
        // ct-connect-stripe-checkout, so the two connectors fail and succeed identically. The SDK
        // marks customerOptions as requiring beta access, so it is not a freely available capability.
        // And `setupFutureUsage` genuinely cannot be passed here, so wiring customerOptions alone
        // would let a pi_first cart DISPLAY saved methods while being unable to SAVE a new one — a
        // half-capability, which is harder to document and support than an absent one.
        //
        // The payment methods pi_first exists for (bank transfers, BLIK) are not card-vaulting
        // methods, so nothing SB3-207 needs is blocked by this. Revisit only with a concrete request.
        return stripeSDK.elements?.({
          clientSecret: piClientSecret,
          appearance: parseJSON(appearance),
          ...(locale && { locale: locale as StripeElementLocale }),
        });
      }
      return stripeSDK.elements?.({
        mode: paymentMode,
        amount: paymentMode !== "setup" ? cartInfo.amount : undefined,
        currency: cartInfo.currency.toLowerCase(),
        appearance: parseJSON(appearance),
        captureMethod,
        ...(locale && { locale: locale as any }),
        ...(customer && {
          customerOptions: {
            customer: customer.stripeCustomerId,
            ephemeralKey: customer.ephemeralKey,
          },
          setupFutureUsage,
          customerSessionClientSecret: customer.sessionId,
        }),
      });
    } catch (error) {
      console.error("Error initializing elements:", error);
      return null;
    }
  }

  private static getElementsOptions(
    options: EnablerOptions,
    config: ConfigElementResponseSchemaDTO,
  ): ElementsOptions {
    const { appearance, layout, collectBillingAddress } = config;
    return {
      type: "payment",
      options: {},
      onComplete: options.onComplete,
      onError: options.onError,
      layout: this.getLayoutObject(layout),
      appearance: parseJSON(appearance),
      ...(collectBillingAddress !== "auto" && {
        fields: {
          billingDetails: {
            address: collectBillingAddress,
          },
        },
      }),
      billingAddressRequired: true, // Used for express checkout, this will be updated in the future to be more dynamic
      shippingAddressRequired: true, // Used for express checkout, this will be updated in the future to be more dynamic
    };
  }

  private static getPaymentElement(
    elementsOptions: ElementsOptions,
    paymentElementType: string,
    elements: StripeElements,
  ): StripePaymentElement | StripeExpressCheckoutElement {
    if (paymentElementType === "expressCheckout") {
      return elements.create(
        "expressCheckout",
        elementsOptions as StripeExpressCheckoutElementOptions,
      );
    } else {
      return elements.create(
        "payment",
        elementsOptions as StripePaymentElementOptions,
      );
    }
  }

  private static getLayoutObject(layout: string): LayoutObject {
    if (layout) {
      const parsedObject = parseJSON<LayoutObject>(layout);
      const isValid = this.validateLayoutObject(parsedObject);
      if (isValid) {
        return parsedObject;
      }
    }

    return {
      type: "tabs",
      defaultCollapsed: false,
    };
  }

  private static validateLayoutObject(layout: LayoutObject): boolean {
    if (!layout) return false;
    const validLayouts = ["tabs", "accordion", "auto"];
    return validLayouts.includes(layout.type);
  }

  /**
   * Merges frontend stripeConfig with backend configuration.
   * Frontend stripeConfig takes priority over backend configuration when provided.
   *
   * @param backendConfig - Configuration from the processor (backend)
   * @param frontendOptions - Options passed to the Enabler constructor (frontend)
   * @returns Merged configuration with frontend overrides applied
   */
  private static mergeConfiguration(
    backendConfig: ConfigElementResponseSchemaDTO,
    frontendOptions: EnablerOptions,
  ): ConfigElementResponseSchemaDTO {
    const elementsConfig = frontendOptions.stripeConfig?.elements;

    // Early return: if no frontend config, return backend config as-is
    if (!elementsConfig) {
      return backendConfig;
    }

    return {
      ...backendConfig,

      // Appearance: stripeConfig.elements.appearance overrides backend if provided
      appearance: elementsConfig.appearance
        ? JSON.stringify(elementsConfig.appearance)
        : backendConfig.appearance,

      // Layout: stripeConfig.elements.layout overrides backend if provided
      layout: elementsConfig.layout
        ? JSON.stringify(elementsConfig.layout)
        : backendConfig.layout,

      // Billing address collection: stripeConfig.elements.collectBillingAddress overrides backend if provided
      collectBillingAddress:
        elementsConfig.collectBillingAddress ??
        backendConfig.collectBillingAddress,
    };
  }
}
