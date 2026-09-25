import Stripe from 'stripe';
import { Attribute, LocalizedString } from '@commercetools/platform-sdk';
import { PaymentOutcome } from './dtos/stripe-payment.dto';
import { StripeEvent } from './services/types/stripe-payment.type';
import { METADATA_SUBSCRIPTION_ID_FIELD } from './constants';

export const parseJSON = <T extends object | []>(json?: string): T => {
  try {
    return JSON.parse(json || '{}');
  } catch (error) {
    console.error('Error parsing JSON', error);
    return {} as T;
  }
};

export const convertPaymentResultCode = (resultCode: PaymentOutcome): string => {
  switch (resultCode) {
    case PaymentOutcome.AUTHORIZED:
      return 'Success';
    case PaymentOutcome.REJECTED:
      return 'Failure';
    default:
      return 'Initial';
  }
};

export const isValidUUID = (uuid: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

/**
 * True when this event describes money moved by a subscription invoice rather than a standalone
 * payment. Callers use it to skip work that would otherwise double-count the same money.
 *
 * WHY THIS READS METADATA AND NOT `invoice`. It used to return `!!paymentIntent.invoice` and
 * `!!charge.invoice`. Stripe REMOVED the `invoice` field from PaymentIntent in the Basil API version
 * (2025-03-31) and it is absent from Charge on current versions too — measured 2026-08-05 against a
 * real subscription charge on API version 2026-06-24.dahlia, where BOTH came back `null` while the
 * invoice genuinely owned the PaymentIntent (confirmed by expanding `invoice.payments`).
 *
 * So the old guard evaluated `!!undefined` on every event and silently returned false forever. It did
 * not throw, it did not log, and TypeScript could not catch it because the field was hand-declared in
 * an inline intersection type — which is what let a removed API field keep type-checking. That is the
 * failure this doc comment exists to stop anyone from reintroducing.
 *
 * OBSERVED CONSEQUENCE, not a hypothetical: a mixed cart paid 359.15 USD once and commercetools
 * recorded THREE transactions — Authorization and Charge from the invoice, plus a second Charge from
 * `payment_intent.succeeded` that this guard should have suppressed. One charge at Stripe, two Charge
 * transactions in commercetools. Nobody is overcharged, but reconciliation breaks and any refund
 * computed from the sum of transactions would be wrong.
 *
 * WHY METADATA IS A SOUND SIGNAL HERE. `subscription_id` is written by this connector's own
 * subscription service, so it is our data rather than a Stripe field that can be removed underneath
 * us again. Verified on the same run: present on the subscription Charge, absent on two unrelated
 * successful Charges (card and Amazon Pay).
 *
 * TWO RESIDUAL RISKS, both narrower than the one being fixed, and neither hidden:
 *   1. The key is stamped by ctPaymentCreationService.updatePaymentMetadata, which UPDATES the
 *      PaymentIntent after creating it. An event arriving before that update lands would not be
 *      recognised. In practice the update runs during payment creation, before the shopper can
 *      confirm, so the window is small — but it is not zero, and it did not exist when the signal
 *      was a Stripe-native field set atomically.
 *   2. If that producer ever stops writing the key, this silently returns false again. Both sides
 *      therefore share METADATA_SUBSCRIPTION_ID_FIELD rather than repeating a string literal, so a
 *      rename moves them together.
 *
 * Restores an earlier fix for subscription double-counting, which regressed through an API version
 * bump rather than a code change.
 */
export const isFromSubscriptionInvoice = (event: Stripe.Event): boolean => {
  if (!event.type.startsWith('payment') && !event.type.startsWith('charge')) {
    return false;
  }

  // Both PaymentIntent and Charge carry `metadata`, so one read covers both event families. The
  // `invoice` fallbacks are kept for accounts still pinned to a pre-Basil API version, where they
  // are the authoritative signal — they cost one property read and make this correct on both sides
  // of the version boundary.
  const object = event.data.object as { metadata?: Stripe.Metadata | null; invoice?: string | Stripe.Invoice | null };

  return Boolean(object.metadata?.[METADATA_SUBSCRIPTION_ID_FIELD]) || Boolean(object.invoice);
};

export const BANK_TRANSFER_NEXT_ACTION_TYPE = 'display_bank_transfer_instructions';

/**
 * Narrow predicate: true only for a PaymentIntent that is awaiting a bank transfer.
 *
 * `payment_intent.requires_action` is NOT specific to bank transfers — card 3DS
 * (`use_stripe_sdk`), Boleto (`boleto_display_details`) and redirect-based methods emit the
 * same event. Routing that event without this predicate would write an Authorization/Pending
 * to commercetools on every 3DS payment, which is the most severe regression this feature
 * can cause.
 *
 * Currently consumed by the webhook route only. The confirmation gate
 * (`updatePaymentIntentStripeSuccessful`) must reuse this exact predicate rather than adding
 * `requires_action` to its status allowlist wholesale — that is a later stage of this feature.
 *
 * Strict equality on the literal, plus the presence of the instructions object, so an
 * unexpected Stripe payload fails closed rather than re-opening the 3DS path.
 */
export const isBankTransferNextAction = (paymentIntent: Stripe.PaymentIntent): boolean => {
  const nextAction = paymentIntent.next_action;
  return nextAction?.type === BANK_TRANSFER_NEXT_ACTION_TYPE && !!nextAction.display_bank_transfer_instructions;
};

export const MICRODEPOSIT_NEXT_ACTION_TYPE = 'verify_with_microdeposits';

/**
 * Narrow predicate: true only for a PaymentIntent awaiting ACH micro-deposit verification.
 *
 * Kept SEPARATE from `isBankTransferNextAction` on purpose. Micro-deposits (`us_bank_account`) and
 * bank transfer (`customer_balance`) are distinct rails with distinct `next_action` types; broadening
 * a single predicate would risk re-opening the card-3DS/Boleto path that the release-gate tests
 * guard. `verify_with_microdeposits` is exclusive to `us_bank_account` (SEPA debit does NOT use
 * micro-deposits) and disjoint from `use_stripe_sdk`/`redirect_to_url` (3DS) and
 * `boleto_display_details` (Boleto), so freezing on it cannot affect those rails.
 *
 * Strict equality on the literal plus presence of the instructions object, so an unexpected Stripe
 * payload fails closed.
 */
export const isMicrodepositNextAction = (paymentIntent: Stripe.PaymentIntent): boolean => {
  const nextAction = paymentIntent.next_action;
  return nextAction?.type === MICRODEPOSIT_NEXT_ACTION_TYPE && !!nextAction.verify_with_microdeposits;
};

export const isEventRefund = (event: Stripe.Event): boolean => {
  return event.type === StripeEvent.CHARGE__REFUNDED;
};

/**
 * Single implementation of the underpayment comparison shared by every order-creating path.
 *
 * WHY THE EXPECTED TOTAL IS A PARAMETER AND NOT DERIVED FROM THE CART HERE. The two flows do not
 * charge the same figure, and hard-coding either convention inside this function is what would
 * produce the duplicate-guard divergence that KI-050/KI-054 are both instances of:
 *   - One-time (`payment_intent.succeeded`): the PaymentIntent is created for the cart's payable
 *     amount, which is `taxedPrice.totalGross` when tax was calculated — so the caller passes that.
 *   - Subscription (`invoice.paid`): the invoice is assembled from Stripe Prices built off
 *     `lineItem.price.(discounted?.)value` plus the shipping price, and this connector never sets
 *     `automatic_tax` nor passes a Stripe Tax calculation on the subscription path — so the invoice
 *     carries NO tax and the caller passes `cart.totalPrice`. Comparing a subscription invoice
 *     against `totalGross` would reject every legitimate order in a tax-on-top configuration
 *     (the KI-047 false-positive failure mode, from the other direction).
 *
 * Integer comparison in the currency's minor unit, NOT divided by 100: commercetools `centAmount`
 * already respects the currency's fractionDigits and so does Stripe's amount, so this is correct for
 * USD and for zero-decimal currencies (JPY). Equality rejects both under- and over-payment.
 */
export const paidAmountMatchesTotal = (
  paidAmount: number,
  paidCurrency: string,
  expectedTotal: { centAmount: number; currencyCode: string },
): boolean => {
  const amountMatches = paidAmount === expectedTotal.centAmount;
  const currencyMatches = paidCurrency.toLowerCase() === expectedTotal.currencyCode.toLowerCase();
  return amountMatches && currencyMatches;
};

export const transformVariantAttributes = <T>(attributes?: Attribute[]): T => {
  const result: Record<string, string> = {};
  for (const { name, value } of attributes ?? []) {
    const cleanName = name.startsWith('stripeConnector_') ? name.replace('stripeConnector_', '') : name;
    result[cleanName] = isObject(value) ? value.key : value;
  }
  return result as T;
};

export const isObject = (value: unknown): value is Record<string, string> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const convertDateToUnixTimestamp = (date: string | number): number => {
  return Math.floor(new Date(date).getTime() / 1000);
};

export const parseTimeString = (timeString: string): { hour: number; minute: number; second: number } => {
  const [hoursStr, minutesStr, rest] = timeString.split(':');
  const [secondsStr] = rest.split('.');

  return {
    hour: parseInt(hoursStr, 10),
    minute: parseInt(minutesStr, 10),
    second: parseInt(secondsStr, 10),
  };
};

export const getLocalizedString = (obj?: LocalizedString): string => {
  if (!obj) {
    return '';
  }

  const locale = Object.keys(obj).find((key) => key.startsWith('en'));
  return locale ? obj[locale] : '';
};
