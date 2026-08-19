import { Cart } from '@commercetools/connect-payments-sdk';
import type { EuBankTransferCountry } from '../mappers/bank-transfer-mapper';

/**
 * A single rule applied when a cart matches a discriminator key.
 * All fields are optional — only supplied fields override the flat env vars.
 *
 * Ported from ct-connect-stripe-checkout's payment-behavior-resolver so the two connectors
 * converge. One of checkout's fields is still deliberately NOT ported:
 *   - `collectBillingAddress` — nothing here overrides it per cart yet.
 * Add it the day a consumer arrives, not before — getPaymentBehaviorConfig accepts the name in a
 * rules map (so one map can serve both connectors) but reports at startup that it has no effect
 * here.
 *
 * `flowType` used to be in that same category, on the reasoning that bank transfer did not need
 * pi_first and that only BLIK did. THAT REASONING WAS FALSE AND IS RETRACTED — do not restore it.
 * Stripe's bank transfer documentation requires Elements to be initialized with a `clientSecret` and
 * states that the deferred flow is unsupported, which is precisely what pi_first provides. Measured
 * on a Stripe test account: a PaymentIntent with automatic_payment_methods and a customer DOES include
 * customer_balance, yet the deferred Element shows no bank-transfer tab even with an authenticated
 * cart, a resolved Stripe Customer, capture_method 'automatic' and setup_future_usage unset. The
 * initialization flow is the cause, not the PaymentIntent configuration.
 *
 * Field types are narrow because getPaymentBehaviorConfig validates and canonicalizes every field
 * at startup before a rule reaches this type. The union is not a claim about raw JSON — it is a
 * claim about post-validation data, which is where these values are actually consumed.
 */
export interface PaymentBehaviorRule {
  /**
   * Elements initialization strategy for carts matching this key, overriding STRIPE_PAYMENT_FLOW.
   *
   * See config.stripePaymentFlow for what each value means and, more importantly, for why setting
   * 'pi_first' today is cost without benefit: the bank-transfer tab still will not appear until the
   * enabler port lands, while a rule that pairs this field with setupFutureUsage already loses that
   * mandate on the PaymentIntent.
   */
  flowType?: 'deferred' | 'pi_first';
  captureMethod?: 'automatic' | 'automatic_async' | 'manual';
  /** Canonical (trimmed, lowercased) at startup. Empty/'none'/'null'/'undefined' mean "do not send". */
  setupFutureUsage?: 'off_session' | 'on_session' | '' | 'none' | 'null' | 'undefined';
  /**
   * Country whose IBAN a EUR bank-transfer shopper is instructed to wire funds to
   * (`payment_method_options.customer_balance.bank_transfer.eu_bank_transfer.country`).
   *
   * OPTIONAL, and its absence is the normal case rather than a gap. Stripe resolves the bank transfer
   * variant from the cart currency by itself and defaults EUR to an Irish IBAN, so a market with no
   * entry here still takes bank transfers end to end. Set it only to override that default — normally
   * so a merchant's own-country shoppers wire to a local IBAN and avoid cross-border fees. See
   * getBankTransferOptions for the measurement behind this.
   *
   * THERE IS DELIBERATELY NO SEPARATE ENABLE FLAG. An earlier design paired this with a `bankTransfer`
   * boolean, on the belief that the connector had to opt a market in. It does not: whether the rail
   * exists at all is a Stripe Dashboard setting for the whole account, and whether the widget can show
   * it is `flowType`. The only connector-side conflicts are `captureMethod: 'manual'` and a
   * `setupFutureUsage` mandate, both of which exclude customer_balance at Stripe's end — and both of
   * which this same rule can already set per market, which is exactly why the extra flag was
   * redundant. See ADR-011.
   *
   * It CANNOT be derived from `cart.country` even though `cart.country` is trusted: a EUR cart from
   * ES, IT or PT has no valid value in the four-country list, so deriving it would silently misroute
   * most of the eurozone. It is explicit merchant config or it is Stripe's default.
   *
   * Resolved through resolveTrustedPaymentBehavior ONLY. Choosing which of the merchant's bank
   * accounts a shopper wires money to is the exact case extractCountry's docblock names as never
   * acceptable from shopper-typed data. Canonical (trimmed, uppercased, membership-checked) at
   * startup, so consumers compare literals without re-normalizing.
   */
  euBankTransferCountry?: EuBankTransferCountry;
}

/**
 * Map of discriminator key → rule.
 * Keys are either a two-letter ISO country code (e.g. "DE") or a CT store key (e.g. "store-mx").
 * Env vars are always the default — this map contains exceptions only. No wildcard key.
 */
export interface PaymentBehaviorConfig {
  [key: string]: PaymentBehaviorRule;
}

/**
 * Narrowing type for a CT Cart extended with a store reference.
 * The @commercetools/connect-payments-sdk Cart type does not expose the store field, but the
 * platform-sdk Cart may carry it. This interface narrows safely without `any`.
 */
interface CartWithStore extends Cart {
  store?: { typeId: 'store'; key: string };
}

/**
 * Extracts the country used as the resolver discriminator. Exactly TWO rule fields resolve through
 * here, and the body below explains why only that category may:
 *   - `captureMethod` and `setupFutureUsage` — the BOUNDED-CHOICE category, accepted.
 * `flowType` and `euBankTransferCountry` resolve through extractTrustedDiscriminator instead, and
 * have no consumer in this function by design.
 * Before adding a third consumer here, establish which of the two categories it belongs to; if the
 * field names a destination or a counterparty, it is not this one.
 *
 * Priority:
 *   1. cart.country                 — set at cart creation, NOT shopper-editable
 *   2. cart.billingAddress.country  — reliably present, because the enabler hardcodes
 *                                     billingAddressRequired: true (KI-014)
 *
 * READ THE TRUST BOUNDARY CAREFULLY — step 2 is justified by AVAILABILITY, not INTEGRITY.
 * Only `cart.country` is genuinely outside the shopper's reach. `cart.billingAddress.country` is
 * data the shopper types: this connector's processor never writes it (verified — the only address
 * this processor writes to a cart is `shippingAddress`, from the express-checkout handler), but the
 * merchant's storefront generally does collect it from the shopper.
 *
 * WHY THE LINE IS NOT "CHANGES PAYMENTINTENT PARAMETERS" vs NOT. An earlier version of this comment
 * drew it there, and that line does not survive contact with the code: `capture_method` and
 * `setup_future_usage` are PaymentIntent parameters too — they sit in the same object handed to
 * paymentIntents.create as everything in the trusted category. The line that actually holds is
 * BOUNDED CHOICE:
 *
 *   - ACCEPTED here: the shopper can only SELECT AMONG rules the merchant authored. Every value
 *     reachable this way is one the merchant already approved for a market of their own. The shopper
 *     picks which of the merchant's policies applies to them; they cannot introduce a value.
 *   - REJECTED here: a field whose value NAMES A DESTINATION or a counterparty. `euBankTransferCountry`
 *     chooses which of the merchant's bank accounts a shopper is told to wire money to — there,
 *     selecting among merchant-authored options IS the harm, not a mitigation of it.
 *
 * KNOWN RESIDUAL, stated rather than argued away: `captureMethod` DOES gate a payment rail. Manual
 * capture and an off_session/on_session mandate each remove customer_balance from the methods Stripe
 * resolves — connect.yaml documents exactly this as the bank-transfer enable switch. So on a cart with
 * no `cart.country`, a shopper typing a billing country that matches a rule key can turn bank transfer
 * on or off for their own checkout. Accepted under the bounded-choice rule above, and to keep parity
 * with ct-connect-stripe-checkout, which resolves captureMethod the same way. Do NOT restate this as
 * "moves no money anywhere new" — that claim was in this comment, it is false, and it is the same
 * mistake that put flowType on the wrong side until KI-046. See KI-048.
 *
 * So: anything that names a destination must read `cart.country` ONLY, never this function. That is
 * `euBankTransferCountry`, which resolves through extractTrustedDiscriminator — not a rule for future
 * fields but a description of the current call sites. Otherwise a shopper could choose the country of
 * the bank account they are told to wire money to by typing a billing country.
 *
 * THE RETRACTED CATEGORY — `flowType`. An earlier version of this comment placed it here, as allowed
 * to resolve through this function, on the reasoning that it "moves no money, enables no payment rail,
 * and chooses no destination for funds". **That was wrong and is retracted.** It assessed flowType
 * against what it does to the initialization flow, and missed that the same commit wired it to
 * `applyPiFirstOverride`, which strips `setup_future_usage` from the PaymentIntent. flowType changes
 * PaymentIntent parameters, so it belongs in the financially-directive category, and it now resolves
 * through `extractTrustedDiscriminator` instead. See KI-046.
 *
 * DIVERGENCE FROM CHECKOUT — deliberate, not an infidelity in the port.
 * checkout's extractDiscriminator also falls back to `cart.shippingAddress.country`. This
 * connector drops that fallback, because the express-checkout `shippingaddresschange` handler
 * (enabler/src/dropin/dropin-embedded.ts → commerce-tools/shipping-client.ts) writes the
 * shopper's own address straight to the CT cart. That makes shipping country shopper-controlled
 * inside this connector, not merely upstream of it.
 *
 * Do not "restore parity" with checkout here without closing that hole on both sides.
 */
export const extractCountry = (cart: Cart): string | undefined =>
  cart.country ?? cart.billingAddress?.country ?? undefined;

/**
 * Extracts the discriminator value from a cart: a country (see extractCountry) or, when no
 * country is derivable, the CT store key. Returns undefined when neither exists.
 *
 * SHOPPER-REACHABLE. Because extractCountry falls back to the billing country, a shopper on a cart
 * with no `cart.country` can influence which rule matches. Only use this for fields where that is
 * acceptable — see extractCountry's two categories. For anything that changes PaymentIntent
 * parameters, use extractTrustedDiscriminator.
 */
export const extractDiscriminator = (cart: Cart): string | undefined =>
  extractCountry(cart) ?? (cart as CartWithStore).store?.key ?? undefined;

/**
 * Same lookup as extractDiscriminator, minus the billing-country fallback.
 *
 * `cart.country` is set at cart creation and `store.key` is chosen by the storefront; neither is
 * typed by the shopper. So a rule selected through this function was selected by the merchant's own
 * data, which is the precondition for letting a rule change PaymentIntent parameters.
 *
 * Use this for every financially-directive field. Both that exist resolve through here:
 *   - `flowType` — drives applyPiFirstOverride, which discards setup_future_usage.
 *   - `euBankTransferCountry` — chooses which of the merchant's bank accounts a shopper wires to.
 * Do not widen it "for consistency" with extractDiscriminator — the asymmetry IS the point.
 *
 * Cost of the narrowing, measured 2026-08-03 rather than assumed: real sample-site carts carry
 * `country: 'US'` at the top level, and `billingAddress` was empty on a completed checkout cart. So
 * the dropped fallback was not carrying real traffic.
 */
export const extractTrustedDiscriminator = (cart: Cart): string | undefined =>
  cart.country ?? (cart as CartWithStore).store?.key ?? undefined;

/**
 * Resolves the PaymentBehaviorRule that applies to a given cart.
 *
 * Lookup:
 *   1. cart discriminator key (country, then store key)
 *   2. undefined — no override; the caller uses the flat env var values
 *
 * No wildcard key. Env vars are always the default.
 *
 * @param config  Parsed STRIPE_PAYMENT_BEHAVIOR_RULES map. May be empty or undefined.
 * @param cart    The current CT cart.
 * @returns       The matching PaymentBehaviorRule, or undefined when no rule matches.
 */
export const resolvePaymentBehavior = (
  config: PaymentBehaviorConfig | undefined,
  cart: Cart,
): PaymentBehaviorRule | undefined => {
  if (!config || Object.keys(config).length === 0) return undefined;

  const discriminator = extractDiscriminator(cart);
  if (discriminator && config[discriminator]) {
    return config[discriminator];
  }

  return undefined;
};

/**
 * Same as resolvePaymentBehavior, but matching only on merchant-controlled cart data.
 *
 * Returns the rule that may change PaymentIntent parameters for this cart. Differs from
 * resolvePaymentBehavior only when the cart has no `cart.country` and its billing country matches a
 * rule key: there this returns undefined, so the caller falls back to the flat env var instead of
 * honouring a rule the shopper selected. See extractTrustedDiscriminator and KI-046.
 *
 * @param config  Parsed STRIPE_PAYMENT_BEHAVIOR_RULES map. May be empty or undefined.
 * @param cart    The current CT cart.
 * @returns       The matching PaymentBehaviorRule, or undefined when no rule matches.
 */
export const resolveTrustedPaymentBehavior = (
  config: PaymentBehaviorConfig | undefined,
  cart: Cart,
): PaymentBehaviorRule | undefined => {
  if (!config || Object.keys(config).length === 0) return undefined;

  const discriminator = extractTrustedDiscriminator(cart);
  if (discriminator && config[discriminator]) {
    return config[discriminator];
  }

  return undefined;
};
