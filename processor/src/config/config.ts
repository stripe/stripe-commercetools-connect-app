import Stripe from 'stripe';
import { parseJSON } from '../utils';
import type { PaymentBehaviorConfig, PaymentBehaviorRule } from '../services/payment-behavior-resolver';
import { EU_BANK_TRANSFER_COUNTRIES } from '../mappers/bank-transfer-mapper';

export type PaymentFeatures = Stripe.CustomerSessionCreateParams.Components.PaymentElement.Features;

export type SubscriptionPaymentHandling = 'createOrder' | 'addPaymentToOrder';

/** Accepted values for a rule's captureMethod, matching the CaptureMethod type exactly. */
const RULE_CAPTURE_METHODS: readonly string[] = ['automatic', 'automatic_async', 'manual'];

/**
 * Accepted values for a rule's setupFutureUsage, in canonical (trimmed, lowercased) form.
 * '', 'none', 'null' and 'undefined' all mean "do not send setup_future_usage".
 */
const RULE_SETUP_FUTURE_USAGE: readonly string[] = ['', 'none', 'null', 'undefined', 'off_session', 'on_session'];

/**
 * Accepted values for flowType, both as a rule field and as the flat STRIPE_PAYMENT_FLOW env var.
 *
 * One array for both on purpose. checkout declares a separate local `allowed` list inside its env
 * var parser (config.ts:136) alongside the rule field's own union; duplicating the list is how the
 * two drift apart.
 *
 * Case-sensitive: 'PI_FIRST' would fail the `=== 'pi_first'` comparison at the point of use and
 * silently mean 'deferred'. It is rejected loudly and reported at startup rather than accepted, but it
 * does NOT abort — the merchant gets 'deferred' plus a console error naming the typo.
 * ct-connect-stripe-checkout does not validate rule fields at all — it blind-casts the whole map —
 * so reporting here is a deliberate improvement on the reference, not an infidelity in the port.
 */
const RULE_FLOW_TYPES: readonly string[] = ['deferred', 'pi_first'];

/**
 * Fields checkout's rule schema has that this connector does not implement. Accepted so that one
 * rules map can serve both connectors, but ignored here — and reported at startup so a merchant
 * is never left believing a value took effect. Any OTHER unknown field is reported the same way and
 * ignored — nothing in this validator aborts a deployment; see validateBehaviorRule.
 *
 * `flowType` was in this list and no longer is: it became live when the pi_first flow was ported.
 * This array, its `case` below and the `Supported:` message must move together — an operator who
 * reads "has no effect in this connector. Ignoring." for a field that IS consumed is worse off than
 * with no message at all.
 */
const RULE_FIELDS_IGNORED_HERE: readonly string[] = ['collectBillingAddress'];

/**
 * How one rule field is validated.
 *
 * Data rather than a switch branch, because all four fields follow the identical shape — reject a
 * non-string, canonicalize, check membership — and differ only in the list, the canonicalizer and
 * the message. Adding a field is a new entry here, not a new branch in validateBehaviorRule.
 */
interface RuleFieldSpec {
  allowed: readonly string[];
  /** Applied before the membership check, so a stored value always matches the declared union. */
  canonicalize: (raw: string) => string;
  /** Completes `STRIPE_PAYMENT_BEHAVIOR_RULES["KEY"].field …` when the value is not in `allowed`. */
  expected: string;
  /**
   * Message for a non-string value, when it differs from `expected`.
   *
   * The asymmetry is preserved from the original switch rather than tidied away: flowType and
   * captureMethod tested `typeof value !== 'string' || !includes(value)` in ONE condition, so a
   * number got the full "must be one of" message, while setupFutureUsage and euBankTransferCountry
   * checked the type first and said "must be a string." Tests assert both spellings.
   */
  typeExpected?: string;
}

/** One entry per field validateBehaviorRule accepts. Keys are checked against PaymentBehaviorRule. */
const RULE_FIELD_SPECS: Readonly<Record<keyof PaymentBehaviorRule, RuleFieldSpec>> = {
  flowType: {
    allowed: RULE_FLOW_TYPES,
    canonicalize: (raw) => raw,
    expected: `must be one of ${RULE_FLOW_TYPES.join(', ')} (case-sensitive).`,
  },
  captureMethod: {
    allowed: RULE_CAPTURE_METHODS,
    canonicalize: (raw) => raw,
    expected: `must be one of ${RULE_CAPTURE_METHODS.join(', ')} (case-sensitive).`,
  },
  setupFutureUsage: {
    allowed: RULE_SETUP_FUTURE_USAGE,
    // Canonicalized so the stored value already matches the declared union and every consumer can
    // compare literals without re-normalizing.
    canonicalize: (raw) => raw.trim().toLowerCase(),
    expected: `must be one of ${RULE_SETUP_FUTURE_USAGE.map((v) => `'${v}'`).join(', ')}.`,
    typeExpected: 'must be a string.',
  },
  euBankTransferCountry: {
    allowed: EU_BANK_TRANSFER_COUNTRIES,
    // Case-INSENSITIVE, unlike flowType and captureMethod above, and the asymmetry is reasoned
    // rather than an inconsistency: an ISO country code has one conventional casing, so 'de' is a
    // typo of the same value. 'PI_FIRST' is a different behavior, so it is not silently accepted.
    canonicalize: (raw) => raw.trim().toUpperCase(),
    expected: `must be one of ${EU_BANK_TRANSFER_COUNTRIES.join(', ')}.`,
    typeExpected: 'must be a string.',
  },
};

/**
 * Returns the canonical form of a rule field's value, or undefined if it is unusable — in which case
 * it has already been reported through `drop` and the field falls back to its flat env var.
 */
const canonicalizeRuleValue = (
  value: unknown,
  spec: RuleFieldSpec,
  drop: (expected: string) => void,
): string | undefined => {
  if (typeof value !== 'string') {
    drop(spec.typeExpected ?? spec.expected);
    return undefined;
  }
  const canonical = spec.canonicalize(value);
  if (!spec.allowed.includes(canonical)) {
    drop(spec.expected);
    return undefined;
  }
  return canonical;
};

/**
 * Reports a field this connector will not act on: either one of checkout's fields, accepted so a
 * single rules map can serve both connectors, or an outright unknown name.
 *
 * The unknown branch covers both a typo and the removed `bankTransfer` flag. Naming the supported
 * set matters more than usual there: a deployment carrying the old config is otherwise given new
 * behavior with no indication that a field it still sets stopped meaning anything.
 */
const reportInactiveField = (prefix: string, field: string): void => {
  if (RULE_FIELDS_IGNORED_HERE.includes(field)) {
    console.error(
      `[config] ${prefix}.${field} is a ct-connect-stripe-checkout field and has no effect in this connector. Ignoring.`,
    );
    return;
  }
  console.error(
    `[config] ${prefix} has unknown field '${field}'. Supported: flowType, captureMethod, ` +
      `setupFutureUsage, euBankTransferCountry. ` +
      `Accepted but ignored here: ${RULE_FIELDS_IGNORED_HERE.join(', ')}. ` +
      `Ignoring this field. Startup continues.`,
  );
};

/**
 * Validates a single rule's fields and returns it in canonical form.
 *
 * DEGRADES, NEVER ABORTS. An unusable field is reported and DROPPED, which makes that one setting fall
 * back to its flat env var default while the rest of the rule, the rest of the map and the deployment
 * all survive (ADR-012). It corrects a real mistake in the previous
 * version, which threw: a single mistyped value took down every payment on the deployment, while the
 * mistake it was protecting against only ever cost one setting in one market. Bricking the store is the
 * worse failure by a wide margin, and a deploy that will not boot also removes the operator's ability to
 * fix anything else.
 *
 * This is strictly better than the reference too, rather than a retreat to it. ct-connect-stripe-checkout
 * does not validate field values at all — it casts the parsed map — so {"MX":{"captureMethod":"Manual"}}
 * reaches the Stripe API there and fails at the till, for every MX shopper, with an error that looks like
 * a Stripe fault. Here the same typo is named at startup and MX simply uses STRIPE_CAPTURE_METHOD.
 *
 * WHERE THE LINE IS. Structure still aborts (see getPaymentBehaviorConfig): malformed JSON, a non-object
 * map, a non-object rule. Those have no per-field fallback available — the failure mode is losing EVERY
 * rule at once, which silently changes capture timing in every configured market rather than costing one
 * setting. checkout draws the line in the same place, so the two connectors agree on it.
 *
 * console.error rather than the logger: this runs at module load, before the logger exists.
 */
const validateBehaviorRule = (key: string, rule: Record<string, unknown>): PaymentBehaviorRule => {
  const prefix = `STRIPE_PAYMENT_BEHAVIOR_RULES["${key}"]`;
  const validated: PaymentBehaviorRule = {};

  /** Reports an unusable field and leaves it unset, so the flat env var default applies. */
  const drop = (field: string, expected: string, value: unknown): void => {
    console.error(
      `[config] ${prefix}.${field} ${expected} Got: ${JSON.stringify(value)}. ` +
        `Ignoring this field — it falls back to the default. Startup continues.`,
    );
  };

  for (const [field, value] of Object.entries(rule)) {
    const spec: RuleFieldSpec | undefined = RULE_FIELD_SPECS[field as keyof PaymentBehaviorRule];
    if (!spec) {
      reportInactiveField(prefix, field);
      continue;
    }
    const canonical = canonicalizeRuleValue(value, spec, (expected) => drop(field, expected, value));
    if (canonical !== undefined) {
      Object.assign(validated, { [field]: canonical });
    }
  }

  // Cross-field check, and it degrades like everything else above. Each field is valid alone, but the
  // pair is self-defeating: applyPiFirstOverride discards setup_future_usage for any cart resolving to
  // pi_first, so the mandate would never reach the PaymentIntent. Dropping it here makes the stored
  // config match what actually happens, instead of leaving a payment mandate that looks configured and
  // silently is not. See KI-045.
  //
  // MANDATE values only, not `!== undefined`: setupFutureUsage is stored canonicalized, so the disabling
  // spellings ('', 'none', 'null', 'undefined') are present as literal strings and they ask for exactly
  // what pi_first already produces — redundant rather than contradictory.
  if (
    validated.flowType === 'pi_first' &&
    (validated.setupFutureUsage === 'off_session' || validated.setupFutureUsage === 'on_session')
  ) {
    console.error(
      `[config] ${prefix} sets both flowType 'pi_first' and setupFutureUsage ` +
        `'${validated.setupFutureUsage}'. pi_first always discards setup_future_usage from the ` +
        `PaymentIntent, so this mandate would never take effect. Ignoring setupFutureUsage for this rule. ` +
        `Startup continues.`,
    );
    delete validated.setupFutureUsage;
  }

  return validated;
};

/**
 * Parses STRIPE_PAYMENT_BEHAVIOR_RULES. Returns undefined when the env var is absent or blank.
 *
 * TWO FAILURE MODES, and the split is the whole design — do not describe this as "strict". STRUCTURE
 * aborts startup: malformed JSON, a non-object map, a rule that is not an object. Those have no
 * per-field fallback, so the failure mode is losing EVERY rule at once. FIELD VALUES do not abort:
 * validateBehaviorRule reports and drops an unusable field, that one setting falls back to its flat
 * env var, and the deployment survives. See validateBehaviorRule for why, and connect.yaml's
 * STRIPE_PAYMENT_BEHAVIOR_RULES description, which states the same split to the operator.
 *
 * An earlier version of this docblock claimed that an unexpected field type or value also threw. It
 * does not, and saying so is worse than saying nothing: it tells an operator that a typo will be
 * caught by a failed deploy, when in reality the deploy goes green and the setting silently reverts
 * to its default — the exact "config that looks configured and is not" failure this file argues
 * against everywhere else.
 *
 * Does NOT use parseJSON() — that helper silently returns {} on error, which is unsuitable for
 * startup validation. With a silent {}, malformed JSON would drop every per-country rule without
 * a trace and fall every cart back to the flat STRIPE_CAPTURE_METHOD (default 'automatic'): a
 * country configured 'manual' would begin capturing funds at authorization and nothing would
 * report it. Fail hard at boot instead.
 */
const getPaymentBehaviorConfig = (): PaymentBehaviorConfig | undefined => {
  // trim() so a whitespace-only value from the CT Connect config UI reads as "not configured"
  // rather than reaching JSON.parse and aborting the deploy with the reason only in console.error.
  // checkout does not trim; this divergence is benign and strictly safer.
  const raw = process.env.STRIPE_PAYMENT_BEHAVIOR_RULES?.trim();
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // console.error instead of log — the logger is not initialized at module load time.
    // (checkout carries an eslint-disable for no-console here; that rule is not enabled in this
    // connector, and keeping the directive would raise an "unused disable directive" warning.)
    console.error('[config] STRIPE_PAYMENT_BEHAVIOR_RULES contains invalid JSON. Startup aborted.', e);
    throw new Error('STRIPE_PAYMENT_BEHAVIOR_RULES contains invalid JSON');
  }
  // Guard: must be a plain object (not null, not an array) whose values are objects.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      'STRIPE_PAYMENT_BEHAVIOR_RULES must be a JSON object (e.g. {"MX":{"captureMethod":"manual"}}). Got: ' +
        JSON.stringify(parsed),
    );
  }
  const validated: PaymentBehaviorConfig = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(
        `STRIPE_PAYMENT_BEHAVIOR_RULES["${key}"] must be an object rule (e.g. {"captureMethod":"manual"}). Got: ` +
          JSON.stringify(value),
      );
    }
    validated[key] = validateBehaviorRule(key, value as Record<string, unknown>);
  }
  return validated;
};

const getSavedPaymentConfig = (): PaymentFeatures => {
  const config = process.env.STRIPE_SAVED_PAYMENT_METHODS_CONFIG;
  return {
    //default values disabled {"payment_method_save":"disabled"}
    ...(config ? parseJSON<PaymentFeatures>(config) : null),
  };
};

export const config = {
  // Required by Payment SDK
  projectKey: process.env.CTP_PROJECT_KEY || 'payment-integration',
  clientId: process.env.CTP_CLIENT_ID || 'xxx',
  clientSecret: process.env.CTP_CLIENT_SECRET || 'xxx',
  jwksUrl: process.env.CTP_JWKS_URL || 'https://mc-api.europe-west1.gcp.commercetools.com/.well-known/jwks.json',
  jwtIssuer: process.env.CTP_JWT_ISSUER || 'https://mc-api.europe-west1.gcp.commercetools.com',
  authUrl: process.env.CTP_AUTH_URL || 'https://auth.europe-west1.gcp.commercetools.com',
  apiUrl: process.env.CTP_API_URL || 'https://api.europe-west1.gcp.commercetools.com',
  sessionUrl: process.env.CTP_SESSION_URL || 'https://session.europe-west1.gcp.commercetools.com/',
  checkoutUrl: process.env.CTP_CHECKOUT_URL || 'https://checkout.europe-west1.gcp.commercetools.com',
  healthCheckTimeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || '5000'),

  // Required by logger
  loggerLevel: process.env.LOGGER_LEVEL || 'info',

  // Update with specific payment providers config
  mockClientKey: process.env.MOCK_CLIENT_KEY || 'stripe',
  mockEnvironment: process.env.MOCK_ENVIRONMENT || 'TEST',

  // Update with specific payment providers config
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || 'stripeSecretKey',
  stripeWebhookSigningSecret: process.env.STRIPE_WEBHOOK_SIGNING_SECRET || '',
  stripeCaptureMethod: process.env.STRIPE_CAPTURE_METHOD || 'automatic',
  stripePaymentElementAppearance: process.env.STRIPE_APPEARANCE_PAYMENT_ELEMENT,
  stripeExpressCheckoutAppearance: process.env.STRIPE_APPEARANCE_EXPRESS_CHECKOUT,
  stripeLayout: process.env.STRIPE_LAYOUT || '{"type":"tabs","defaultCollapsed":false}',
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  stripeApplePayWellKnown: process.env.STRIPE_APPLE_PAY_WELL_KNOWN || 'mockWellKnown',
  stripeApiVersion: process.env.STRIPE_API_VERSION || '2025-12-15.clover',
  stripeSavedPaymentMethodConfig: getSavedPaymentConfig(),
  stripeCollectBillingAddress: process.env.STRIPE_COLLECT_BILLING_ADDRESS || 'auto',

  // Payment Providers config
  merchantReturnUrl: process.env.MERCHANT_RETURN_URL || '',

  /**
   * Subscription payment handling strategy
   * - 'createOrder': Creates a new order for each subscription payment (default)
   * - 'addPaymentToOrder': Adds payment to existing order
   *
   * Environment variable: STRIPE_SUBSCRIPTION_PAYMENT_HANDLING
   */
  subscriptionPaymentHandling: (process.env.STRIPE_SUBSCRIPTION_PAYMENT_HANDLING ||
    'createOrder') as SubscriptionPaymentHandling,

  /**
   * Enable automatic price synchronization for subscriptions
   * When enabled, subscription prices are automatically synchronized with current
   * commercetools product prices before each invoice is created via invoice.upcoming webhook
   *
   * Environment variable: STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED
   */
  subscriptionPriceSyncEnabled: process.env.STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED === 'true' || false,

  /**
   * Enable multicapture and multirefund support for Stripe payments
   * When enabled, allows:
   * - Multiple partial captures on a single payment (multicapture)
   * - Multiple refunds to be processed on a single charge (multirefund)
   *
   * Default: false (disabled) - Merchants must opt-in to enable these advanced features
   * Note: This feature requires multicapture to be enabled in your Stripe account
   *
   * Environment variable: STRIPE_ENABLE_MULTI_OPERATIONS
   */
  stripeEnableMultiOperations: process.env.STRIPE_ENABLE_MULTI_OPERATIONS === 'true' || false,

  /**
   * Controls the Stripe Elements initialization strategy.
   *
   * - 'deferred' (default): Elements created with { mode, amount, currency } — the PaymentIntent is
   *                         created at submit time. Compatible with every payment method today.
   * - 'pi_first'          : Elements created with { clientSecret } fetched before mount. Required by
   *                         payment methods that must bind to a PaymentIntent before rendering —
   *                         bank transfers (customer_balance) and BLIK.
   *
   * STILL DO NOT ENABLE 'pi_first' — but the reason has changed, and the conclusion has not.
   *
   * The enabler port has landed: the enabler now reads flowType from the /config-element response and,
   * for a Payment Element on a one-time-payment cart, creates the PaymentIntent before mount and
   * initializes Elements with its clientSecret. So the mechanism works. Two OPEN risks are what keep
   * this off, and neither is a frontend gap:
   *
   *   1. ORPHANS AND THE FROZEN CART. Moving PaymentIntent creation to mount means merely OPENING the
   *      payment page creates a PaymentIntent, creates a commercetools Payment, and freezes the cart.
   *      paymentIntents.create has no deterministic idempotency key and handleCtPaymentCreation always
   *      creates a new CT Payment, so any re-instantiation of the enabler orphans the previous pair.
   *      There is no unfreeze-on-abandonment path, and a storefront that clears a non-Active cart will
   *      empty the shopper's basket when they return. See KI-044.
   *
   *   2. UNDERPAYMENT WINDOW. The confirm path validates the PaymentIntent amount against
   *      ctPayment.amountPlanned — a snapshot taken when the PaymentIntent was created — never against
   *      the cart's current total. Under 'deferred' that window is milliseconds. Under 'pi_first' it is
   *      the lifetime of the page, and the shipping-methods endpoints unfreeze the cart, change the
   *      rate and re-freeze it. A cart mounted at X whose total then becomes Y > X still confirms at X
   *      and passes validation. Excluding Express Checkout does NOT close this: those endpoints are
   *      session-authenticated HTTP and reachable from a Payment Element session.
   *
   * Both are processor-side and neither is fixed here. Do not read "the frontend now works" as
   * "'pi_first' is ready".
   *
   * The cost has two distinct sources and they are NOT equally real. Both earlier drafts of this
   * comment got the distinction wrong in opposite directions, so it is spelled out:
   *
   *   LIVE TODAY — a per-cart rule's own setupFutureUsage is DISCARDED on the PaymentIntent.
   *   applyPiFirstOverride drops whatever resolveSetupFutureUsage returned, and a rule-supplied
   *   'off_session'/'on_session' has been live since the behavior-rule change. So a merchant who
   *   configures {"DE":{"flowType":"pi_first","setupFutureUsage":"off_session"}} loses the mandate
   *   now. This is the real present-day cost.
   *
   *   NO LONGER LATENT, NOW MOOT — suppression at the elements() level. This entry used to say the
   *   Elements-level cost was zero today and would become real once a merchant set
   *   payment_method_save_usage in STRIPE_SAVED_PAYMENT_METHODS_CONFIG. The enabler port overtook that:
   *   under 'pi_first' the enabler takes its clientSecret branch, which cannot pass setupFutureUsage at
   *   all — Stripe's StripeElementsOptionsClientSecret does not declare it — and deliberately omits
   *   customerOptions too. So a 'pi_first' cart shows no saved payment methods and saves none,
   *   regardless of what this variable is set to. The suppression below is therefore redundant for the
   *   Elements path rather than pending on it. It is kept because it keeps this response honest about
   *   what the shopper will actually get.
   *
   * DIVERGENCE FROM CHECKOUT — deliberate, not an oversight in the port. checkout falls back to
   * 'deferred' with a console.warn on an unknown value (config.ts:134-145). Here an unknown value
   * ABORTS startup, for consistency with the rule validation above: config that looks configured and
   * is not is worse than a crash. STRIPE_PAYMENT_FLOW=pi_frist would fall back to 'deferred', leave
   * bank transfers silently off, and surface as "I configured pi_first and the tab never appears" —
   * days later, from someone else. It is a deploy-time variable, so a boot abort reports it at deploy
   * time, where a check catches it, rather than a stdout warning nobody reads in CT Connect.
   *
   * Blank is NOT invalid, it is absent: an optional variable with no default in connect.yaml can come
   * back from the CT Connect config UI as '' or whitespace, and aborting on that would brick a deploy
   * that simply never set it. Same reasoning, and the same `?.trim()`, as getPaymentBehaviorConfig.
   *
   * Change requires redeployment. Environment variable: STRIPE_PAYMENT_FLOW
   */
  stripePaymentFlow: (() => {
    const raw = process.env.STRIPE_PAYMENT_FLOW?.trim();
    if (!raw) return 'deferred';
    if (!RULE_FLOW_TYPES.includes(raw)) {
      // Falls back rather than throwing, matching ct-connect-stripe-checkout and the rule fields above.
      // Falling back loses one feature; aborting takes every payment on the deployment down over a typo
      // and denies the operator any running service to fix it from. See ADR-012 for the trade-off and
      // for where the line between degrade and abort sits.
      //
      console.error(
        `[config] STRIPE_PAYMENT_FLOW must be one of ${RULE_FLOW_TYPES.join(', ')} (case-sensitive). Got: ` +
          `${JSON.stringify(raw)}. Falling back to 'deferred'. NOTE this disables bank transfers and BLIK, ` +
          `which cannot render in the deferred flow. Startup continues.`,
      );
      return 'deferred';
    }
    return raw as 'deferred' | 'pi_first';
  })(),

  /**
   * Per-cart payment behavior overrides, keyed by cart country or CT store key.
   * Contains exceptions only — the flat env vars above are always the default, and there is no
   * wildcard key. Malformed JSON aborts startup (see getPaymentBehaviorConfig).
   *
   * Environment variable: STRIPE_PAYMENT_BEHAVIOR_RULES
   * Example: {"DE":{"captureMethod":"automatic","euBankTransferCountry":"DE"},"MX":{"captureMethod":"manual"}}
   *
   * That DE entry is the whole bank-transfer configuration story, and it is worth reading as two
   * independent halves rather than one feature:
   *   - `captureMethod: 'automatic'` is what lets DE offer bank transfer while MX stays on manual
   *     capture. Manual capture excludes customer_balance at Stripe's end, so this is the switch —
   *     there is no separate enable flag, and there used to be one.
   *   - `euBankTransferCountry: 'DE'` only overrides which IBAN the shopper is shown. Omit it and the
   *     rail still works; Stripe defaults EUR to an Irish IBAN. See getBankTransferOptions.
   * A market that wants bank transfer and is already on the default automatic capture needs no entry
   * here at all — only STRIPE_PAYMENT_FLOW=pi_first and the Dashboard toggle.
   */
  stripePaymentBehaviorRules: getPaymentBehaviorConfig(),
};

export const getConfig = () => {
  return config;
};
