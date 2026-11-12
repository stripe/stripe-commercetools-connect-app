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
 * So the old guard evaluated `!!undefined` on every event and returned false forever. It did
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
 *   2. If that producer ever stops writing the key, this returns false again. Both sides
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
 * Single implementation of the amount comparison shared by every order-creating path.
 *
 * WHY THE EXPECTED TOTAL IS A PARAMETER AND NOT DERIVED FROM THE CART HERE. The two flows do not
 * charge the same figure, and hard-coding either convention inside this function is what would
 * produce the duplicate-guard divergence this helper exists to prevent:
 *   - One-time (`payment_intent.succeeded`): the PaymentIntent is created for the cart's payable
 *     amount, which is `taxedPrice.totalGross` when tax was calculated — so the caller passes that.
 *   - Subscription (`invoice.paid`): the invoice is assembled from Stripe Prices built off
 *     `lineItem.price.(discounted?.)value` plus the shipping price, and this connector never sets
 *     `automatic_tax` nor passes a Stripe Tax calculation on the subscription path — so the invoice
 *     carries NO tax and the caller passes `cart.totalPrice`. Comparing a subscription invoice
 *     against `totalGross` would reject every legitimate order in a tax-on-top configuration
 *     (the false-positive failure mode, from the other direction).
 *
 * Integer comparison in the currency's minor unit, NOT divided by 100: commercetools `centAmount`
 * already respects the currency's fractionDigits and so does Stripe's amount, so this is correct for
 * USD and for zero-decimal currencies (JPY). Equality rejects both a shortfall and an overpayment.
 */
export const paidAmountMatchesTotal = (
  paidAmount: number,
  paidCurrency: string,
  expectedTotal: { centAmount: number; currencyCode: string },
  // Minor-unit slack allowed between the two amounts. Defaults to 0 (exact equality). A positive value (1) is
  // used only for a discounted subscription invoice (ADR-026 and its 2026-11-10 addendum): Stripe rounds a
  // percentage coupon once, half-up, on the invoice subtotal, while commercetools rounds with the project's
  // priceRoundingMode (HalfEven by default), so the two can differ by one minor unit. The tolerance absorbs
  // that without widening enough to admit a real mischarge, which is bounded below by a whole discount amount.
  toleranceMinorUnits = 0,
): boolean => {
  const amountMatches = Math.abs(paidAmount - expectedTotal.centAmount) <= toleranceMinorUnits;
  const currencyMatches = paidCurrency.toLowerCase() === expectedTotal.currencyCode.toLowerCase();
  return amountMatches && currencyMatches;
};

/**
 * ADR-015: which commercetools-write failures are worth re-raising so the webhook route
 * returns non-2xx and Stripe redelivers. Only transient/retryable failures match — a permanent error
 * (auth, not-found, validation, a terminal 400 such as MissingTaxRateForCountry / InvalidField) would
 * just redeliver in vain (a retry storm). Shared by the subscription webhook handlers and the one-time
 * `payment_intent.succeeded` path so the two classify "retryable" identically (reuses ADR-015).
 */
export const RETRYABLE_CT_ERROR = /ConcurrentModification|409|429|50[23]|ETIMEDOUT|ECONNRESET/i;

/**
 * True when an unknown thrown value is a transient/retryable commercetools-write failure per
 * RETRYABLE_CT_ERROR. Centralises the classification so every caller decides identically.
 *
 * WHY THIS INSPECTS STRUCTURED FIELDS, NOT JUST `message`. A real commercetools-SDK error is an `Error`
 * whose human `message` reads "Object <id> has a different version than expected. Expected: 10 - Actual:
 * 12." — it contains NEITHER "ConcurrentModification" NOR "409". Those live on `error.code`
 * (`'ConcurrentModification'`), `error.statusCode`/`error.status` (`409`) and `error.name`. Testing the
 * message alone classified a genuine 409 as terminal and dropped a captured-but-orderless payment
 * (the live repro). So RETRYABLE_CT_ERROR is tested against `code + statusCode + status +
 * httpErrorStatus + name + message` joined together — structured signals and legacy message forms both match.
 * `httpErrorStatus` is where the payments SDK's own errors (e.g. from `getPayment`) carry the HTTP status
 * (added 2026-11-10, ADR-027: a 502/503/429 on that read was classified as permanent). A non-Error value
 * still falls back to its JSON so unknown shapes are not misclassified.
 */
export const isRetryableCtError = (error: unknown): boolean => {
  if (error instanceof Error) {
    const { name, message, code, statusCode, status, httpErrorStatus } = error as Error & {
      code?: unknown;
      statusCode?: unknown;
      status?: unknown;
      httpErrorStatus?: unknown;
    };
    const haystack = [code, statusCode, status, httpErrorStatus, name, message]
      .filter((part) => part !== undefined)
      .join(' ');
    return RETRYABLE_CT_ERROR.test(haystack);
  }
  return RETRYABLE_CT_ERROR.test(JSON.stringify(error));
};

/**
 * ADR-027: a Stripe failure worth a webhook redelivery — a connection error, a Stripe-side error (5xx), a rate
 * limit or lock timeout (429), or a conflict (409). stripe-node retries some of these itself before they reach
 * here (`RequestSender._shouldRetry`, twice by default): connection errors always; a 409 or a 5xx unless Stripe's
 * `stripe-should-retry` header says `false` (Stripe usually does for a 500); a 429 only when that header says
 * `true` (lock timeouts). Anything else (an invalid request, authentication,
 * permission, an idempotency mismatch) is permanent: repeating the same request cannot succeed (measured:
 * pausing a canceled or missing subscription answers `invalid_request_error`). The same split as ADR-015's
 * for commercetools writes.
 */
export const isTransientStripeError = (error: unknown): boolean => {
  const { type, statusCode } = (error ?? {}) as { type?: string; statusCode?: number };
  if (type === 'StripeConnectionError' || type === 'StripeAPIError' || type === 'StripeRateLimitError') {
    return true;
  }
  return statusCode === 409 || statusCode === 429 || (statusCode !== undefined && statusCode >= 500);
};

/**
 * Narrow predicate: true only for a commercetools optimistic-locking conflict (ConcurrentModification /
 * HTTP 409). Unlike `isRetryableCtError` this is deliberately NOT the full transient set — the version
 * race is the only failure a re-read-and-retry can resolve, so `createOrderPinned` keys its single retry
 * off this and lets every other transient (429/502/503/…) surface to the outer classifier.
 *
 * Classifies by the STRUCTURED fields a real CT-SDK error carries (`code === 'ConcurrentModification'`,
 * `statusCode`/`status === 409`) and falls back to the message so a legacy "409"/"ConcurrentModification"
 * string still matches. Same message-text flaw as the old `isRetryableCtError`: a real 409's human
 * message is "Object <id> has a different version than expected…", which contains neither token.
 */
export const isConcurrentModificationError = (error: unknown): boolean => {
  if (error instanceof Error) {
    const { code, statusCode, status, message } = error as Error & {
      code?: unknown;
      statusCode?: unknown;
      status?: unknown;
    };
    if (code === 'ConcurrentModification' || statusCode === 409 || status === 409) {
      return true;
    }
    return /ConcurrentModification|409/i.test(message);
  }
  return /ConcurrentModification|409/i.test(JSON.stringify(error));
};

/**
 * Reduces an unknown thrown value to a log-safe shape — a fixed whitelist of diagnostic fields only.
 * Used wherever a raw error would otherwise reach the Connect logs (the paid-without-order path, and
 * processor-wide). The raw error must never be logged verbatim: a stripe-node `StripeError`
 * exposes `raw` / `payment_intent` / `setup_intent` / `charge` / `payload` as own-enumerable props, so a
 * naive `{ error }` or `JSON.stringify(error)` leaks `client_secret` (and bank-transfer IBAN/BIC) while
 * dropping the non-enumerable `message`; a commercetools 400's body can echo the shopper's address PII.
 *
 * Whitelist (included only when present): `name`, `message`, `code`, `statusCode`, `httpErrorStatus`,
 * `type`, `requestId`, `decline_code`, `param`, `doc_url`. Stripe nests the structured fields under `.raw`, so each field is
 * read from the error first and from `.raw` as a fallback. A wrapped error (ErrorGeneral / StripeApiError)
 * can carry the original provider error under `.cause`; its safe fields are surfaced recursively so the
 * global handler keeps classification without serializing the raw cause.
 *
 * Pure: never mutates `error`, its `.raw`, or its `.cause` — downstream classification depends on the live
 * `code` / `statusCode`, so the live object is left intact. ADR-023.
 */
// Safe-to-log fields a Stripe/commercetools error may carry — read from the error, then from `.raw`.
// `httpErrorStatus` is where connect-payments-sdk's `Errorx` keeps the HTTP status (it has no
// `statusCode`); without it the redacted log drops the status for non-Stripe errors.
// The Errorx server-side diagnostics `privateMessage` / `privateFields` are deliberately NOT whitelisted:
// the helper is scoped to type/message/code/statusCode/requestId/decline_code and keeps private
// Errorx fields out of the logs. (They carry commercetools/auth diagnostics, not secrets, but the ticket's
// scope excludes them; logging a specific field is a separate, scoped decision.)
const SAFE_ERROR_FIELDS = [
  'code',
  'statusCode',
  'httpErrorStatus',
  'type',
  'requestId',
  'decline_code',
  'param',
  'doc_url',
] as const;

// Surface an Error's whitelisted fields (name/message + SAFE_ERROR_FIELDS, each read from the error
// then from `.raw`) and, recursively, a wrapped provider error under `.cause`. Guards cyclic cause
// chains (A.cause=B, B.cause=A) via `seen` so an error-handler logging path cannot overflow the stack.
// Module-level (not nested in redactError) so its control structures carry no extra nesting penalty.
const redactErrorObject = (
  err: Error & { raw?: unknown; cause?: unknown },
  seen: WeakSet<object>,
): Record<string, unknown> => {
  const raw = (err.raw && typeof err.raw === 'object' ? (err.raw as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
  const self = err as unknown as Record<string, unknown>;

  const safe: Record<string, unknown> = { name: err.name, message: err.message };
  for (const key of SAFE_ERROR_FIELDS) {
    const value = self[key] !== undefined ? self[key] : raw[key];
    if (value !== undefined) {
      safe[key] = value;
    }
  }

  if (err.cause instanceof Error && !seen.has(err.cause)) {
    seen.add(err.cause);
    safe.cause = redactErrorValue(err.cause, seen);
  }
  return safe;
};

const redactErrorValue = (input: unknown, seen: WeakSet<object>): Record<string, unknown> => {
  if (input instanceof Error) {
    return redactErrorObject(input as Error & { raw?: unknown; cause?: unknown }, seen);
  }
  return { message: typeof input === 'string' ? input : 'Non-Error thrown value' };
};

export const redactError = (error: unknown): Record<string, unknown> => {
  const seen = new WeakSet<object>();
  if (error instanceof Error) {
    seen.add(error);
  }
  return redactErrorValue(error, seen);
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
