import crypto from 'crypto';
import Stripe from 'stripe';
import {
  Cart,
  ErrorInvalidOperation,
  Errorx,
  healthCheckCommercetoolsPermissions,
  statusHandler,
  TransactionData,
} from '@commercetools/connect-payments-sdk';
import { EuBankTransferCountry, getBankTransferOptions } from '../mappers/bank-transfer-mapper';
import {
  CancelPaymentRequest,
  CapturePaymentRequest,
  ConfigResponse,
  PaymentProviderModificationResponse,
  RefundPaymentRequest,
  ReversePaymentRequest,
  StatusResponse,
} from './types/operation.type';
import { SupportedPaymentComponentsSchemaDTO } from '../dtos/operations/payment-componets.dto';
import { PaymentModificationStatus, PaymentTransactions } from '../dtos/operations/payment-intents.dto';
import packageJSON from '../../package.json';
import { AbstractPaymentService } from './abstract-payment.service';
import { getConfig } from '../config/config';
import { appLogger, paymentSDK } from '../payment-sdk';
import {
  CaptureMethod,
  CreateOrderProps,
  PaymentStatus,
  StripeEvent,
  StripeEventUpdatePayment,
  StripePaymentServiceOptions,
} from './types/stripe-payment.type';
import {
  CollectBillingAddressOptions,
  ConfigElementResponseSchemaDTO,
  PaymentOutcome,
  PaymentResponseSchemaDTO,
} from '../dtos/stripe-payment.dto';
import { getCartIdFromContext, getMerchantReturnUrlFromContext } from '../libs/fastify/context/context';
import { stripeApi, wrapStripeError } from '../clients/stripe.client';
import { log } from '../libs/logger';
import { StripeEventConverter } from './converters/stripeEventConverter';
import { convertPaymentResultCode } from '../utils';
import { CtPaymentCreationService } from './ct-payment-creation.service';
import { stripeCustomerIdFieldName } from '../custom-types/custom-types';
import { StripeCustomerService } from './stripe-customer.service';
import { getCartExpanded, updateCartById, freezeCart, unfreezeCart, isCartFrozen } from './commerce-tools/cart-client';
import {
  METADATA_CART_ID_FIELD,
  METADATA_ORDER_ID_FIELD,
  METADATA_PAYMENT_ID_FIELD,
  CT_CUSTOM_FIELD_TAX_CALCULATIONS,
} from '../constants';
import { addOrderPayment, createOrderFromCart } from './commerce-tools/order-client';
import {
  PaymentBehaviorRule,
  extractDiscriminator,
  resolvePaymentBehavior,
  resolveTrustedPaymentBehavior,
} from './payment-behavior-resolver';
import { StripeSubscriptionService } from './stripe-subscription.service';
import { CartUpdateAction } from '@commercetools/platform-sdk';

/**
 * Async settlement events that write a Pending authorization to commercetools.
 *
 * They share two behaviors: they are deduplicated on the way in (Stripe does not guarantee
 * ordering and may redeliver), and a commercetools write failure is re-thrown so Stripe
 * retries instead of the divergence being silently swallowed.
 *
 * `payment_intent.partially_funded` is deliberately NOT a member: it writes no transaction,
 * so a lost event costs an audit line rather than correctness, and re-throwing would cause a
 * retry storm on a frequent event.
 */
const ASYNC_PENDING_EVENTS: readonly StripeEvent[] = [
  StripeEvent.PAYMENT_INTENT__PROCESSING,
  StripeEvent.PAYMENT_INTENT__REQUIRED_ACTION,
];

/**
 * Events that must still persist their interface interaction when the converter produces no
 * transaction, so the event leaves an audit trail instead of being silently discarded.
 */
const ZERO_TRANSACTION_PERSIST_EVENTS: readonly StripeEvent[] = [
  StripeEvent.CHARGE__SUCCEEDED,
  StripeEvent.PAYMENT_INTENT__PARTIALLY_FUNDED,
];

export class StripePaymentService extends AbstractPaymentService {
  private stripeEventConverter: StripeEventConverter;
  private customerService: StripeCustomerService;
  private paymentCreationService: CtPaymentCreationService;

  constructor(opts: StripePaymentServiceOptions) {
    super(opts.ctCartService, opts.ctPaymentService, opts.ctOrderService);
    this.stripeEventConverter = new StripeEventConverter();
    this.customerService = new StripeCustomerService(opts.ctCartService);
    this.paymentCreationService = new CtPaymentCreationService({
      ctCartService: opts.ctCartService,
      ctPaymentService: opts.ctPaymentService,
    });
  }

  /**
   * Get configurations
   *
   * @remarks
   * Implementation to provide mocking configuration information
   *
   * @returns Promise with mocking object containing configuration information
   */
  public async config(): Promise<ConfigResponse> {
    const config = getConfig();
    return {
      environment: config.mockEnvironment,
      publishableKey: config.stripePublishableKey,
    };
  }

  /**
   * Get status
   *
   * @remarks
   * Implementation to provide mocking status of external systems
   *
   * @returns Promise with mocking data containing a list of status from different external systems
   */
  public async status(): Promise<StatusResponse> {
    const handler = await statusHandler({
      timeout: getConfig().healthCheckTimeout,
      log: appLogger,
      checks: [
        healthCheckCommercetoolsPermissions({
          requiredPermissions: [
            'manage_payments',
            'view_sessions',
            'view_api_clients',
            'manage_orders',
            'introspect_oauth_tokens',
            'manage_checkout_payment_intents',
            'manage_types',
          ],
          ctAuthorizationService: paymentSDK.ctAuthorizationService,
          projectKey: getConfig().projectKey,
        }),
        async () => {
          try {
            const paymentMethods = await stripeApi().paymentMethods.list({
              limit: 3,
            });
            return {
              name: 'Stripe Status check',
              status: 'UP',
              message: 'Stripe api is working',
              details: {
                paymentMethods,
              },
            };
          } catch (e) {
            return {
              name: 'Stripe Status check',
              status: 'DOWN',
              message: 'The mock paymentAPI is down for some reason. Please check the logs for more details.',
              details: {
                error: e,
              },
            };
          }
        },
      ],
      metadataFn: async () => ({
        name: packageJSON.name,
        description: packageJSON.description,
        '@commercetools/connect-payments-sdk': packageJSON.dependencies['@commercetools/connect-payments-sdk'],
        stripe: packageJSON.dependencies['stripe'],
      }),
    })();

    return handler.body;
  }

  /**
   * Get supported payment components
   *
   * @remarks
   * Implementation to provide the mocking payment components supported by the processor.
   *
   * @returns Promise with mocking data containing a list of supported payment components
   */
  public async getSupportedPaymentComponents(): Promise<SupportedPaymentComponentsSchemaDTO> {
    return {
      dropins: [
        {
          type: 'embedded',
        },
      ],
      components: [],
    };
  }

  /**
   * Capture payment in Stripe, supporting multicapture (multiple partial captures).
   *
   * @remarks
   * Supports capturing the total or a partial amount multiple times, as allowed by Stripe.
   * Partial captures are only allowed when STRIPE_ENABLE_MULTI_OPERATIONS is enabled.
   *
   * @param {CapturePaymentRequest} request - Information about the ct payment and the amount.
   * @returns Promise with data containing operation status and PSP reference
   */
  public async capturePayment(request: CapturePaymentRequest): Promise<PaymentProviderModificationResponse> {
    try {
      const config = getConfig();
      const paymentIntentId = request.payment.interfaceId as string;
      const amountToBeCaptured = request.amount.centAmount;
      const stripePaymentIntent: Stripe.PaymentIntent = await stripeApi().paymentIntents.retrieve(paymentIntentId);

      if (!request.payment.amountPlanned.centAmount) {
        throw new Error('Payment amount is not set');
      }

      const cartTotalAmount = request.payment.amountPlanned.centAmount;
      const isPartialCapture = stripePaymentIntent.amount_received + amountToBeCaptured < cartTotalAmount;

      // Check if partial capture is attempted without multicapture enabled
      if (isPartialCapture && !config.stripeEnableMultiOperations) {
        log.error('Partial capture attempted without STRIPE_ENABLE_MULTI_OPERATIONS enabled', {
          paymentId: paymentIntentId,
          amountToBeCaptured,
          amountReceived: stripePaymentIntent.amount_received,
          cartTotalAmount,
        });
        throw new Error(
          'Partial captures require STRIPE_ENABLE_MULTI_OPERATIONS=true and multicapture support in your Stripe account',
        );
      }

      const response = await stripeApi().paymentIntents.capture(paymentIntentId, {
        amount_to_capture: amountToBeCaptured,
        ...(isPartialCapture &&
          config.stripeEnableMultiOperations && {
            final_capture: false,
          }),
      });

      log.info(`Payment modification completed.`, {
        paymentId: paymentIntentId,
        action: PaymentTransactions.CHARGE,
        result: PaymentModificationStatus.APPROVED,
        trackingId: response.id,
        isPartialCapture: isPartialCapture,
        multiOperationsEnabled: config.stripeEnableMultiOperations,
      });

      return {
        outcome: PaymentModificationStatus.APPROVED,
        pspReference: response.id,
      };
    } catch (error) {
      log.error('Error capturing payment in Stripe', { error });
      return {
        outcome: PaymentModificationStatus.REJECTED,
        pspReference: request.payment.interfaceId as string,
      };
    }
  }

  /**
   * Cancel payment in Stripe.
   *
   * @param {CancelPaymentRequest} request - contains amount and {@link https://docs.commercetools.com/api/projects/payments | Payment } defined in composable commerce
   * @returns Promise with mocking data containing operation status and PSP reference
   */
  public async cancelPayment(request: CancelPaymentRequest): Promise<PaymentProviderModificationResponse> {
    try {
      const paymentIntentId = request.payment.interfaceId as string;
      const response = await stripeApi().paymentIntents.cancel(paymentIntentId);

      log.info(`Payment modification completed.`, {
        paymentId: paymentIntentId,
        action: PaymentTransactions.CANCEL_AUTHORIZATION,
        result: PaymentModificationStatus.APPROVED,
        trackingId: response.id,
      });

      return { outcome: PaymentModificationStatus.APPROVED, pspReference: response.id };
    } catch (error) {
      log.error('Error canceling payment in Stripe', { error });
      return {
        outcome: PaymentModificationStatus.REJECTED,
        pspReference: request.payment.interfaceId as string,
      };
    }
  }

  /**
   * Refund payment in Stripe.
   *
   * @remarks
   * Creates a refund in Stripe. When STRIPE_ENABLE_MULTI_OPERATIONS is disabled,
   * webhook-based refund tracking may be limited. Enable the feature flag for
   * full multirefund support.
   *
   * @param {RefundPaymentRequest} request - contains amount and {@link https://docs.commercetools.com/api/projects/payments | Payment } defined in composable commerce
   * @returns Promise with mocking data containing operation status and PSP reference
   */
  public async refundPayment(request: RefundPaymentRequest): Promise<PaymentProviderModificationResponse> {
    try {
      const config = getConfig();
      const paymentIntentId = request.payment.interfaceId as string;
      const amount = request.amount.centAmount;

      // Check if there are existing successful refunds
      const existingRefunds = this.ctPaymentService.hasTransactionInState({
        payment: request.payment,
        transactionType: 'Refund',
        states: ['Success'],
      });

      // Warn if multiple refunds attempted without feature enabled
      if (existingRefunds && !config.stripeEnableMultiOperations) {
        log.warn('Multiple refunds attempted without STRIPE_ENABLE_MULTI_OPERATIONS enabled', {
          paymentId: request.payment.id,
          paymentIntentId,
          amount,
          note: 'Webhook-based refund tracking may not work properly. Consider enabling STRIPE_ENABLE_MULTI_OPERATIONS.',
        });
      }

      // metadata: the ONLY way a later refund event can find its commercetools payment.
      //
      // Measured 2026-08-05: a `refund.updated` event carries `metadata: {}`. The Refund object does
      // not inherit the PaymentIntent's metadata, so getCtPaymentId — which every other handler relies
      // on — returns undefined and the event is skipped. Stamping it here makes the refund
      // self-describing, matching what ct-payment-creation.service does for PaymentIntents.
      //
      // A refund issued from the Stripe Dashboard will NOT carry this, and its terminal event is
      // therefore still unroutable. That gap is real and is not closed here; it needs a fallback that
      // resolves the PaymentIntent from `refund.payment_intent` and reads the id from there.
      //
      // idempotencyKey: refunds.create was the only Stripe write in this service without one. A
      // retried commercetools refundPayment — a client retry, a proxy replay, a redelivery — issued a
      // SECOND real refund against the same payment. Every other write here passes
      // crypto.randomUUID(), which only dedupes the SDK's own internal retries and does nothing for a
      // caller that retries; for refunds that difference is money.
      //
      // The sequence number is what makes a DETERMINISTIC key safe here. Keying on payment + amount
      // alone would silently collapse two legitimate partial refunds of the same value — a real
      // scenario, since this connector supports multi-refund — returning the first refund and leaving
      // the merchant believing both went out. Counting the Refund transactions already recorded on the
      // payment separates "the same call again" from "another refund like the last one": a retry sees
      // the same count and is deduped, while a genuine second refund is issued after the first is
      // recorded and gets its own key.
      //
      // Residual: two concurrent first-time refunds of equal amount collapse into one. They are
      // indistinguishable from a retry at this point, and collapsing is the safe direction.
      const refundSequence = (request.payment.transactions ?? []).filter((tx) => tx.type === 'Refund').length;
      // REFUND DESTINATION is deliberately not configurable. A bank-transfer refund can return to the
      // shopper's bank account or to their Stripe cash balance, and Stripe's default is used as-is.
      //
      // A per-market toggle is parked, not forgotten — worth revisiting only if a concrete
      // opportunity asks for it. Adding `origin` here without that demand would be config nobody
      // set and nobody tested. See ADR-011.
      const response = await stripeApi().refunds.create(
        {
          payment_intent: paymentIntentId,
          amount: amount,
          metadata: { [METADATA_PAYMENT_ID_FIELD]: request.payment.id },
        },
        { idempotencyKey: `refund-${request.payment.id}-${amount}-${refundSequence}` },
      );

      log.info(`Payment modification completed.`, {
        paymentId: request.payment.id,
        action: PaymentTransactions.REFUND,
        result: PaymentModificationStatus.APPROVED,
        trackingId: response.id,
        multiOperationsEnabled: config.stripeEnableMultiOperations,
        isMultipleRefund: existingRefunds,
      });

      return { outcome: PaymentModificationStatus.RECEIVED, pspReference: response.id };
    } catch (error) {
      log.error('Error refunding payment in Stripe', { error });
      return {
        outcome: PaymentModificationStatus.REJECTED,
        pspReference: request.payment.interfaceId as string,
      };
    }
  }

  /**
   * Reverse payment
   *
   * @remarks
   * Abstract method to execute payment reversals in support of automated reversals to be triggered by checkout api. The actual invocation to PSPs should be implemented in subclasses
   *
   * @param request
   * @returns Promise with outcome containing operation status and PSP reference
   */
  public async reversePayment(request: ReversePaymentRequest): Promise<PaymentProviderModificationResponse> {
    const hasCharge = this.ctPaymentService.hasTransactionInState({
      payment: request.payment,
      transactionType: 'Charge',
      states: ['Success'],
    });
    const hasRefund = this.ctPaymentService.hasTransactionInState({
      payment: request.payment,
      transactionType: 'Refund',
      states: ['Success', 'Pending'],
    });
    const hasCancelAuthorization = this.ctPaymentService.hasTransactionInState({
      payment: request.payment,
      transactionType: 'CancelAuthorization',
      states: ['Success', 'Pending'],
    });

    const wasPaymentReverted = hasRefund || hasCancelAuthorization;

    if (hasCharge && !wasPaymentReverted) {
      return this.refundPayment({
        payment: request.payment,
        merchantReference: request.merchantReference,
        amount: request.payment.amountPlanned,
      });
    }

    const hasAuthorization = this.ctPaymentService.hasTransactionInState({
      payment: request.payment,
      transactionType: 'Authorization',
      states: ['Success'],
    });
    if (hasAuthorization && !wasPaymentReverted) {
      return this.cancelPayment({ payment: request.payment });
    }

    throw new ErrorInvalidOperation('There is no successful payment transaction to reverse.');
  }

  /**
   * Creates a payment intent using the Stripe API and create commercetools payment with Initial transaction.
   *
   * @param options - Optional configuration including paymentMethodOptions from frontend
   * @return Promise<PaymentResponseSchemaDTO> A Promise that resolves to a PaymentResponseSchemaDTO object containing the client secret and payment reference.
   */
  public async createPaymentIntent(options?: {
    paymentMethodOptions?: Record<string, Record<string, unknown>>;
  }): Promise<PaymentResponseSchemaDTO> {
    try {
      const config = getConfig();
      const cart = await this.ctCartService.getCart({ id: getCartIdFromContext() });

      // Per-cart behavior rule (only when STRIPE_PAYMENT_BEHAVIOR_RULES is configured).
      // With no rules configured this is always undefined and every value below falls back to
      // the flat env vars, which is what keeps the PaymentIntent params byte-identical.
      const behaviorRule = resolvePaymentBehavior(config.stripePaymentBehaviorRules, cart);
      if (behaviorRule) {
        // Log the discriminator alongside the rule: without it an operator can see that some rule
        // matched but not which map entry produced it. Merchant config, never a Stripe payload.
        log.info('Resolved per-cart payment behavior rule.', {
          cartId: cart.id,
          discriminator: extractDiscriminator(cart),
          rule: behaviorRule,
        });
      }

      // The rule whose fields NAME A DESTINATION. TWO fields are read from it: `flowType` (drives
      // applyPiFirstOverride below) and `euBankTransferCountry` (chooses which of the merchant's bank
      // accounts a shopper wires funds to). A third, `bankTransfer`, was removed in a638d4b — whether
      // the rail exists at all is a Stripe Dashboard setting, not a connector flag.
      //
      // Contrast behaviorRule above. The distinction is NOT "changes PaymentIntent parameters" — the
      // capture method and the save mandate are PaymentIntent parameters too. It is bounded choice:
      // behaviorRule only lets a shopper SELECT AMONG policies the merchant already authored, while
      // these two name where money and instructions go. See extractCountry's docblock and KI-048.
      //
      // Resolved through resolveTrustedPaymentBehavior, NOT behaviorRule: all three must be
      // unselectable by a shopper-typed billing country (KI-046, whose Resolution names the two bank
      // transfer fields as this change's obligation). The two resolutions differ only for a cart with no
      // cart.country whose billing country happens to match a rule key.
      //
      // On flowType specifically: the enabler consumes the copy returned by initializeCartPayment, not
      // this one, and uses it to decide whether to create the PaymentIntent before mount.
      const trustedRule = resolveTrustedPaymentBehavior(config.stripePaymentBehaviorRules, cart);
      const flowType = trustedRule?.flowType ?? config.stripePaymentFlow;
      // Where the resolved value came from, for the discard log only. This mirrors
      // resolveSetupFutureUsage's rule-wins branch exactly: ONLY 'off_session'/'on_session' from a
      // rule beat the global value, because the disabling spellings ('', 'none', 'null', 'undefined')
      // make it return undefined and then there is nothing left to discard. If that branch changes,
      // change this with it — a rule matching on flowType alone must report 'global', not its own key.
      const ruleSuppliedSetupFutureUsage =
        behaviorRule?.setupFutureUsage === 'off_session' || behaviorRule?.setupFutureUsage === 'on_session';
      const setupFutureUsage = this.applyPiFirstOverride(
        flowType,
        this.resolveSetupFutureUsage(behaviorRule, cart.id),
        {
          cartId: cart.id,
          valueSource: ruleSuppliedSetupFutureUsage ? 'rule' : 'global',
          ruleKey: ruleSuppliedSetupFutureUsage ? extractDiscriminator(cart) : undefined,
        },
      );
      // The rule's captureMethod is validated at startup, so it needs no cast. Only the flat env
      // var does — it is unvalidated legacy config.
      const captureMethod = behaviorRule?.captureMethod ?? (config.stripeCaptureMethod as CaptureMethod);
      const customer = await this.customerService.getCtCustomer(cart.customerId!);
      const amountPlanned = await this.ctCartService.getPaymentAmount({ cart });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const shippingAddress = this.customerService.getStripeCustomerAddress(
        cart.shippingAddress,
        customer?.addresses[0],
      );
      const stripeCustomerId = customer?.custom?.fields?.[stripeCustomerIdFieldName];

      // Tax calculation integration
      const taxCalculationReferences = cart.custom?.fields?.[CT_CUSTOM_FIELD_TAX_CALCULATIONS] as string[] | undefined;
      const taxCalculationCount = taxCalculationReferences?.length ?? 0;
      const hasSingleTaxCalculation = taxCalculationCount === 1;
      const hasTaxCalculations = taxCalculationCount > 0;

      // Merge backend defaults with frontend options (frontend takes priority), THEN take back the one
      // key the frontend must never own.
      //
      // THAT ORDER IS THE FEATURE, not an accident to be tidied. mergePaymentMethodOptions gives the
      // client's paymentMethodOptions the last word, and that field arrives as an unvalidated
      // Record<string, Record<string, unknown>> on the POST /payments body (dtos/stripe-payment.dto.ts).
      // Applied BEFORE the merge, a browser holding a valid session could set funding_type,
      // bank_transfer.type and eu_bank_transfer.country itself — choosing the bank account the money is
      // wired to, which is exactly what payment-behavior-resolver.ts's trust boundary exists to keep
      // away from shopper input. The client's selection is a hint; the authority is the merchant's rule.
      //
      // NOTE this no longer gates the RAIL, only the IBAN. Bank transfer availability is a Stripe
      // Dashboard setting resolved through automatic_payment_methods, so there is nothing here to
      // enable — see applyBankTransferOverride and getBankTransferOptions.
      const paymentMethodOptions = this.applyBankTransferOverride(
        this.mergePaymentMethodOptions(options?.paymentMethodOptions),
        {
          currencyCode: amountPlanned.currencyCode,
          euBankTransferCountry: trustedRule?.euBankTransferCountry,
          cartId: cart.id,
        },
      );

      // NOTHING is overridden here for bank transfer, and that absence replaces a block that used to
      // force capture_method 'automatic' and discard setup_future_usage whenever a cart was "eligible".
      //
      // Both forces existed to stop a global STRIPE_CAPTURE_METHOD / STRIPE_SAVED_PAYMENT_METHODS_CONFIG
      // from excluding customer_balance behind the merchant's back. Measured 2026-08-05, that exclusion
      // is Stripe's own and is perfectly informative: capture_method 'manual' or a setup_future_usage
      // mandate simply drops customer_balance out of payment_method_types, so the tab does not render
      // and every other method still works. Silently rewriting a merchant's capture policy to restore a
      // rail they never explicitly asked for was the more surprising behavior of the two — and it
      // changed capture for EVERY method on the cart, since capture_method is PaymentIntent-level.
      //
      // A merchant who wants bank transfer in one market now says so directly, with the fields that
      // already existed: {"DE":{"captureMethod":"automatic"}}. See validateBehaviorRule.
      const effectiveCaptureMethod: CaptureMethod = captureMethod;
      const effectiveSetupFutureUsage = setupFutureUsage;

      const paymentIntent = await stripeApi().paymentIntents.create(
        this.buildPaymentIntentCreateParams({
          cart,
          amountPlanned,
          stripeCustomerId,
          setupFutureUsage: effectiveSetupFutureUsage,
          captureMethod: effectiveCaptureMethod,
          paymentMethodOptions,
          taxCalculationReference: hasSingleTaxCalculation ? taxCalculationReferences![0] : undefined,
        }),
        {
          idempotencyKey: crypto.randomUUID(),
        },
      );

      log.info(`Stripe PaymentIntent created.`, {
        ctCartId: cart.id,
        stripePaymentIntentId: paymentIntent.id,
        // Tax calculation integration
        ...(hasTaxCalculations && {
          hasTaxCalculations,
          taxCalculationCount,
        }),
        // Log if frontend options were applied
        ...(options?.paymentMethodOptions && {
          frontendPaymentMethodOptions: Object.keys(options.paymentMethodOptions),
        }),
      });

      const paymentReference = await this.paymentCreationService.handleCtPaymentCreation({
        interactionId: paymentIntent.id,
        amountPlanned,
        cart,
      });

      // THE CART IS NOT FROZEN HERE ANY MORE, and the removal is the point rather than an omission.
      //
      // Freezing on PaymentIntent creation was harmless under the deferred flow, where the
      // PaymentIntent was created when the shopper pressed pay. Under pi_first it is created when the
      // payment page MOUNTS — so the cart was frozen before the shopper picked a method, chose
      // shipping, or clicked anything, and nothing ever unfroze it. Measured in one session: 5 frozen
      // carts against 3 orders. The abandoned ones stay frozen for good, the storefront cannot add to
      // them, and the shopper has no way out. See KI-044.
      //
      // Freezing now happens at each rail's moment of COMMITMENT instead:
      //   - instant rails (card, wallets): updatePaymentIntentStripeSuccessful, on confirm
      //   - bank transfer: the payment_intent.requires_action handler, when Stripe issues funding
      //     instructions — the confirm endpoint is never called on that path, so it cannot own this
      //
      // This is only safe because the confirm gate now validates against the CURRENT cart total rather
      // than the snapshot taken at creation. Without that, moving the freeze later would trade a stuck
      // cart for an underpayment window. The two changes ship together; do not revert one alone.
      //
      // Still not solved: the PaymentIntent and commercetools Payment created at mount are still
      // orphaned when the shopper leaves. That needs a deterministic idempotency key on creation.

      return {
        cartId: cart.id,
        clientSecret: paymentIntent.client_secret!,
        paymentReference,
        merchantReturnUrl: getMerchantReturnUrlFromContext() || config.merchantReturnUrl,
        ...(config.stripeCollectBillingAddress !== 'auto' && {
          billingAddress: this.customerService.getBillingAddress(cart),
        }),
      };
    } catch (error) {
      // Let our own Errorx through untouched. wrapStripeError already returned non-Stripe errors
      // unchanged (it only wraps when `e.raw` is present), so this changes no HTTP response — what it
      // removes is the misleading `log.error('Unexpected error calling Stripe API')` that it emits on the
      // way past. That matters now: the bank transfer branch throws ErrorInvalidOperation for a config
      // problem (unsupported currency, missing euBankTransferCountry) or an ineligible request, and
      // logging those as Stripe faults sends an operator to the wrong system — the exact failure mode
      // validateBehaviorRule's docblock complains about. Real Stripe errors still go through
      // wrapStripeError and are still converted to StripeApiError.
      // This is the minimal shortcut, not the fix: wrapStripeError's own redaction and error-classification
      // problems are a separate queued change, and it is still the shared path for every other caller.
      if (error instanceof Errorx) {
        throw error;
      }
      throw wrapStripeError(error);
    }
  }

  /**
   * Resolves the `setup_future_usage` value for the PaymentIntent.
   *
   * A per-cart behavior rule wins over the global STRIPE_SAVED_PAYMENT_METHODS_CONFIG value.
   * '', 'none', 'null' and 'undefined' all mean "do not send setup_future_usage" — the vocabulary
   * is checkout's, kept identical so one rules map can serve both connectors.
   *
   * Note the asymmetry, which is deliberate: when no rule supplies a value, the global value is
   * returned UNTOUCHED. That makes the pre-refactor behavior a structural property of this
   * function instead of something a test has to discover — an odd global value keeps flowing
   * exactly as it did before.
   *
   * A rule's value arrives already canonical (trimmed, lowercased, membership-checked) because
   * getPaymentBehaviorConfig validates it at startup, so there is no normalization or
   * invalid-value fallback here. An invalid value never gets this far: it aborts boot, where a
   * deploy check catches it, instead of silently degrading one country's checkout.
   *
   * Unlike checkout there is no STRIPE_PAYMENT_INTENT_SETUP_FUTURE_USAGE flat env var here; the
   * global default is payment_method_save_usage.
   *
   * @param rule - The resolved per-cart behavior rule, if any.
   * @param cartId - Included in the log so an operator can trace which cart a rule affected.
   * @returns The setup_future_usage value, or undefined to send no value.
   */
  private resolveSetupFutureUsage(
    rule?: PaymentBehaviorRule,
    cartId?: string,
  ): Stripe.PaymentIntentCreateParams.SetupFutureUsage | undefined {
    const globalValue = getConfig().stripeSavedPaymentMethodConfig?.payment_method_save_usage as
      | Stripe.PaymentIntentCreateParams.SetupFutureUsage
      | undefined;

    const ruleValue = rule?.setupFutureUsage;
    if (ruleValue === undefined) {
      return globalValue;
    }
    if (ruleValue === 'off_session' || ruleValue === 'on_session') {
      return ruleValue;
    }
    // '', 'none', 'null', 'undefined' — the merchant asked for no setup_future_usage on this cart.
    // Log the received value: the effect is invisible to the shopper, so this is the only signal.
    log.info('PaymentIntent setup_future_usage is disabled by a per-cart behavior rule.', {
      cartId,
      ruleValue,
    });
    return undefined;
  }

  /**
   * pi_first: suppress setup_future_usage on the PaymentIntent.
   *
   * Under pi_first the PaymentIntent is created before the Element mounts and its clientSecret is
   * handed to elements(). Stripe rejects { clientSecret } together with a setupFutureUsage on the
   * Elements instance, so the value would have to live on the PI alone — and the payment methods
   * pi_first exists for (bank transfers, BLIK) are excluded outright by a setup_future_usage.
   *
   * Reachability of THIS METHOD, verified rather than assumed: it is called only on the one-time
   * createPaymentIntent path. StripeSubscriptionService runs its own off_session / SetupIntent flow
   * and never calls resolvePaymentBehavior, so pi_first cannot strip an off-session mandate from a
   * recurring cart. Note this is a claim about the method, NOT about pi_first as a whole — the same
   * suppression is applied inline in initializeCartPayment for the /config-element response.
   *
   * What is and is not inert at HEAD — the distinction matters, they are two different sources:
   *   - the GLOBAL value is inert. STRIPE_SAVED_PAYMENT_METHODS_CONFIG carries no
   *     payment_method_save_usage key in any current environment, so there is nothing to suppress.
   *     It becomes real the day a merchant configures it.
   *   - a RULE value is NOT inert. resolveSetupFutureUsage returns a rule's own setupFutureUsage,
   *     validated and live since the behavior-rule change, independently of that env var. A rule
   *     carrying both flowType: 'pi_first' and setupFutureUsage today has the latter discarded.
   * Ported from checkout's stripe-payment.service.ts:628-633; the log below is an addition.
   *
   * @param flowType - The resolved Elements initialization strategy for this cart.
   * @param setupFutureUsage - The value that would be sent under the deferred flow.
   * @param context - Log-only provenance. `valueSource` says where the discarded value came from, and
   *                  `ruleKey` is set ONLY when that source is 'rule'. Reporting a rule key beside a
   *                  globally-sourced value would send an operator to inspect a rule that never
   *                  carried a setupFutureUsage — worse than not logging at all.
   * @returns The value to send, or undefined to send none.
   */
  private applyPiFirstOverride(
    flowType: 'deferred' | 'pi_first',
    setupFutureUsage: Stripe.PaymentIntentCreateParams.SetupFutureUsage | undefined,
    context?: { cartId?: string; valueSource: 'rule' | 'global'; ruleKey?: string },
  ): Stripe.PaymentIntentCreateParams.SetupFutureUsage | undefined {
    if (flowType !== 'pi_first') {
      return setupFutureUsage;
    }
    if (setupFutureUsage !== undefined) {
      // Same signal, and same reasoning, as resolveSetupFutureUsage: the effect is invisible to the
      // shopper, so this log is the only trace that a configured value was dropped. Without it a
      // merchant who set both flowType: 'pi_first' and setupFutureUsage on one rule sees the mandate
      // silently vanish.
      log.info('PaymentIntent setup_future_usage is discarded because the cart resolves to pi_first.', {
        cartId: context?.cartId,
        valueSource: context?.valueSource,
        ...(context?.valueSource === 'rule' && { ruleKey: context.ruleKey }),
        discardedValue: setupFutureUsage,
      });
    }
    return undefined;
  }

  /**
   * Builds the params object for Stripe PaymentIntent creation.
   *
   * Extracted from createPaymentIntent so that conditional fields stay in one place and the
   * method's cognitive complexity stays under the linter threshold as more payment methods gain
   * their own branches. Named to match ct-connect-stripe-checkout's equivalent helper so that
   * porting checkout's refactor here is a rename rather than a rewrite.
   *
   * @param params - Cart, amount, config-derived values and optional customer/tax data.
   * @returns Stripe.PaymentIntentCreateParams to pass as first argument to paymentIntents.create().
   */
  private buildPaymentIntentCreateParams(params: {
    cart: Cart;
    amountPlanned: { centAmount: number; currencyCode: string };
    stripeCustomerId: string | undefined;
    setupFutureUsage: Stripe.PaymentIntentCreateParams.SetupFutureUsage | undefined;
    captureMethod: CaptureMethod;
    paymentMethodOptions: Stripe.PaymentIntentCreateParams.PaymentMethodOptions;
    /**
     * Set only when the cart carries exactly one tax calculation reference. Zero or multiple must
     * arrive here as undefined — "no tax data", never guessed.
     *
     * Deliberately the single source of truth for both the guard and the value. An earlier draft
     * passed a separate `hasSingleTaxCalculation` boolean alongside it, which split one fact into
     * two independent params and let a caller emit `calculation: undefined` to Stripe by passing
     * a true flag with an absent reference. At HEAD the invariant was structural because one
     * expression computed both; keep it that way.
     */
    taxCalculationReference: string | undefined;
  }): Stripe.PaymentIntentCreateParams {
    const {
      cart,
      amountPlanned,
      stripeCustomerId,
      setupFutureUsage,
      captureMethod,
      paymentMethodOptions,
      taxCalculationReference,
    } = params;

    return {
      // `setup_future_usage` is intentionally NOT guarded on its own: it stays present with an
      // undefined value whenever a Stripe customer exists. ct-connect-stripe-checkout guards it
      // (`...(setupFutureUsage && { setup_future_usage })`). Aligning the two is a separate
      // decision — changing the shape here would alter the params for every existing payment
      // method, which is exactly what the release-gate tests in
      // test/services/stripe-payment.service.spec.ts exist to prevent.
      ...(stripeCustomerId && {
        customer: stripeCustomerId,
        setup_future_usage: setupFutureUsage,
      }),
      amount: amountPlanned.centAmount,
      currency: amountPlanned.currencyCode,
      automatic_payment_methods: {
        enabled: true,
      },
      capture_method: captureMethod,
      metadata: this.paymentCreationService.getPaymentMetadata(cart),
      payment_method_options: paymentMethodOptions,
      // Tax calculation integration
      ...(taxCalculationReference !== undefined && {
        hooks: {
          inputs: {
            tax: {
              calculation: taxCalculationReference,
            },
          },
        },
      }),
      /*...(config.stripeCollectBillingAddress === 'auto' && {
        shipping: shippingAddress,
      }),*/
    };
  }

  /**
   * Merges backend default payment method options with frontend provided options.
   * Frontend options take priority over backend defaults for the same payment method.
   *
   * @param frontendOptions - Payment method options provided from the frontend
   * @returns Merged payment method options
   */
  private mergePaymentMethodOptions(
    frontendOptions?: Record<string, Record<string, unknown>>,
  ): Stripe.PaymentIntentCreateParams.PaymentMethodOptions {
    const config = getConfig();

    const backendDefaults: Record<string, Record<string, unknown>> = {
      card: {
        ...(config.stripeEnableMultiOperations && { request_multicapture: 'if_available' }),
      },
    };

    if (!frontendOptions) {
      return backendDefaults as Stripe.PaymentIntentCreateParams.PaymentMethodOptions;
    }

    // Merge: backend defaults + frontend options (frontend takes priority)
    return Object.entries(frontendOptions).reduce(
      (merged, [method, options]) => ({
        ...merged,
        [method]: { ...merged[method], ...options },
      }),
      backendDefaults,
    ) as Stripe.PaymentIntentCreateParams.PaymentMethodOptions;
  }

  /**
   * Takes the `customer_balance` key back from the client and sets it from merchant config, or removes
   * it entirely when this market has no configured IBAN country.
   *
   * Runs AFTER mergePaymentMethodOptions — see the comment at the call site for why that order is the
   * point of this method rather than an implementation detail.
   *
   * WHAT THIS IS NOT, since a previous version was exactly that: this is no longer an eligibility gate.
   * It used to refuse the whole request when a cart without a `bankTransfer: true` rule carried any
   * customer_balance option, on the belief that the connector decided which carts could use the rail.
   * It does not — Stripe does, through the Dashboard toggle and automatic_payment_methods — so there is
   * no "ineligible cart" to protect, and refusing was rejecting checkouts over a distinction that had
   * no meaning at Stripe's end.
   *
   * WHAT SURVIVES is the part that was always the real point: a browser holding a valid session must
   * not choose which of the merchant's bank accounts a shopper wires money to. So a client-supplied
   * customer_balance is DISCARDED rather than honoured, always, and replaced by whatever the merchant's
   * rule says — including by nothing at all, which lets Stripe apply its currency-derived default.
   *
   * Discarding rather than rejecting is safe here precisely because dropping the key changes no
   * outcome the shopper can see: the tab still renders, the confirm still produces funding
   * instructions, and only the IBAN country reverts to Stripe's default. There is no silent
   * substitution of payment rail to guard against, which was the argument for the old rejection.
   *
   * @param paymentMethodOptions - The merged options, with the client's values already applied.
   * @param context - The cart currency, the merchant-configured EUR country, and the cart id.
   * @returns The options to send to Stripe, with customer_balance under merchant control.
   */
  private applyBankTransferOverride(
    paymentMethodOptions: Stripe.PaymentIntentCreateParams.PaymentMethodOptions,
    context: {
      currencyCode: string;
      euBankTransferCountry?: EuBankTransferCountry;
      cartId: string;
    },
  ): Stripe.PaymentIntentCreateParams.PaymentMethodOptions {
    const { currencyCode, euBankTransferCountry, cartId } = context;
    const merchantOptions = getBankTransferOptions({ currencyCode, euBankTransferCountry });

    if (paymentMethodOptions.customer_balance !== undefined) {
      // Never log the options themselves: they are caller-supplied and this is a payment path.
      log.warn('Discarded a client-supplied customer_balance payment method option.', { cartId });
    }

    // REPLACE or REMOVE the whole customer_balance object, never a deep merge into it. A deep merge
    // would let a client-supplied requested_address_types survive and — the one that actually matters —
    // a nested eu_bank_transfer.country underneath our own bank_transfer.type, which is the
    // destination-of-funds choice this override exists to take away from the browser. Other methods'
    // keys (card, and anything a merchant legitimately configures for boleto, pix and so on) are
    // preserved untouched: this narrows exactly one key and leaves the rest of the merge intact.
    const rest = { ...paymentMethodOptions };
    delete rest.customer_balance;
    return merchantOptions ? { ...rest, customer_balance: merchantOptions } : rest;
  }

  /**
   * Update the PaymentIntent in Stripe to mark the Authorization in commercetools as successful.
   *
   * @param {string} paymentIntentId - The Intent id created in Stripe.
   * @param {string} paymentReference - The identifier of the payment associated with the PaymentIntent in Stripe.
   * @return {Promise<void>} - A Promise that resolves when the PaymentIntent is successfully updated.
   */
  public async updatePaymentIntentStripeSuccessful(
    paymentIntentId: string,
    paymentReference: string,
  ): Promise<PaymentModificationStatus> {
    const ctCart = await this.ctCartService.getCart({ id: getCartIdFromContext() });
    const ctPayment = await this.ctPaymentService.getPayment({ id: paymentReference });

    // (1) Identity binding — keep composable's existing gate: the CT payment's interfaceId must
    // match the PaymentIntent id, so we never bind a PI to the wrong CT payment.
    if (ctPayment.interfaceId !== paymentIntentId) {
      log.error(
        'PaymentIntent ID does not match CT Payment interfaceId — rejecting update to avoid wrong PI to wrong CT payment.',
        {
          paymentReference,
          requestPaymentIntentId: paymentIntentId,
          ctPaymentInterfaceId: ctPayment.interfaceId,
          ctCartId: ctCart.id,
        },
      );
      throw new Error(
        `PaymentIntent mismatch: request paymentIntentId (${paymentIntentId}) does not match CT payment interfaceId (${ctPayment.interfaceId})`,
      );
    }

    const amountPlanned = ctPayment.amountPlanned;

    // (2) Retrieve the PaymentIntent from Stripe (source of truth). Fail-closed: any retrieve
    // failure rejects the confirmation rather than trusting the client-supplied state.
    let stripePaymentIntent: Stripe.PaymentIntent;
    try {
      stripePaymentIntent = await stripeApi().paymentIntents.retrieve(paymentIntentId);
    } catch (error) {
      log.warn('updatePaymentIntentStripeSuccessful: failed to retrieve PaymentIntent from Stripe', {
        paymentIntentId,
        paymentReference,
      });
      throw new Error('Invalid PaymentIntent: could not retrieve from Stripe');
    }

    // (3) Status allowlist — synchronous success/capture, or async settlement (processing).
    const allowedStatuses = ['succeeded', 'requires_capture', 'processing'];
    if (!allowedStatuses.includes(stripePaymentIntent.status)) {
      log.warn('updatePaymentIntentStripeSuccessful: PaymentIntent status not allowed', {
        paymentIntentId,
        paymentReference,
        status: stripePaymentIntent.status,
        allowedStatuses,
      });
      throw new Error(`Invalid PaymentIntent: status "${stripePaymentIntent.status}" is not allowed`);
    }

    // (4) Validate amount/currency against the CART'S CURRENT TOTAL — not against
    // ctPayment.amountPlanned, which is a snapshot taken when the PaymentIntent was created.
    //
    // WHY THIS CHANGED. Under the deferred flow the two were the same thing: the PaymentIntent was
    // created at submit, so the snapshot was seconds old. Under pi_first it is created when the page
    // mounts, and the gap is the whole page lifetime — during which the shipping-method endpoints can
    // change the total. Comparing Stripe's amount against the snapshot then compares two copies of the
    // same stale number and agrees, so a cart worth more than the PaymentIntent passes and is paid
    // short. See KI-047.
    //
    // This is also what makes removing the mount-time cart freeze safe. The freeze used to prevent the
    // divergence by making the cart immutable from the moment the page opened; now the cart stays
    // editable until the shopper commits, and a divergence is caught HERE and rejected. Failing the
    // payment is the correct outcome — the alternative is collecting less than the order is worth.
    //
    // Stripe remains the source of truth for the amount itself; we never recompute it, only compare.
    const stripeAmount = stripePaymentIntent.amount;
    const stripeCurrency = (stripePaymentIntent.currency ?? '').toLowerCase();
    // Read the cart's own total, NOT ctCartService.getPaymentAmount.
    //
    // getPaymentAmount looks like "what does this cart cost" and is not: it also validates that the
    // cart is still payable and throws InvalidOperation once it is fully paid. That makes it wrong
    // here by construction, because this endpoint races the payment_intent.succeeded webhook — and
    // when the webhook wins, the cart IS already paid. Observed 2026-08-06: cartAmount 12300 and
    // paidAmount 12300, identical, rejected anyway, and the browser showed a stuck spinner.
    //
    // taxedPrice.totalGross when tax has been calculated, totalPrice otherwise — the commercetools
    // convention for the amount actually charged, and the same figure createPaymentIntent used.
    const currentCartTotal = ctCart.taxedPrice?.totalGross ?? ctCart.totalPrice;
    const expectedCentAmount = currentCartTotal.centAmount;
    const expectedCurrency = (currentCartTotal.currencyCode ?? '').toLowerCase();
    if (stripeAmount !== expectedCentAmount || stripeCurrency !== expectedCurrency) {
      log.warn('updatePaymentIntentStripeSuccessful: amount or currency mismatch', {
        paymentIntentId,
        paymentReference,
        stripeAmount,
        stripeCurrency,
        expectedCentAmount,
        expectedCurrency,
      });
      throw new Error('Invalid PaymentIntent: amount/currency mismatch');
    }

    // Commitment point for the instant rails. The shopper has confirmed and the amount has just been
    // checked against the live cart, so from here the cart must not move — an edit after this would
    // desynchronise the order from what was actually paid.
    //
    // Bank transfer does NOT pass through here: its confirm returns requires_action, which is not in
    // the status allowlist above, and the enabler does not call this endpoint on that path. It freezes
    // in the payment_intent.requires_action handler instead.
    //
    // A freeze failure is logged and swallowed on purpose, matching the previous behaviour at
    // creation: refusing a payment the shopper already authorised, over a cart-state write, would be
    // the worse outcome. The amount was validated a few lines above, so the window this leaves open is
    // narrow and does not affect what was charged.
    try {
      await freezeCart(await this.ctCartService.getCart({ id: ctCart.id }));
      log.info('Cart frozen at payment confirmation.', {
        ctCartId: ctCart.id,
        stripePaymentIntentId: paymentIntentId,
      });
    } catch (error) {
      log.error('Error freezing cart at payment confirmation.', {
        error,
        ctCartId: ctCart.id,
        stripePaymentIntentId: paymentIntentId,
      });
    }

    log.info(`PaymentIntent confirmed.`, {
      ctCartId: ctCart.id,
      stripePaymentIntentId: ctPayment.interfaceId,
      amountPlanned: JSON.stringify(amountPlanned),
    });

    // (5) Async settlement (e.g. crypto/stablecoin, deferred bank debits): the PaymentIntent is
    // still `processing`. Write a Pending authorization ONLY — never Success — guarded against a
    // Pending/Charge-Success that the payment_intent.processing webhook may already have written.
    // The order is created later by the payment_intent.succeeded webhook. Return PENDING so the
    // route responds 202 and the buyer is not shown a confirmed order.
    if (stripePaymentIntent.status === 'processing') {
      const hasAuthPending = this.ctPaymentService.hasTransactionInState({
        payment: ctPayment,
        transactionType: PaymentTransactions.AUTHORIZATION,
        states: [PaymentStatus.PENDING],
      });
      const hasChargeSuccess = this.ctPaymentService.hasTransactionInState({
        payment: ctPayment,
        transactionType: PaymentTransactions.CHARGE,
        states: [PaymentStatus.SUCCESS],
      });
      if (!hasAuthPending && !hasChargeSuccess) {
        await this.ctPaymentService.updatePayment({
          id: ctPayment.id,
          pspReference: paymentIntentId,
          transaction: {
            interactionId: paymentIntentId,
            type: PaymentTransactions.AUTHORIZATION,
            amount: amountPlanned,
            state: PaymentStatus.PENDING,
          },
        });
      }
      return PaymentModificationStatus.PENDING;
    }

    // (6) Synchronous success (succeeded / requires_capture): write Authorization/Success as before.
    await this.ctPaymentService.updatePayment({
      id: ctPayment.id,
      pspReference: paymentIntentId,
      transaction: {
        interactionId: paymentIntentId,
        type: PaymentTransactions.AUTHORIZATION,
        amount: amountPlanned,
        state: convertPaymentResultCode(PaymentOutcome.AUTHORIZED as PaymentOutcome),
      },
    });

    return PaymentModificationStatus.APPROVED;
  }

  /**
   * Return the Stripe payment configuration and the cart amount planed information.
   *
   * @return {Promise<ConfigElementResponseSchemaDTO>} Returns a promise that resolves with the cart information, appearance, and capture method.
   */
  public async initializeCartPayment(paymentType: string): Promise<ConfigElementResponseSchemaDTO> {
    const {
      stripePaymentElementAppearance,
      stripeExpressCheckoutAppearance,
      stripeCaptureMethod,
      stripeSavedPaymentMethodConfig,
      stripeLayout,
      stripeCollectBillingAddress,
      stripePaymentFlow,
      stripePaymentBehaviorRules,
    } = getConfig();
    const webElement = paymentType;
    const cart = await getCartExpanded();
    // flowType ONLY — deliberately narrower than ct-connect-stripe-checkout, which also resolves
    // captureMethod and collectBillingAddress from the rule here (stripe-payment.service.ts:982-983).
    // Widening this would change behavior for any cart that already matches a rule: such a cart today
    // receives the flat env var in THIS response while receiving the rule value on the PaymentIntent.
    // That inconsistency is known and left for a separate change, because closing it here would break
    // the property that this port ships with zero runtime change. To close it later: resolve an
    // effectiveCaptureMethod here and use it in BOTH places that read stripeCaptureMethod below — the
    // log and the returned response. Changing only the response would leave the log reporting the
    // flat env var while the shopper gets the rule value, which is the worse of the two states.
    // Then extend the initializeCartPayment tests, including the one that currently pins this gap.
    //
    // resolveTrustedPaymentBehavior and not resolvePaymentBehavior, for the same reason as in
    // createPaymentIntent: flowType changes PaymentIntent parameters, so a shopper-typed billing
    // country must not select it (KI-046). Kept identical to that call site so the response and the
    // PaymentIntent can never disagree about which flow the cart is on — if they diverged, the widget
    // would mount for one strategy while the PaymentIntent was built for the other.
    const behaviorRule = resolveTrustedPaymentBehavior(stripePaymentBehaviorRules, cart);
    const flowType = behaviorRule?.flowType ?? stripePaymentFlow;
    const amountPlanned = await this.ctCartService.getPaymentAmount({ cart });
    const appearance =
      webElement === 'paymentElement' ? stripePaymentElementAppearance : stripeExpressCheckoutAppearance;
    // pi_first suppresses setup_future_usage HERE TOO, not just on the PaymentIntent. Same RULE as
    // applyPiFirstOverride above — one decision expressed twice, not two independent ones — but read
    // config.stripePaymentFlow's docblock with one difference in mind: its LIVE-vs-MOOT breakdown of
    // the cost covers both a global and a rule-supplied value, because the helper can receive either.
    // This path can only ever receive the global one, for the reason given four lines down. Kept as an
    // inline ternary rather than a call to that helper to stay faithful to ct-connect-stripe-checkout,
    // whose two paths are likewise separate; the types differ too, since this value flows to a DTO
    // string rather than to a Stripe param.
    //
    // Under pi_first the value reaches NEITHER Stripe nor elements(), and since the enabler port both
    // reasons are now verifiable rather than asserted: Stripe's StripeElementsOptionsClientSecret does
    // not declare setupFutureUsage, so the enabler's clientSecret branch could not forward it even if
    // this returned one — and that branch does not read it in any case. Suppressing it here is
    // therefore redundant for the widget rather than load-bearing on it; it is kept so the response
    // never advertises a save mandate the shopper will not get. Independently, the payment methods
    // pi_first exists for are excluded outright by a setup_future_usage.
    // No dedicated log here, unlike the helper, and for a stronger reason than the log below already
    // reporting both fields: this path can only ever suppress the GLOBAL value. A rule's own
    // setupFutureUsage never reaches it — initializeCartPayment resolves the rule for flowType only
    // (see the note above) — so no merchant-configured per-cart mandate can be lost invisibly here.
    // That is exactly the loss the helper's log exists to make traceable.
    const setupFutureUsage =
      flowType === 'pi_first' ? undefined : stripeSavedPaymentMethodConfig.payment_method_save_usage;
    const subscriptionService = new StripeSubscriptionService({
      ctCartService: this.ctCartService,
      ctPaymentService: this.ctPaymentService,
      ctOrderService: this.ctOrderService,
    });
    const paymentMode = await subscriptionService.getPaymentMode(cart);

    log.info(`Cart and ${webElement} config retrieved.`, {
      cartId: cart.id,
      cartInfo: {
        amount: amountPlanned.centAmount,
        currency: amountPlanned.currencyCode,
      },
      stripeElementAppearance: appearance,
      stripeCaptureMethod: stripeCaptureMethod,
      webElements: webElement,
      stripeSetupFutureUsage: setupFutureUsage,
      layout: stripeLayout,
      collectBillingAddress: stripeCollectBillingAddress,
      paymentMode,
      stripePaymentFlow: flowType,
      ...(behaviorRule && { behaviorRuleApplied: true }),
    });

    return {
      cartInfo: {
        amount: amountPlanned.centAmount,
        currency: amountPlanned.currencyCode,
      },
      appearance,
      captureMethod: stripeCaptureMethod,
      webElements: webElement,
      setupFutureUsage,
      layout: stripeLayout,
      collectBillingAddress: stripeCollectBillingAddress as CollectBillingAddressOptions,
      paymentMode,
      flowType,
    };
  }

  /**
   * Return the Stripe payment configuration and the cart amount planed information.
   *
   * @return {Promise<ConfigElementResponseSchemaDTO>} Returns a promise that resolves with the cart information, appearance, and capture method.
   */
  public applePayConfig(): string {
    return getConfig().stripeApplePayWellKnown;
  }

  /**
   * Retrieves modified payment data based on the given Stripe event.
   *
   * @param {Stripe.Event} event - The Stripe event object to extract data from.
   * @return {ModifyPayment} - An object containing modified payment data.
   */
  public async processStripeEvent(event: Stripe.Event): Promise<void> {
    log.info('Processing notification', { event: JSON.stringify(event.id) });
    try {
      const updateData = this.stripeEventConverter.convert(event);

      // Fail fast when the PaymentIntent carries no ct_payment_id: it was not created by this
      // connector (a Dashboard-created intent, or another integration on the same Stripe
      // account), so there is nothing here to update. Without this, every downstream call
      // receives an undefined id and throws — and for the events in ASYNC_PENDING_EVENTS that
      // throw is re-thrown below, producing a 500 that Stripe retries for three days and can
      // end in the whole webhook endpoint being disabled. Retrying cannot help: the metadata
      // will never appear.
      if (!updateData.id) {
        log.warn('Skipping event: the PaymentIntent carries no commercetools payment id in its metadata', {
          eventType: event.type,
          pspReference: updateData.pspReference,
        });
        return;
      }

      // Ordering + dedup guard for async settlement (crypto: payment_intent.processing;
      // bank transfer: payment_intent.requires_action). Stripe does not guarantee event order
      // and may redeliver: skip writing the Pending authorization if the payment is already
      // resolved (Charge/Success) or a Pending authorization already exists. Scoped to the
      // async pending events — every other event type is unaffected.
      // See isRedundantAsyncPendingEvent below.
      if (
        (ASYNC_PENDING_EVENTS as readonly string[]).includes(event.type) &&
        (await this.isRedundantAsyncPendingEvent(event.type, updateData))
      ) {
        return;
      }

      if (
        updateData.transactions.length === 0 &&
        (ZERO_TRANSACTION_PERSIST_EVENTS as readonly string[]).includes(event.type)
      ) {
        await this.persistZeroTransactionUpdate(event, updateData);
      } else {
        await this.persistTransactionUpdates(event, updateData);
      }

      await this.unfreezeCartOnPaymentCancelOrFailed(event, updateData);

      if (event.type === StripeEvent.PAYMENT_INTENT__SUCCEEDED) {
        await this.transitionPendingAuthorizationToSuccess(updateData);
        await this.handlePaymentIntentSucceededFlow(event, updateData);
      }
    } catch (e) {
      log.error('Error processing notification', { error: e });
      // For async settlement events that write a Pending authorization, do NOT swallow write
      // failures: re-throw so the webhook responds non-2xx and Stripe retries (avoids silent
      // CT divergence / KI-001/002). payment_intent.partially_funded is deliberately excluded:
      // it writes no transaction, so losing it costs an audit line rather than correctness,
      // and re-throwing would cause a retry storm on a frequent event. Other event types keep
      // the existing behavior (log and return).
      if ((ASYNC_PENDING_EVENTS as readonly string[]).includes(event.type)) {
        throw e;
      }
      return;
    }
  }

  /**
   * Persists an update that carries no transactions — the ZERO_TRANSACTION_PERSIST_EVENTS, where the
   * payment's own fields change but no money movement is recorded.
   *
   * Extracted from processStripeEvent so the charge.succeeded fixup below is not nested three levels
   * deep inside it. Behaviour is unchanged.
   *
   * @param {Stripe.Event} event - The Stripe event being processed.
   * @param {StripeEventUpdatePayment} updateData - Converted event payload for the payment.
   */
  private async persistZeroTransactionUpdate(event: Stripe.Event, updateData: StripeEventUpdatePayment): Promise<void> {
    const updatedPayment = await this.ctPaymentService.updatePayment({
      ...updateData,
    });

    // Deliberately scoped to charge.succeeded, NOT to every zero-transaction event.
    // This fixup promotes an Initial authorization to Success for the full amountPlanned,
    // which is right when the charge succeeded and wrong for payment_intent.partially_funded:
    // there the funds sit in the customer's cash balance, not on the platform balance, so
    // promoting the authorization would book revenue that does not exist. Do not widen this
    // condition to every event reaching this method — a release-gate test covers it.
    if (event.type === StripeEvent.CHARGE__SUCCEEDED) {
      const hasAuthInitial = this.ctPaymentService.hasTransactionInState({
        payment: updatedPayment,
        transactionType: PaymentTransactions.AUTHORIZATION,
        states: [PaymentStatus.INITIAL],
      });
      if (hasAuthInitial) {
        await this.ctPaymentService.updatePayment({
          id: updatedPayment.id,
          pspReference: updateData.pspReference,
          transaction: {
            type: PaymentTransactions.AUTHORIZATION,
            state: convertPaymentResultCode(PaymentOutcome.AUTHORIZED as PaymentOutcome),
            amount: updatedPayment.amountPlanned,
            interactionId: updateData.pspReference,
          },
        });
      }
    }

    log.info('Payment information updated', {
      paymentId: updatedPayment.id,
      version: updatedPayment.version,
      pspReference: updateData.pspReference,
      paymentMethod: updateData.paymentMethod,
    });
  }

  /**
   * Persists one commercetools transaction per transaction the converter produced — the normal path,
   * where the event does record money movement.
   *
   * @param {Stripe.Event} event - The Stripe event being processed.
   * @param {StripeEventUpdatePayment} updateData - Converted event payload for the payment.
   */
  private async persistTransactionUpdates(event: Stripe.Event, updateData: StripeEventUpdatePayment): Promise<void> {
    await this.handleMulticaptureIfNeeded(event, updateData);

    for (const tx of updateData.transactions) {
      const updatedPayment = await this.ctPaymentService.updatePayment({
        ...updateData,
        transaction: tx,
      });

      log.info('Payment transaction updated after processing the notification', {
        paymentId: updatedPayment.id,
        version: updatedPayment.version,
        pspReference: updateData.pspReference,
        paymentMethod: updateData.paymentMethod,
        transaction: JSON.stringify(tx),
      });
    }
  }

  /**
   * Ordering + dedup guard for async settlement: crypto via `payment_intent.processing`,
   * bank transfer via `payment_intent.requires_action` — the members of ASYNC_PENDING_EVENTS.
   * Stripe does not guarantee event order and may redeliver: returns true when the Pending
   * authorization should be skipped because the payment is already resolved (Charge/Success)
   * or a Pending authorization already exists.
   *
   * Extracted from the inline guard by 137b8f2 as `isRedundantProcessingEvent`; renamed when
   * bank transfer routing widened it beyond `processing` (SB3-207). The caller still decides
   * *which* events reach here — this method does not check the event type itself.
   *
   * @param {string} eventType - Stripe event type, used only for the log line.
   * @param {StripeEventUpdatePayment} updateData - Converted event payload for the payment.
   * @return {Promise<boolean>} True when the event is redundant and must be skipped.
   */
  private async isRedundantAsyncPendingEvent(
    eventType: string,
    updateData: StripeEventUpdatePayment,
  ): Promise<boolean> {
    const payment = await this.ctPaymentService.getPayment({ id: updateData.id });
    const hasChargeSuccess = this.ctPaymentService.hasTransactionInState({
      payment,
      transactionType: PaymentTransactions.CHARGE,
      states: [PaymentStatus.SUCCESS],
    });
    const hasAuthPending = this.ctPaymentService.hasTransactionInState({
      payment,
      transactionType: PaymentTransactions.AUTHORIZATION,
      states: [PaymentStatus.PENDING],
    });
    if (hasChargeSuccess || hasAuthPending) {
      log.info(`Skipping ${eventType} — payment already resolved or pending transaction exists`, {
        paymentId: updateData.id,
        pspReference: updateData.pspReference,
        hasChargeSuccess,
        hasAuthPending,
      });
      return true;
    }
    return false;
  }

  /**
   * Best-effort transition of a lingering Pending authorization (written during
   * payment_intent.processing for async crypto settlement) to Success, so it does not stay
   * stuck in Pending after the payment completes. No-op for card payments that never went
   * through processing. Own try/catch so a failure here never blocks order creation.
   *
   * @param {StripeEventUpdatePayment} updateData - Converted event payload for the payment.
   * @return {Promise<void>}
   */
  private async transitionPendingAuthorizationToSuccess(updateData: StripeEventUpdatePayment): Promise<void> {
    try {
      const payment = await this.ctPaymentService.getPayment({ id: updateData.id });
      const hasAuthPending = this.ctPaymentService.hasTransactionInState({
        payment,
        transactionType: PaymentTransactions.AUTHORIZATION,
        states: [PaymentStatus.PENDING],
      });
      if (hasAuthPending) {
        await this.ctPaymentService.updatePayment({
          id: payment.id,
          pspReference: updateData.pspReference,
          transaction: {
            type: PaymentTransactions.AUTHORIZATION,
            state: PaymentStatus.SUCCESS,
            amount: updateData.transactions[0]?.amount ?? payment.amountPlanned,
            interactionId: updateData.pspReference,
          },
        });
        log.info('Transitioned pending authorization to Success after payment_intent.succeeded', {
          paymentId: payment.id,
          pspReference: updateData.pspReference,
        });
      }
    } catch (authTransitionError) {
      log.warn('Could not transition pending authorization to Success (non-blocking)', {
        error: authTransitionError,
        paymentId: updateData.id,
      });
    }
  }

  /**
   * Unfreezes the cart when the payment is canceled or failed.
   */
  private async unfreezeCartOnPaymentCancelOrFailed(
    event: Stripe.Event,
    updateData: StripeEventUpdatePayment,
  ): Promise<void> {
    if (
      event.type !== StripeEvent.PAYMENT_INTENT__CANCELED &&
      event.type !== StripeEvent.PAYMENT_INTENT__PAYMENT_FAILED
    ) {
      return;
    }
    try {
      const ctCart = await this.ctCartService.getCartByPaymentId({ paymentId: updateData.id });
      if (isCartFrozen(ctCart)) {
        await unfreezeCart(ctCart);
        log.info(`Cart unfrozen after payment ${event.type}.`, {
          ctCartId: ctCart.id,
          paymentId: updateData.id,
          eventType: event.type,
        });
      }
    } catch (error) {
      log.error(`Error unfreezing cart after payment ${event.type}.`, {
        error,
        paymentId: updateData.id,
        eventType: event.type,
      });
    }
  }

  /**
   * Handles the payment_intent.succeeded flow: optional warn for unfrozen cart, update cart address, create order.
   */
  private async handlePaymentIntentSucceededFlow(
    event: Stripe.Event,
    updateData: StripeEventUpdatePayment,
  ): Promise<void> {
    const ctCart = await this.ctCartService.getCartByPaymentId({ paymentId: updateData.id });
    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    // Idempotency: payment_intent.succeeded can be redelivered. Once the order exists the cart is
    // Ordered, and a second createOrderFromCart would have commercetools reject it — an error the
    // outer catch in processStripeEvent swallows as noise. Skip cleanly instead. Mirrors the
    // subscription path's cartState === 'Ordered' guard (stripe-subscription.service.ts).
    if (ctCart.cartState === 'Ordered') {
      log.info('payment_intent.succeeded for an already-ordered cart — skipping duplicate order creation.', {
        ctCartId: ctCart.id,
        paymentId: updateData.id,
      });
      return;
    }

    // Underpayment guard (backstop). The confirm gate validates the amount against the CURRENT cart
    // total for the instant rails, but async rails (ACH micro-deposits, boleto, ...) confirm to
    // requires_action and never reach it — their PaymentIntent is created at one amount and settles
    // days later, during which the cart can still be edited. Without this guard an order would be
    // created for the current (larger) cart total while only the original amount was actually paid.
    // See KI-044 / KI-047 and business-rules/payment-confirmation.md Rule 2.
    //
    // Integer comparison in the currency's minor unit, NOT divided by 100: commercetools `centAmount`
    // already respects the currency's fractionDigits and so does Stripe's `amount`, so this is correct
    // for USD and for zero-decimal currencies (JPY). `amount_received === amount` additionally rejects
    // incomplete settlement (robust against manual/partial capture on other rails); on ACH it always
    // holds at succeeded. A mismatch never creates the order: the Charge/Success transaction was
    // already persisted upstream, so the outcome is a paid-without-order state surfaced for manual
    // reconciliation — the hub rule forbids auto-correction, so there is no auto-refund here.
    const currentCartTotal = ctCart.taxedPrice?.totalGross ?? ctCart.totalPrice;
    const amountMatches =
      paymentIntent.amount === currentCartTotal.centAmount && paymentIntent.amount_received === paymentIntent.amount;
    const currencyMatches = paymentIntent.currency.toLowerCase() === currentCartTotal.currencyCode.toLowerCase();
    if (!amountMatches || !currencyMatches) {
      log.error(
        'payment_intent.succeeded: paid amount/currency does not match the current cart total — order NOT created (underpayment guard).',
        {
          ctCartId: ctCart.id,
          paymentId: updateData.id,
          pspReference: updateData.pspReference,
          stripeAmount: paymentIntent.amount,
          stripeAmountReceived: paymentIntent.amount_received,
          stripeCurrency: paymentIntent.currency,
          cartTotalCentAmount: currentCartTotal.centAmount,
          cartCurrency: currentCartTotal.currencyCode,
        },
      );
      return;
    }

    const { latest_charge } = paymentIntent;
    const charge = await stripeApi().charges.retrieve(latest_charge as string);
    const updatedCart = await this.updateCartAddress(charge, ctCart);
    await this.createOrder({ cart: updatedCart, paymentIntentId: updateData.pspReference });
  }

  /**
   * Handles multicapture scenarios for payment intent events.
   * Checks if the event is a payment intent with manual capture and multicapture enabled,
   * then updates the transaction data with balance transaction information if multiple captures exist.
   *
   * @param {Stripe.Event} event - The Stripe event object to process.
   * @param {StripeEventUpdatePayment} updateData - The payment update data to modify with multicapture information.
   * @returns {Promise<void>}
   */
  private async handleMulticaptureIfNeeded(event: Stripe.Event, updateData: StripeEventUpdatePayment): Promise<void> {
    if (!event.type.startsWith('payment')) {
      return;
    }

    const pi = event.data.object as Stripe.PaymentIntent;
    if (
      pi.capture_method !== 'manual' ||
      pi.payment_method_options?.card?.request_multicapture !== 'if_available' ||
      typeof pi.latest_charge !== 'string'
    ) {
      return;
    }

    const balanceTransactions = await stripeApi().balanceTransactions.list({
      source: pi.latest_charge,
      limit: 10,
    });

    if (balanceTransactions.data.length > 1) {
      //it is multicapture, so we need to update the transactions
      updateData.transactions.forEach((tx: TransactionData) => {
        tx.interactionId = balanceTransactions.data[0].id;
        tx.amount = {
          centAmount: balanceTransactions.data[0].amount,
          currencyCode: balanceTransactions.data[0].currency.toUpperCase(),
        };
      });
    }
  }

  /**
   * Process Stripe refund events with support for multiple refunds.
   * Fetches refund details from Stripe API to get accurate refund amounts and IDs.
   *
   * @param {Stripe.Event} event - The Stripe charge.refunded event object.
   * @return {Promise<void>}
   */
  /**
   * Records a refund that Stripe ultimately rejected, correcting the optimistic Refund/Success that
   * charge.refunded already wrote.
   *
   * WHY THIS EXISTS. `charge.refunded` fires when the Refund object is CREATED. On an instant rail
   * that is also when it succeeds, so treating creation as success was invisible for cards. On a
   * delayed rail it is not: measured 2026-08-05, refunding a bank-transfer PaymentIntent returns
   * `status: 'pending'` and settles later. Until now nothing ever revisited that decision, so a refund
   * that failed stayed recorded as successful — the merchant sees money returned that never left, and
   * reconciliation against Stripe silently disagrees.
   *
   * Writes Refund/Failure rather than removing the earlier transaction: commercetools transactions are
   * append-only, and the pair (Success then Failure, same interactionId) is the honest record of what
   * happened. Consumers summing refunds MUST account for this — a Failure cancels the Success above it.
   *
   * ROUTING. The Refund object does not inherit the PaymentIntent's metadata (measured: `metadata: {}`
   * on a real refund.updated), so refundPayment now stamps the commercetools payment id onto the refund
   * at creation. A refund issued from the Stripe Dashboard carries no such stamp and cannot be routed;
   * it is logged and skipped rather than guessed at.
   */
  /**
   * Freezes the cart when an async-settlement PaymentIntent goes pending — bank transfer (funding
   * instructions issued) or ACH micro-deposits (debit in flight). Method name kept for a minimal diff;
   * it now serves both rails, routed here by the two predicates in the webhook handler.
   *
   * This is the commitment point for those rails, and it exists because the instant-rail one cannot
   * serve them: confirming returns `requires_action`, which is not in
   * updatePaymentIntentStripeSuccessful's status allowlist, and the enabler does not call that
   * endpoint on this path at all. Verified on 2026-08-06 — the two /confirmPayments calls in that run
   * belonged to instant checkouts; the async payment never reached the gate.
   *
   * The freeze matters more here than anywhere else. Funds take hours to days to arrive, and the order
   * is created only when they do. A cart edited during that window would produce an order that does
   * not match the money already in flight, and unlike an instant payment there is no confirmation step
   * left to catch it.
   *
   * Resolved from the PaymentIntent's cart_id metadata, which this connector writes at creation. A
   * missing id is logged rather than guessed at. A freeze failure is logged and swallowed: the shopper
   * already has wire instructions in hand, and throwing would only make Stripe redeliver an event
   * whose payment work has already been done.
   */
  public async freezeCartForBankTransfer(event: Stripe.Event): Promise<void> {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const cartId = paymentIntent.metadata?.[METADATA_CART_ID_FIELD];

    if (!cartId) {
      log.warn('Async payment pending but the PaymentIntent carries no cart id — cart not frozen.', {
        stripePaymentIntentId: paymentIntent.id,
      });
      return;
    }

    try {
      const cart = await this.ctCartService.getCart({ id: cartId });
      if (isCartFrozen(cart)) {
        log.info('Cart already frozen for this async payment — nothing to do.', { ctCartId: cartId });
        return;
      }
      await freezeCart(cart);
      log.info('Cart frozen while awaiting async payment settlement.', {
        ctCartId: cartId,
        stripePaymentIntentId: paymentIntent.id,
      });
    } catch (error) {
      log.error('Error freezing cart while awaiting async payment settlement.', {
        error,
        ctCartId: cartId,
        stripePaymentIntentId: paymentIntent.id,
      });
    }
  }

  public async processStripeEventRefundFailed(event: Stripe.Event): Promise<void> {
    const refund = event.data.object as Stripe.Refund;
    log.info('Processing failed refund notification', { event: JSON.stringify(event.id) });

    try {
      const ctPaymentId = refund.metadata?.[METADATA_PAYMENT_ID_FIELD];
      if (!ctPaymentId) {
        // Not an error: a Dashboard-issued refund legitimately has no stamp. Named explicitly so an
        // operator investigating a missing correction is not left guessing.
        log.warn('Skipping failed refund: it carries no commercetools payment id in its metadata.', {
          refundId: refund.id,
          status: refund.status,
        });
        return;
      }

      await this.ctPaymentService.updatePayment({
        id: ctPaymentId,
        transaction: {
          type: PaymentTransactions.REFUND,
          state: PaymentStatus.FAILURE,
          amount: {
            centAmount: refund.amount,
            currencyCode: refund.currency.toUpperCase(),
          },
          interactionId: refund.id,
        },
      });

      log.info('Refund marked as failed in commercetools.', {
        ctPaymentId,
        refundId: refund.id,
        status: refund.status,
        failureReason: refund.failure_reason,
      });
    } catch (error) {
      // Deliberately rethrown, unlike processStripeEventRefunded's swallow (KI-031/KI-002). Returning
      // 200 after failing to write this correction would stop Stripe redelivering it, and the payment
      // would keep claiming a refund that never happened.
      log.error('Failed to record a failed refund in commercetools.', { refundId: refund.id, error });
      throw error;
    }
  }

  public async processStripeEventRefunded(event: Stripe.Event): Promise<void> {
    log.info('Processing refund notification', { event: JSON.stringify(event.id) });
    try {
      const updateData = this.stripeEventConverter.convert(event);
      const charge = event.data.object as Stripe.Charge;

      // Fetch refunds for this charge
      const refunds = await stripeApi().refunds.list({
        charge: charge.id,
        created: {
          gte: charge.created,
        },
        limit: 2,
      });

      const refund = refunds.data[0];
      if (!refund) {
        log.warn('No refund found for charge', { chargeId: charge.id });
        return;
      }

      // Update the transaction data with refund details
      updateData.pspReference = refund.id;
      updateData.transactions.forEach((tx) => {
        tx.interactionId = refund.id;
        tx.amount = {
          centAmount: refund.amount,
          currencyCode: refund.currency.toUpperCase(),
        };
      });

      // Process each transaction
      for (const tx of updateData.transactions) {
        const updatedPayment = await this.ctPaymentService.updatePayment({
          ...updateData,
          transaction: tx,
        });

        log.info('Payment updated after processing the refund notification', {
          paymentId: updatedPayment.id,
          version: updatedPayment.version,
          pspReference: updateData.pspReference,
          paymentMethod: updateData.paymentMethod,
          transaction: JSON.stringify(tx),
        });
      }
    } catch (e) {
      log.error('Error processing refund notification', { error: e });
      return;
    }
  }

  /**
   * Process Stripe charge.updated events for multicapture support.
   * Calculates the incremental captured amount by comparing with previous attributes.
   *
   * @param {Stripe.Event} event - The Stripe charge.updated event object.
   * @return {Promise<void>}
   */
  public async processStripeEventMultipleCaptured(event: Stripe.Event): Promise<void> {
    log.info('Processing multicapture notification', { event: JSON.stringify(event.id) });
    try {
      const updateData = this.stripeEventConverter.convert(event);
      const charge = event.data.object as Stripe.Charge;

      // Validate charge is captured
      if (charge.captured) {
        log.warn('Charge is already captured', { chargeId: charge.id });
        return;
      }

      // Get previous attributes to calculate incremental amount
      const previousAttributes = event.data.previous_attributes as Stripe.Charge;

      // Validate that amount_captured increased
      if (!previousAttributes || !(charge.amount_captured > (previousAttributes.amount_captured || 0))) {
        log.warn('Amount captured did not increase from previous charge', {
          chargeId: charge.id,
          currentAmount: charge.amount_captured,
          previousAmount: previousAttributes?.amount_captured || 0,
        });
        return;
      }

      // Calculate the INCREMENTAL captured amount (not total)
      const incrementalAmount = charge.amount_captured - (previousAttributes.amount_captured || 0);

      // Use balance transaction ID as PSP reference for better tracking
      updateData.pspReference = charge.balance_transaction as string;

      // Update transactions with incremental amount
      updateData.transactions.forEach((tx) => {
        tx.interactionId = charge.balance_transaction as string;
        tx.amount = {
          centAmount: incrementalAmount,
          currencyCode: charge.currency.toUpperCase(),
        };
      });

      // Process each transaction
      for (const tx of updateData.transactions) {
        const updatedPayment = await this.ctPaymentService.updatePayment({
          ...updateData,
          transaction: tx,
        });

        log.info('Payment updated after processing multicapture', {
          paymentId: updatedPayment.id,
          version: updatedPayment.version,
          pspReference: updateData.pspReference,
          capturedIncrement: incrementalAmount,
          totalCaptured: charge.amount_captured,
          transaction: JSON.stringify(tx),
        });
      }
    } catch (e) {
      log.error('Error processing multicapture notification', { error: e });
      return;
    }
  }

  public async createOrder({ cart, subscriptionId, paymentIntentId, paymentState }: CreateOrderProps) {
    const order = await createOrderFromCart(cart, paymentState);
    log.info('Order created successfully', {
      ctOrderId: order.id,
      ctCartId: cart.id,
      stripeSubscriptionId: subscriptionId,
    });
    /* If using Stripe Test Clock, wait for 9 seconds to allow clock advancement in test environments.
      This helps ensure Stripe's test clock events are processed before updating the subscription.
      Uncomment this line for testing purposes when using Stripe Test Clock.
      await new Promise((resolve) => setTimeout(resolve, 5000));
      */
    if (paymentIntentId && paymentIntentId.startsWith('pi_')) {
      await stripeApi().paymentIntents.update(
        paymentIntentId,
        { metadata: { [METADATA_ORDER_ID_FIELD]: order.id } },
        { idempotencyKey: crypto.randomUUID() },
      );
    }
    /* If using Stripe Test Clock, wait for 9 seconds to allow clock advancement in test environments.
      This helps ensure Stripe's test clock events are processed before updating the subscription.
      Uncomment this line for testing purposes when using Stripe Test Clock.
      await new Promise((resolve) => setTimeout(resolve, 000));
      */

    if (subscriptionId) {
      await stripeApi().subscriptions.update(
        subscriptionId,
        { metadata: { [METADATA_ORDER_ID_FIELD]: order.id } },
        { idempotencyKey: crypto.randomUUID() },
      );
    }
  }

  public async addPaymentToOrder(subscriptionPaymentId: string, paymentId: string) {
    try {
      const order = await this.ctOrderService.getOrderByPaymentId({ paymentId: subscriptionPaymentId });
      await addOrderPayment(order, paymentId);
    } catch (error) {
      log.error('Error adding payment to order', { error });
    }
  }

  public async updateCartAddress(charge: Stripe.Charge, ctCart: Cart): Promise<Cart> {
    if (!charge) {
      return ctCart;
    }

    const { billing_details, shipping } = charge;

    // Prioritize shipping over billing_details
    const addressSource = shipping || billing_details;
    const address = addressSource?.address;

    if (!this.hasCompleteAddress(address)) {
      return ctCart;
    }

    const cartToUpdate = await this.unfreezeCartIfNeeded(ctCart);
    const wasFrozen = isCartFrozen(ctCart);

    // Stripe has complete address → update the cart
    const actions: CartUpdateAction[] = [
      {
        action: 'setShippingAddress',
        address: {
          key: addressSource?.name ?? undefined,
          country: address!.country!,
          city: address!.city ?? undefined,
          postalCode: address!.postal_code ?? undefined,
          state: address!.state ?? undefined,
          streetName: address!.line1 ?? undefined,
          streetNumber: address!.line2 ?? undefined,
        },
      },
    ];

    const updatedCart = await updateCartById(cartToUpdate, actions);

    return wasFrozen ? this.refreezeCart(updatedCart) : updatedCart;
  }

  private hasCompleteAddress(
    address: Stripe.Address | Stripe.PaymentIntent.Shipping['address'] | null | undefined,
  ): boolean {
    return !!(address?.country && address?.state && address?.city && address?.postal_code && address?.line1);
  }

  private async unfreezeCartIfNeeded(cart: Cart): Promise<Cart> {
    if (!isCartFrozen(cart)) {
      return cart;
    }
    try {
      const unfrozenCart = await unfreezeCart(cart);
      log.info(`Cart temporarily unfrozen for address update from successful payment.`, {
        ctCartId: unfrozenCart.id,
      });
      return unfrozenCart;
    } catch (error) {
      log.error(`Error unfreezing cart for address update.`, { error, ctCartId: cart.id });
      return cart;
    }
  }

  private async refreezeCart(cart: Cart): Promise<Cart> {
    try {
      const reFrozenCart = await freezeCart(cart);
      log.info(`Cart re-frozen after address update from successful payment.`, {
        ctCartId: reFrozenCart.id,
      });
      return reFrozenCart;
    } catch (error) {
      log.error(`Error re-freezing cart after address update.`, { error, ctCartId: cart.id });
      return cart;
    }
  }
}
