# Payment Confirmation (one-time synchronous gate)

Invariants enforced by the one-time synchronous confirmation endpoint (`POST /confirmPayments/:id` → `updatePaymentIntentStripeSuccessful`) when it writes a payment result to commercetools. Subscription/setup confirmation is a separate path (`confirmSubscriptionPayment`) and is not covered here.

## Rule 1: The real PaymentIntent status governs the CT transaction

**What:** The gate must retrieve the PaymentIntent from Stripe and only write a CT transaction when its status is in `['succeeded', 'requires_capture', 'processing']`. A `processing` PI writes `Authorization/Pending` (never `Success`); `succeeded`/`requires_capture` write `Authorization/Success`.
**Why:** Writing `Success` before Stripe confirms settlement marks async-settlement payments (crypto/stablecoin, deferred bank debits) paid prematurely and shows the buyer a false success.
**Invariant:** A CT `Authorization/Success` is never written for a PaymentIntent whose real status is `processing`.
**Implementation:** `processor/src/services/stripe-payment.service.ts` — `updatePaymentIntentStripeSuccessful`.
**Closure criterion:** the method calls `stripeApi().paymentIntents.retrieve(...)` and checks the status allowlist before any `ctPaymentService.updatePayment(...)`.
**What breaks if violated:** premature success; inconsistent transaction history (a `Success` later overwritten by the `payment_intent.processing` webhook's `Pending`).

---

## Rule 2: The provider is the source of truth for amount and currency

**What:** The gate validates the PI `amount`/`currency` against `ctPayment.amountPlanned` (integer cents; currency compared case-insensitively) and rejects on mismatch.
**Why:** The financial provider is the source of truth for amounts (hub global rule). A charge whose amount/currency diverges from the planned amount must not be recorded as-planned.
**Invariant:** A CT transaction is written only when `PI.amount === amountPlanned.centAmount` and the currencies match.
**Implementation:** `processor/src/services/stripe-payment.service.ts` — `updatePaymentIntentStripeSuccessful` (amount/currency comparison before `updatePayment`).
**Closure criterion:** grep the method for the `amount`/`currency` comparison against `amountPlanned` preceding the write.
**What breaks if violated:** CT records a transaction amount that diverges from what Stripe actually charged.

---

## Rule 3: Identity binding via `interfaceId`

**What:** The gate rejects unless `ctPayment.interfaceId === paymentIntentId`.
**Why:** Prevents applying a PaymentIntent to the wrong CT payment. `interfaceId` is server-persisted at payment creation, so it is a sufficient identity check without depending on the second Stripe metadata update.
**Invariant:** A CT payment is only updated with a PaymentIntent it was created for.
**Implementation:** `processor/src/services/stripe-payment.service.ts` — `updatePaymentIntentStripeSuccessful` (interfaceId check, before `retrieve()`).
**Closure criterion:** the method throws a "PaymentIntent mismatch" error when `interfaceId !== paymentIntentId`.
**What breaks if violated:** a PaymentIntent could be applied to the wrong CT payment. Rationale for choosing `interfaceId` over `metadata.ct_payment_id`: see `decisions/adr-009-sync-confirmation-identity-binding.md`.

---

## Rule 4: Fail-closed on `retrieve()` failure

**What:** If `stripeApi().paymentIntents.retrieve()` fails or times out, the gate throws; the route responds `400 REJECTED`. No CT transaction is written.
**Why:** Without the real PI status the gate cannot safely decide the outcome; failing closed avoids writing a result based on unverified state. Mirrors the checkout connector (decision D1).
**Invariant:** No CT write occurs when the PaymentIntent status could not be retrieved.
**Implementation:** `processor/src/services/stripe-payment.service.ts` — the `retrieve()` try/catch rethrows.
**Closure criterion:** the `catch` around `retrieve()` throws rather than proceeding to `updatePayment`.
**What breaks if violated:** a CT transaction written on unverified status. Operational trade-off (buyer sees an error while the webhook may still create the order) documented in `known-issues.md` KI-023.
