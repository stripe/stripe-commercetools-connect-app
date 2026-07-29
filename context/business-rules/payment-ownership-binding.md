# Business Rule: Payment Ownership Binding

Any endpoint that accepts a caller-supplied payment or PaymentIntent reference must verify that
reference belongs to the caller's own cart before writing a transaction to it. Without this check,
a caller with a valid storefront session can stamp success transactions onto another customer's
CT payment (CWE-639 — broken object-level authorization / IDOR).

This pattern exists independently in two places in the codebase. It is documented here as a single
rule so a third call site (e.g. a future refund-initiation or confirmation endpoint) applies the
same binding instead of re-discovering the need for it.

---

## Rule 1: Ownership binding is required before any transaction write from a caller-supplied reference

**What:** Before using a caller-supplied `paymentReference`/`paymentIntentId` to write an
`Authorization`/`Charge` transaction, verify it is actually attached to the caller's own cart or
CT payment record — not just that it resolves to *some* valid CT payment.

**Why:** CT payment IDs and Stripe PaymentIntent IDs are not secrets and are not scoped to a
session server-side by default. A valid storefront session only proves the caller has *a* cart —
it does not prove the `paymentReference` they submit is theirs. Reported via bug bounty against
`POST /subscription/confirm` (CWE-639); the sibling PaymentIntent-confirm path had already closed
the same gap independently.

**Invariant:** Every write path that accepts a caller-supplied payment reference rejects (fails
closed, no transaction write, no downstream call) when that reference cannot be tied to the
caller's own cart/payment.

**Implementation:**
- `processor/src/services/stripe-payment.service.ts:521-526` — `updatePaymentIntentStripeSuccessful()`
  rejects when `ctPayment.interfaceId !== paymentIntentId`.
- `processor/src/services/stripe-subscription.service.ts:709-710` — `confirmSubscriptionPayment()`
  rejects unless `paymentReference` is a member of `cart.paymentInfo.payments[].id` (matched by
  `.id`, present even on the unexpanded cart).

**What breaks if violated:** Any customer who knows or guesses another customer's CT payment ID
(or PaymentIntent ID) can mark that payment as paid, triggering downstream fulfilment/reconciliation
on an order that was never actually charged to them.

---

## Rule 2: Mode-aware `interfaceId` matching is defense-in-depth, not a substitute for Rule 1

**What:** In subscription confirmation, after the Rule 1 cart-ownership check, also verify the CT
payment's `interfaceId` matches one of the server-derived references for the subscription being
confirmed (`[paymentIntentId, subscriptionId]` with no invoice; `[paymentIntentId, invoice.id,
subscriptionId]` otherwise). Use membership, not single-value equality — setup-intent/trial/
no-invoice modes carry `in_`/`sub_` prefixes in `interfaceId`, not `pi_`.

**Why:** Rule 1 proves the payment belongs to the caller's cart; Rule 2 proves it's the specific
payment for *this* subscription confirmation, in case a cart ever legitimately carries more than
one payment reference. Single-value equality (as used in Rule 1's sibling) would false-reject the
non-`pi_` modes, which is why this needs its own mode-aware check rather than reusing Rule 1's
implementation directly.

**Invariant:** Never treat interfaceId matching as sufficient on its own to authorize a
transaction write — it runs after, not instead of, the Rule 1 cart-ownership check.

**Implementation:** `processor/src/services/stripe-subscription.service.ts:763` —
`assertPaymentInterfaceMatches()`.

**What breaks if violated:** Removing Rule 1 while keeping only Rule 2 would still leave an IDOR
open in modes where `interfaceId` values are guessable/enumerable from the caller's own successful
checkouts.
