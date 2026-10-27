# Business Rule: Payment Ownership Binding

Any endpoint that accepts a caller-supplied payment or PaymentIntent reference must verify that
reference belongs to the caller's own cart before writing a transaction to it.

---

## Ownership binding is required before any transaction write from a caller-supplied reference

**What:** Before using a caller-supplied `paymentReference`/`paymentIntentId` to write an
`Authorization`/`Charge` transaction, verify it is actually attached to the caller's own cart or
CT payment record — not just that it resolves to *some* valid CT payment.

**Invariant:** In subscription confirmation, a caller-supplied `paymentReference` is rejected
(fails closed, no transaction write, no downstream call) when it cannot be tied to the caller's
own cart.

**Implementation:**
- `processor/src/services/stripe-subscription.service.ts:1012-1019` — `confirmSubscriptionPayment()`
  rejects unless `paymentReference` is a member of `cart.paymentInfo.payments[].id` (matched by
  `.id`, present even on the unexpanded cart).
