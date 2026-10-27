# Payment Confirmation (one-time synchronous gate)

Invariants enforced by the one-time synchronous confirmation endpoint (`POST /confirmPayments/:id` → `updatePaymentIntentStripeSuccessful`) when it writes a payment result to commercetools. Subscription/setup confirmation is a separate path (`confirmSubscriptionPayment`) and is not covered here.

## Rule 1: The real PaymentIntent status governs the CT transaction

**What:** The gate must retrieve the PaymentIntent from Stripe and only write a CT transaction when its status is in `['succeeded', 'requires_capture', 'processing']`. A `processing` PI writes `Authorization/Pending` (never `Success`); `succeeded`/`requires_capture` write `Authorization/Success`.
**Invariant:** A CT `Authorization/Success` is never written for a PaymentIntent whose real status is `processing`.
**Implementation:** `processor/src/services/stripe-payment.service.ts` — `updatePaymentIntentStripeSuccessful`.

---

## Rule 2: The provider is the source of truth for amount and currency

**What:** The gate validates the PI `amount`/`currency` against the cart's **current** total — `expectedCentAmount = (ctCart.taxedPrice?.totalGross ?? ctCart.totalPrice).centAmount`, currency compared case-insensitively — and rejects on mismatch. It does **not** compare against `ctPayment.amountPlanned`; `amountPlanned` is used only as the amount written on the resulting CT transaction. Rule 5 applies the same live-total comparison on the async webhook path.
**Invariant:** A CT transaction is written only when `PI.amount === (taxedPrice?.totalGross ?? totalPrice).centAmount` and the currencies match.
**Implementation:** `processor/src/services/stripe-payment.service.ts` — `updatePaymentIntentStripeSuccessful` (lines 1021-1034: `currentCartTotal` / `expectedCentAmount` comparison before `updatePayment`).

---

## Rule 3: Identity binding via `interfaceId`

**What:** The gate rejects unless `ctPayment.interfaceId === paymentIntentId`.
**Invariant:** A CT payment is only updated with a PaymentIntent it was created for.
**Implementation:** `processor/src/services/stripe-payment.service.ts` — `updatePaymentIntentStripeSuccessful` (interfaceId check, before `retrieve()`).

---

## Rule 4: Fail-closed on `retrieve()` failure

**What:** If `stripeApi().paymentIntents.retrieve()` fails or times out, the gate throws; the route responds `400 REJECTED`. No CT transaction is written.
**Invariant:** No CT write occurs when the PaymentIntent status could not be retrieved.
**Implementation:** `processor/src/services/stripe-payment.service.ts` — the `retrieve()` try/catch rethrows.

---

## Rule 5: The async order-creation webhook re-validates amount before creating the order

**What:** `handlePaymentIntentSucceededFlow` (the `payment_intent.succeeded` webhook path) must not create the CT order unless the paid amount matches the cart's **current** total: `PI.amount === (taxedPrice?.totalGross ?? totalPrice).centAmount`, `PI.amount_received === PI.amount`, and currencies match (case-insensitive). It also skips cleanly when the cart is already `Ordered` (idempotency).
**Invariant:** No CT order is created on `payment_intent.succeeded` when `PI.amount`/`amount_received`/currency diverge from the current cart total.
**Implementation:** `processor/src/services/stripe-payment.service.ts` — `handlePaymentIntentSucceededFlow` (amount/currency guard + `cartState === 'Ordered'` guard before `createOrder`).

---

## Rule 5b: A cart whose total moves when the address is written does not mint an order

**What:** After `updateCartAddress`, compare the cart's orderable total — `taxedPrice?.totalGross ?? totalPrice`, the same base Rule 5 uses — against what it was before. If it moved, no order is created. The cart version is pinned on **every** path, and a `ConcurrentModification` is resolved by re-reading and re-deciding rather than by declining to pin.

**Invariant:** No CT order is created on `payment_intent.succeeded` when the orderable total after `updateCartAddress` differs from the one before it; and no order is ever created from a cart version other than the one validated.

**Implementation:** `stripe-payment.service.ts` — `orderableCartTotal`, the `totalChanged` block in `handlePaymentIntentSucceededFlow`, and `createOrderPinned`.

---

> **Every path that can create an order is enumerated in a test.**
> `processor/test/architecture/order-creation-choke-points.spec.ts` holds a registry of each call site
> that reaches `createOrderFromCart`, with what protects it, including the recurring-cycle path. A new
> path fails the build until it is declared; a declared one that disappears fails too.

## Rule 6: The subscription order-creation webhook re-validates the collected amount before creating the order

**What:** `createSubscriptionOrderFromCart` (reached from `invoice.paid` and from `charge.succeeded` on a pending charge) must not create the CT order when `invoice.amount_paid` / `invoice.currency` diverge from the total of the cart the order is minted from — the cart **after** `updateCartAddress`, since the shipping address is shopper-controlled. When it validates, it pins that cart version via `expectedVersion` so a cart that moved after validation cannot still mint an order. It continues to skip cleanly when the cart is already `Ordered` (idempotency).

The comparison is against **`cart.totalPrice`**, not `taxedPrice?.totalGross ?? totalPrice` as in Rules 2 and 5. This is a deliberate divergence, not an inconsistency: the subscription invoice is assembled from Stripe Prices built off the line items' own price values plus the shipping price. `totalPrice` is the figure the invoice is actually built from, in both the tax-included and the tax-on-top configuration.

**Hard block, scoped:** the order is refused only in the configuration where the first invoice *must* equal the cart total — `billing_reason: 'subscription_create'`, `collection_method: 'charge_automatically'`, no trial (`subscription.trial_end` absent), `amount_paid > 0`, and an invoice carrying no discounts (`invoice.discounts` / `invoice.total_discount_amounts` both empty). Outside that configuration the divergence is logged for reconciliation and the order **is** created: trial, free anchor days, `send_invoice` and recurring cycles legitimately produce a first invoice that differs from the cart total.

Every condition of this guard is read from Stripe-owned data — the invoice and the subscription — and never from the cart.

Rule 5 enforces this on the one-time path, but it can never run for subscriptions: the webhook dispatcher deliberately drops subscription-invoice `payment_intent.succeeded` and `charge.*` events because `invoice.paid` is the single source of truth for subscription money.

**Invariant:** No CT order is created from a subscription invoice when, in the guarded configuration, `invoice.amount_paid !== cart.totalPrice.centAmount` or the currencies differ.

**Implementation:** `processor/src/services/stripe-subscription.service.ts` — `createSubscriptionOrderFromCart` (amount guard + `expectedVersion` pin) and `isFirstCycleAmountGuardApplicable` (scope). The comparison itself is `paidAmountMatchesTotal` in `processor/src/utils.ts`, shared with Rule 5's `paidAmountMatchesCart`.

---

## Rule 7: The cart an order is minted from must be the cart the subscription was priced from

**What:** At `subscriptions.create`, the cart's `totalPrice` and currency are sealed onto the Stripe Subscription's metadata (`ct_cart_total_amount`, `ct_cart_total_currency`). At `invoice.paid`, the cart is compared against that seal inside `createSubscriptionOrderFromCart`, before the cart-address write and before the order (`stripe-subscription.service.ts:1845`, ahead of `updateCartAddress` at `:1870`) — but after `processSubscriptionEventPaid` has already written the invoice's payment transactions to the CT payment (`stripe-subscription.service.ts:1582-1595`, then the call at `:1598`). If it no longer matches, no order is created.

**Unlike Rule 6, this has no exemptions.**

**Evaluated on the cart as read at webhook time, before `updateCartAddress`.** The seal predates any address, so this compares like with like. Rule 6 still validates the post-address snapshot, because that is the one the order is minted from.

**Invariant:** For any subscription carrying a seal, no CT order is created at `invoice.paid` unless `cart.totalPrice` equals the sealed amount and currency.

**Implementation:** `stripe-subscription.service.ts` — `sealCartTotal` (write, both `subscriptions.create` call sites), `cartDriftedFromPricedTotal` (read), and the block in `createSubscriptionOrderFromCart`.
