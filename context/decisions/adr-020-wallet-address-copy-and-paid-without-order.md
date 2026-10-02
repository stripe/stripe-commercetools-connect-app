# ADR-020: Wallet-address copy is guarded and non-destructive, and a failed succeeded-path order surfaces to Stripe

**Status:** Accepted (amended 2026-10-02 — see Update)
**Date:** 2026-09-30

## Update (2026-10-02)

The `STRIPE_SKIP_WALLET_ADDRESS_COPY` env var from decision point 2 was **removed** before release as
unnecessary configuration surface. The safer-default skip (cart already has a complete shipping address)
resolves the destructive-overwrite defect on its own, while the mapping fix (decision point 1) removes the
invalid-`key` 400 trigger and the best-effort copy with classified order-creation failures (decision
point 3) is the actual guard that prevents the paid-without-order crash. The flag only governed the narrow
case of a cart that reaches the succeeded webhook *without* a
complete address while still wanting the wallet address ignored — a topology no adopter requested, and one
where enabling it could *re-introduce* an incomplete-address/tax problem. The decision text below is kept
for the record; the shipped behaviour is decision point 1, decision point 2 **(safer-default skip only)**,
and decision point 3.

## Context

On `payment_intent.succeeded`, `handlePaymentIntentSucceededFlow` calls `updateCartAddress`, which
copies the Stripe charge address onto the commercetools cart via `setShippingAddress`. The intent is to
capture an address a shopper supplied through a wallet (Apple Pay / Google Pay) or billing form when the
cart had none. As written (SB3-227) it had three defects:

1. **Corrupt mapping.** It wrote `addressSource.name` (the wallet's full display name) into the CT
   address `key` — an identifier field constrained to `^[A-Za-z0-9_-]+$` — and never set `firstName`,
   `lastName` or `email`. The resulting address was both invalid-key-prone and missing the shopper's
   name. Stripe `line2` (apartment/suite) was also written to CT `streetNumber`, which is semantically
   wrong.
2. **Destructive overwrite.** The copy ran whenever the *charge* carried a complete address
   (`country/state/city/postalCode/line1`), regardless of what the cart already held. For wallet flows
   the merchant's checkout address was already validated on the cart; the copy overwrote it, and the
   unnormalized wallet `state` could trigger `MissingTaxRateForCountry` in Platform tax mode.
3. **Silent paid-without-order.** `payment_intent.succeeded` is not in `ASYNC_PENDING_EVENTS`, so the
   `processStripeEvent` catch logs and returns HTTP 200. A throw from `updateCartAddress` or order
   creation was therefore swallowed: money captured, no order, no Stripe retry.

## Decision

Three scoped changes, all in `processor/src/services/stripe-payment.service.ts`:

1. **Map correctly.** Split the wallet name into `firstName` (first whitespace token) / `lastName`
   (remainder); stop writing `key`; carry the cart's existing `email`; map Stripe `line2` to CT
   `additionalStreetInfo` (not `streetNumber` — `line1` already carries the street number and Stripe
   does not expose it separately).
2. **Never clobber a validated address.** Skip the copy when the cart already has a complete shipping
   address (safer default) — the merchant's validated checkout address is authoritative for wallet flows.
   *(The originally-added `STRIPE_SKIP_WALLET_ADDRESS_COPY` opt-out flag was removed before release — see
   Update above.)*
3. **Surface genuine failures without poison-retrying** — reconciled with **ADR-015** (re-throw only
   transient/retryable CT errors; permanent errors must not redeliver for days). Two distinct cases on
   the succeeded path:
   - **Address copy is best-effort / non-fatal.** The charge-address copy enriches an already-captured
     payment; it is never allowed to lose the order. A failure (charge retrieve error, or a terminal CT
     400 such as `MissingTaxRateForCountry` / `InvalidField` on an unnormalized wallet address) is
     logged (redacted — no raw CT body, which echoes address PII) and the flow falls back to the
     original, un-mutated checkout cart (already tax-valid) and creates the order from it. This is the
     core poison-pill fix: a terminal wallet-address 400 can no longer re-throw and retry for three days
     (which can disable the shared Stripe webhook endpoint).
   - **Order creation is classified, not unconditionally re-thrown.** Only a **transient/retryable**
     failure (ADR-015's shared `RETRYABLE_CT_ERROR` regex —
     `ConcurrentModification|409|429|502|503|ETIMEDOUT|ECONNRESET`, reused from `utils.ts`) raises the
     dedicated `PaidWithoutOrderError` that `processStripeEvent` re-throws (non-2xx → Stripe redelivers).
     A **terminal/deterministic** failure is logged as a visible paid-without-order and `return`s (no
     retry), matching the `return` precedent of the underpayment/version-pin guards. The error type is
     distinct so the generic succeeded-path catch is not widened and the async settlement events keep
     their existing re-throw rule. The intentional "order NOT created" underpayment/version-pin guards
     still `return`, as they are business no-ops, not failures.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Broaden the global `processStripeEvent` catch to re-throw for all `payment_intent.succeeded` errors | Would also re-throw unrelated succeeded-path errors (e.g. idempotent redelivery noise), risking retry storms. The dedicated error type is surgically scoped to the paid-without-order failure. |
| Normalize the wallet `state` to a CT-valid tax region in code | Guessing tax-region mapping is risky and out of scope. The safer-default (skip when the cart is already complete) removes the main tax-break trigger for wallet flows; state normalization is deferred and documented. |
| Always overwrite with the charge address (status quo, fixed mapping only) | Still discards the merchant's validated checkout address for wallets; the destructive-overwrite defect (2) would remain. |

## Consequences

**Positive:** Wallet addresses are mapped to valid CT fields; the merchant's validated address is
preserved by default; a captured payment can no longer be silently orphaned without an order.

**Negative:** A genuine *transient* CT outage on order creation now returns non-2xx and Stripe retries
for up to three days — intended, but it means the webhook is no longer unconditionally 200 on this path.
A *terminal* failure is still logged-and-returned (200), so it must be caught by the paid-without-order
log + reconciliation, not by Stripe redelivery — this is the deliberate ADR-015 trade-off (no poison
retry on permanent errors).

**Risks:** Tax correctness for a wallet `state` on a cart with no prior address is unchanged and still
depends on the project's tax-category configuration.
