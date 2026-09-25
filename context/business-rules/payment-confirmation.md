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

**What:** The gate validates the PI `amount`/`currency` against the cart's **current** total — `expectedCentAmount = (ctCart.taxedPrice?.totalGross ?? ctCart.totalPrice).centAmount`, currency compared case-insensitively — and rejects on mismatch. It does **not** compare against `ctPayment.amountPlanned`, which is a snapshot taken at PaymentIntent creation and can go stale if the cart is edited; `amountPlanned` is used only as the amount written on the resulting CT transaction.
**Why:** The cart can be edited between PaymentIntent creation and confirmation, so `amountPlanned` may no longer match what the buyer is checking out. Validating against the live cart total is what prevents recording a charge that diverges from the current cart (the KI-047 fix). Rule 5 applies the same live-total comparison on the async webhook path.
**Invariant:** A CT transaction is written only when `PI.amount === (taxedPrice?.totalGross ?? totalPrice).centAmount` and the currencies match.
**Implementation:** `processor/src/services/stripe-payment.service.ts` — `updatePaymentIntentStripeSuccessful` (~lines 994-997: `currentCartTotal` / `expectedCentAmount` comparison before `updatePayment`).
**Closure criterion:** grep the method for `currentCartTotal` / `expectedCentAmount` and the `stripeAmount !== expectedCentAmount || stripeCurrency !== expectedCurrency` guard preceding the write.
**What breaks if violated:** CT records a transaction whose amount diverges from the buyer's current cart total (over/undercharge relative to the live cart).

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
**What breaks if violated:** a CT transaction written on unverified status. Operational trade-off (buyer sees an error while the webhook may still create the order) documented in `known-issues.md` KI-034.

---

## Rule 5: The async order-creation webhook re-validates amount before creating the order

**What:** `handlePaymentIntentSucceededFlow` (the `payment_intent.succeeded` webhook path) must not create the CT order unless the paid amount matches the cart's **current** total: `PI.amount === (taxedPrice?.totalGross ?? totalPrice).centAmount`, `PI.amount_received === PI.amount`, and currencies match (case-insensitive). It also skips cleanly when the cart is already `Ordered` (idempotency).
**Why:** Rule 2 enforces provider-is-source-of-truth synchronously, but async rails (ACH micro-deposits, boleto, OXXO, …) confirm to `requires_action` and never reach that gate; their PaymentIntent is created at one amount and settles days later, during which the cart can be edited. Without this backstop an order is created for the current (larger) total while only the original amount was paid (KI-050).
**Invariant:** No CT order is created on `payment_intent.succeeded` when `PI.amount`/`amount_received`/currency diverge from the current cart total.
**Implementation:** `processor/src/services/stripe-payment.service.ts` — `handlePaymentIntentSucceededFlow` (amount/currency guard + `cartState === 'Ordered'` guard before `createOrder`). See ADR-016.
**Closure criterion:** the method returns (logging `error`, no `createOrder`) when amount/currency mismatch, and returns (logging `info`) when the cart is already `Ordered`.
**What breaks if violated:** an order is fulfilled for more than was collected (over-order / underpayment). On a blocked order the `Charge/Success` is already recorded, so the outcome is a paid-without-order state surfaced for manual reconciliation — never auto-corrected (hub rule).

**Rule 5 validates a snapshot that is then mutated.** Between that check and the order POST the flow calls `charges.retrieve` and `updateCartAddress`, and the latter writes the shopper-controlled address from the charge onto the cart — in Platform tax mode commercetools then recomputes `taxedPrice` for the new destination. The order is minted from *that* cart, which Rule 5 never saw. Rule 5b closes it.

---

## Rule 5b: A cart whose total moves when the address is written does not mint an order

**What:** After `updateCartAddress`, compare the cart's orderable total — `taxedPrice?.totalGross ?? totalPrice`, the same base Rule 5 uses — against what it was before. If it moved, no order is created. The cart version is pinned on **every** path, and a `ConcurrentModification` is resolved by re-reading and re-deciding rather than by declining to pin.

**Why the trigger is the total and not the address:** `updateCartAddress` bumps the cart version up to three times without the destination moving (unfreeze, `setShippingAddress`, refreeze), so a version-bump proxy drags carts where nothing changed into a re-check. What the rule defends is a total that moved because the shopper chose the destination.

**Why no amount is re-compared once it moved:** Rule 5 has already established that the payment equals the total *before* the write. Once the total moves, the payment cannot equal the one after. The move is the whole test.

**Why the pin is unconditional:** the window protects more than destination tax. Between the cart read and the order POST any writer can add a line item, a discount or a shipping method. Pinning only where the address changed left that open on the path most card checkouts take. Unconditional pinning is safe **only** with the 409 retry — without it the `/confirmPayments` freeze that races this webhook 409s a fully paid order away, which is the regression that made the pin conditional in the first place. The two are one change and must not be reverted separately.

**Never re-derive this from `taxMode`.** An earlier revision hard-failed any `Platform` cart with no computed `taxedPrice`. That shape is supported everywhere else — the SDK prices the PaymentIntent from the same `totalPrice` fallback and Rule 5 accepts it — so the rule refused orders validated as exactly matching seconds earlier, and `Platform` is commercetools' default. Under-collected tax on a never-taxed cart is KI-056, and refusing paid orders does not answer it.

**Invariant:** No CT order is created on `payment_intent.succeeded` when the orderable total after `updateCartAddress` differs from the one before it; and no order is ever created from a cart version other than the one validated.

**Implementation:** `stripe-payment.service.ts` — `orderableCartTotal`, the `totalChanged` block in `handlePaymentIntentSucceededFlow`, and `createOrderPinned`. See `decisions/adr-019-post-address-guard-and-unconditional-version-pin.md`.

**Closure criterion:** a cart whose `taxedPrice.totalGross` rises across `updateCartAddress` produces `log.error('… post-address underpayment guard …')` and no `createOrder`; a cart whose total is unchanged is created **with** `expectedVersion` set.

**What breaks if violated:** an order `Paid` for a destination-inflated total against the amount collected for the original one — or, if the correction is over-tightened instead, paid orders dropped on cart shapes the pipeline supports.

---

## Rule 6: The subscription order-creation webhook re-validates the collected amount before creating the order

**What:** `createSubscriptionOrderFromCart` (reached from `invoice.paid` and from `charge.succeeded` on a pending charge) must not create the CT order when `invoice.amount_paid` / `invoice.currency` diverge from the total of the cart the order is minted from — the cart **after** `updateCartAddress`, since the shipping address is shopper-controlled. When it validates, it pins that cart version via `expectedVersion` so a cart that moved after validation cannot still mint an order. It continues to skip cleanly when the cart is already `Ordered` (idempotency).

The comparison is against **`cart.totalPrice`**, not `taxedPrice?.totalGross ?? totalPrice` as in Rules 2 and 5. This is a deliberate divergence, not an inconsistency: the subscription invoice is assembled from Stripe Prices built off the line items' own price values plus the shipping price, and the connector sets neither `automatic_tax` nor a Stripe Tax calculation on the subscription path, so the invoice carries no tax. `totalPrice` is the figure the invoice is actually built from, in both the tax-included and the tax-on-top configuration. (That tax never reaches a subscription invoice at all is a separate pre-existing defect — KI-056 — which this rule neither masks nor worsens.)

**Hard block, scoped:** the order is refused only in the configuration where the first invoice *must* equal the cart total — `billing_reason: 'subscription_create'`, `collection_method: 'charge_automatically'`, no trial (`subscription.trial_end` absent), `amount_paid > 0`, and an invoice carrying no discounts (`invoice.discounts` / `invoice.total_discount_amounts` both empty). Outside that configuration the divergence is logged for reconciliation and the order **is** created: trial, free anchor days, `send_invoice` and recurring cycles legitimately produce a first invoice that differs from the cart total, and the coupon translation is not yet proven equal on both sides.

**Every condition of this guard is read from Stripe-owned data — the invoice and the subscription — and never from the cart.** This is load-bearing, not stylistic: the cart is what the attack mutates, so any condition read from it can be flipped by the attacker in the same call that enlarges the cart, switching the guard off. The discount exemption was written against `cart.discountCodes` first and reproduced the vulnerability in full; see KI-054. A new condition added to this guard must be immutable by the shopper, or it does not belong here.

**Why:** Rule 5 enforces this on the one-time path, but it can never run for subscriptions: the webhook dispatcher deliberately drops subscription-invoice `payment_intent.succeeded` and `charge.*` events because `invoice.paid` is the single source of truth for subscription money. Meanwhile `/shipping-methods/remove` unfreezes the cart and never re-freezes it, so between subscription creation and `invoice.paid` the cart can be enlarged while the invoice stays locked at its original amount — an order `Paid` at €70.00 against €20.00 collected (KI-054). Rules 5 and 6 are two applications of one invariant, and the correct fix for a gap in either is to extend the shared check, never to add a third copy of it.

**Invariant:** No CT order is created from a subscription invoice when, in the guarded configuration, `invoice.amount_paid !== cart.totalPrice.centAmount` or the currencies differ.

**Implementation:** `processor/src/services/stripe-subscription.service.ts` — `createSubscriptionOrderFromCart` (amount guard + `expectedVersion` pin) and `isFirstCycleAmountGuardApplicable` (scope). The comparison itself is `paidAmountMatchesTotal` in `processor/src/utils.ts`, shared with Rule 5's `paidAmountMatchesCart`. See ADR-017.

**Closure criterion:** `createSubscriptionOrderFromCart` returns `false` (logging `error`, no `createOrder`) on a mismatch in the guarded configuration; and every order-creation guard's comparison of a collected amount against a cart total routes through the single `paidAmountMatchesTotal` — `grep -rn "paidAmountMatchesTotal" processor/src` shows one definition (`utils.ts`) and call sites in both services, while `grep -rn "totalPrice.centAmount ===\|totalGross.centAmount ===" processor/src` returns nothing. The `/confirmPayments` gate (Rule 2) keeps its own comparison on purpose: it creates no order, and it tolerates a missing currency by comparing against `''`, which the shared helper does not. (The surviving `paymentIntent.amount_received === paymentIntent.amount` in `handlePaymentIntentSucceededFlow` is a settlement-completeness check, not a cart comparison, and is intentionally separate.)

**What breaks if violated:** a subscription order is fulfilled for more than was collected, by an authenticated shopper against their own cart, with no privileged credentials. As in Rule 5, a blocked order leaves the `Charge/Success` already persisted — a paid-without-order state for manual reconciliation, never auto-corrected. The `paymentState: Failed` call site is exempt by design: it records a collection that did not happen, so there is no collected amount to validate.

---

> **Every path that can create an order is enumerated in a test, not just in these rules.**
> `processor/test/architecture/order-creation-choke-points.spec.ts` holds a registry of each call site
> that reaches `createOrderFromCart`, with what protects it — including the recurring-cycle path, whose
> exemption is ADR-017 point 4. A new path fails the build until it is declared; a declared one that
> disappears fails too. It cannot check that a guard is *correct*, only that nobody added a path without
> answering the question — which is precisely the failure that produced Rules 6 and 7.

## Rule 7: The cart an order is minted from must be the cart the subscription was priced from

**What:** At `subscriptions.create`, the cart's `totalPrice` and currency are sealed onto the Stripe Subscription's metadata (`ct_cart_total_amount`, `ct_cart_total_currency`). At `invoice.paid`, before any other work, the cart is compared against that seal. If it no longer matches, no order is created.

**Unlike Rule 6, this has no exemptions.** Rule 6's exemptions exist because a first invoice may legitimately differ from the cart *total* — that is a statement about arithmetic, and trials, free anchor days, `send_invoice` and coupons all make it true. Drift is a statement about *identity*: whether this is still the same cart. No billing shape makes an enlarged cart legitimate, so none of Rule 6's exemptions apply here.

**Why:** Rule 6 requires every condition to be immutable by the shopper, and four of its five were. The fifth — "the invoice carries no discounts" — is immutable *after* the subscription is created but its value is *chosen before*: a shopper decides whether to apply a discount code, and doing so switched the hard block off for the life of that subscription. The KI-054 chain then ran unimpeded. The two properties are not the same, and the distinction is the whole lesson: a guard condition must be one the attacker cannot select, not merely one they cannot later edit.

**Why not simply drop the discount exemption instead:** on a coupon-bearing invoice, comparing collected money against the cart total depends on the CT-discount → Stripe-coupon translation being exact, and that is unverified (KI-055). Widening an arithmetic check that cannot be trusted there would reject honest orders — the KI-047 failure mode. This rule needs no Stripe arithmetic at all: a translation gap cannot make it fire, and enlarging the cart cannot stop it firing.

**Evaluated on the cart as read at webhook time, before `updateCartAddress`.** The seal predates any address, so this compares like with like. Running it afterwards would fold in a shipping rate that legitimately changed once the destination became known, and reject an honest order. Blocking first also means a detected attack never writes to commercetools. Rule 6 still validates the post-address snapshot, because that is the one the order is minted from.

**Invariant:** For any subscription carrying a seal, no CT order is created at `invoice.paid` unless `cart.totalPrice` equals the sealed amount and currency.

**Subscriptions created before this shipped carry no seal and fall back to Rules 6's behaviour** — they are not blocked wholesale on their next invoice. That fallback is the rule's one soft edge and it closes as the pre-existing population churns.

**Implementation:** `stripe-subscription.service.ts` — `sealCartTotal` (write, both `subscriptions.create` call sites), `cartDriftedFromPricedTotal` (read), and the block in `createSubscriptionOrderFromCart`.

**Closure criterion:** with a sealed subscription, a cart whose `totalPrice` differs from the seal produces `log.error('… cart drift guard …')` and no `createOrder` call — regardless of discounts, trial, or billing reason.

**What breaks if violated:** the KI-054 outcome, reached by applying any valid discount code first: an order `Paid` at the enlarged cart total against the small amount actually collected.
