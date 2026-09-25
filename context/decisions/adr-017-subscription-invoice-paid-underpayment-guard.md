# ADR-017: Underpayment guard on the subscription `invoice.paid` order-creation path

**Status:** Accepted
**Date:** 2026-09-17

## Context

An external bug bounty reported, and we reproduced live, that an authenticated shopper could receive a commercetools order marked `Paid` for €70.00 while Stripe had collected €20.00 — using only their own cart and no privileged credentials (KI-054).

The chain: `POST /subscription` prices the first invoice once and freezes the cart as the only control; `GET /shipping-methods/remove` unfreezes it and by design never re-freezes; `invoice.paid` then minted the order from the re-read, enlarged cart. Nothing compared what Stripe collected against the cart total.

The comparison already existed. `handlePaymentIntentSucceededFlow` has enforced it since ADR-016 (`business-rules/payment-confirmation.md` Rule 5). But the webhook dispatcher deliberately drops subscription-invoice `payment_intent.succeeded` and `charge.*` events, because `invoice.paid` is the single source of truth for subscription money — and it should, routing them would duplicate payments and orders. **The guard was structurally unreachable from the subscription path.** This is the same defect closed on one branch of a handler and left open on the other, which is what made a second, parallel implementation the wrong answer.

Three constraints shaped the decision:

1. **The false-positive precedent is as expensive as the vulnerability.** KI-047's first attempt used `ctCartService.getPaymentAmount` and rejected honest orders in production. A guard that over-rejects is not a safer guard.
2. **A first subscription invoice legitimately differs from the cart total** in supported configurations: trial, free anchor days, `send_invoice`, recurring cycles, and cart-level coupons whose translation to Stripe `discounts` is not yet proven equal on both sides.
3. **A 4-working-day commitment** was made to the client on 2026-09-15, covering fix, regression tests, documentation and staging validation, with certification excluded.

## Decision

Validate the amount Stripe actually collected against the cart the order is minted from, inside `createSubscriptionOrderFromCart`, **through the same comparison function the one-time guard uses**, and refuse to create the order on divergence — but hard-block only in the configuration where the two figures must be equal, logging for reconciliation everywhere else.

Four sub-decisions, each deliberate:

**1. Comparison base is `cart.totalPrice`, not `taxedPrice?.totalGross ?? totalPrice`.** The subscription invoice is assembled from Stripe Prices built off the line items' own price values plus the shipping price, and the connector sets neither `automatic_tax` nor a Stripe Tax calculation on the subscription path — so the invoice carries no tax. `totalPrice` is the figure the invoice is actually built from, in both the tax-included and the tax-on-top configuration. Using `totalGross` would reject every legitimate order in a tax-on-top setup. This exposed a separate pre-existing defect, filed as KI-056 and deliberately not fixed here.

**2. Hard block scoped to first cycle + `charge_automatically` + no trial + `amount_paid > 0` + an undiscounted invoice.** Every condition is read from Stripe-owned data, never from the cart, because the cart is what the attack mutates. `amount_paid > 0` excludes the zero-invoice shapes without needing `proration_behavior`, which Stripe does not persist on the Subscription, and costs nothing in coverage: the attack collects real money by construction. Outside this configuration the divergence is logged and the order is still created.

> The "Stripe-owned data" part of that sentence is the decision, not a description of it. The discount exemption was first written against `cart.discountCodes`, which is shopper-controlled at exactly the moment of the attack — the same commercetools call that enlarges the unfrozen cart can add a discount code and switch the guard off, reproducing the original vulnerability in full. It was caught during pre-merge verification and moved to `invoice.discounts` / `invoice.total_discount_amounts`, which are fixed when the subscription is created. **Any condition later added to this guard must be immutable by the shopper**; a guard is only as strong as the most attacker-controlled input in its applicability test.

**3. Validated at the post-`updateCartAddress` snapshot, with `expectedVersion` pinning.** That is the snapshot the order is minted from, and the shipping address is shopper-controlled. Pinning only where the guard ran keeps the legacy re-read everywhere else, so a version this method never validated cannot produce 409s that silently drop legitimate paid orders.

**4. Applied to `invoice.paid` and to `charge.succeeded` on a pending charge; exempt at the `paymentState: Failed` call site and on recurring cycles.** The failed path creates an order precisely to record that no money was collected — there is nothing to validate against. Recurring cycles (`handleSubscriptionPaymentCreateNewOrder`) build a cart cloned from the original order whose total diverges from the recurring invoice **by design** — the code documents a $225 cloned cart against a $75 recurring invoice — so a guard there would break normal operation on any multi-quantity or mixed cart.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Branch from `composable` and write a parallel comparison | Reproduces exactly the divergence that caused this bug: one implementation of the check per handler branch, reconciled by whoever notices. Stacking on `fix/composable-XX-underpayment-tax-address-guard` lets both guards call one function. |
| Reuse `paidAmountMatchesCart` verbatim | Its `taxMode === 'Platform' && !taxedPrice → no match` rule is correct for the one-time flow, where the PaymentIntent is created for the gross amount. On the subscription path a Platform cart with no computed `taxedPrice` is the normal case, so verbatim reuse would have blocked **every** subscription order. The comparison is shared; the expected total is supplied per flow. |
| Compare against `ctCartService.getPaymentAmount(cart)` | It also validates that the cart is still payable and throws once it is fully paid. This is the documented cause of KI-047's production false positives (`cartAmount` and `paidAmount` both 12300). Read the cart's own total instead. |
| Re-freeze the cart in `removeShippingRate` as the fix | The freeze is best-effort in at least four places (KI-008) and was never a reliable control — making it load-bearing repeats the mistake this bug exposed. It also leaves a genuine Express Checkout canceller with a frozen cart (KI-044 family). Kept as a separate defense-in-depth item with its own owner. |
| Hard-block every configuration, widening later | Inverts the risk: the cases in the divergence matrix are unmeasured, and rejecting honest subscription orders is the KI-047 failure we already paid for once. Widen only on staging evidence. |

## Consequences

**Positive:** the reported vulnerability is closed, and so is its twin on the `charge.succeeded` branch. One comparison function now serves both the one-time and the subscription path, so a future gap in either is fixed once. The validated cart version is pinned, closing the post-validation mutation window. The `taxedPrice` investigation surfaced KI-056, a pre-existing revenue gap nobody had recorded.

**Negative:** a blocked order leaves a paid-without-order state requiring manual reconciliation — no auto-refund, per the hub rule that divergence is surfaced and never auto-corrected. The hard block is narrower than the full attack surface; trial, `send_invoice`, free-anchor and coupon-bearing carts are logged but not refused until their divergence is measured.

**Risks:** the divergence matrix is validated only by unit tests at the time of writing — the staging day the estimate allocated to it does not fit inside the committed window, so widening the block stays gated on that measurement rather than on assumption. The `removeShippingRate` unfreeze remains open, which keeps the attack convenient even though it is no longer profitable. And `cart.totalPrice` is the right base **only while** subscription invoices carry no tax; whoever closes KI-056 must revisit Rule 6 in the same change, or the guard will start rejecting legitimate orders.

---

## Addendum (2026-09-17): the discount exemption was attacker-selectable

**Status of this addendum:** Accepted. Extends, does not supersede, the decision above.

The scoping rule stated here — *every condition of the guard is read from Stripe-owned data, never from
the cart* — was applied correctly to four of the five conditions. `billing_reason` and `amount_paid` are
Stripe's; `collection_method` and the trial come from merchant-set product attributes. The fifth,
"the invoice carries no discounts", is the exception, and the reason is subtle enough to be worth
recording rather than just fixing.

`invoice.discounts` **is** Stripe-owned and **is** immutable once the subscription exists. What it is not
is *unselectable*: a shopper decides whether their cart carries a discount code before the subscription
is created, and any valid code puts `discounts` on the invoice. That single step switched the hard block
off for the life of that subscription, after which the chain in this ADR ran unimpeded. Reproduced
against the guard at the reporter's own figures — EUR 20.00 collected, EUR 70.00 ordered.

**The distinction, stated so it is not re-learned:** "the attacker cannot edit this later" and "the
attacker cannot choose this" are different properties. A guard condition needs the second. Immutability
after the fact is worth nothing if the value was the attacker's to pick beforehand.

**Decision:** the exemption stays — the reasoning for it is sound and unchanged; comparing collected
money against a cart total on a coupon-bearing invoice depends on a translation that KI-055 shows is not
yet trustworthy, and widening it would reject honest orders. Instead a second, narrower guard is added
that asks a question with no Stripe arithmetic in it: **is this still the cart the subscription was
priced from?** The cart total is sealed onto the subscription at creation and compared at `invoice.paid`.

It has no exemptions, because the exemptions in the original decision are all answers to "may the invoice
amount legitimately differ from the cart total?" and this guard does not ask that. See
`business-rules/payment-confirmation.md` Rule 7.

**Consequence for the open items above:** widening the hard block to discounted invoices is no longer on
the critical path. The financial loss is closed by the drift guard; measuring coupon-translation equality
in staging is now a correctness question about Rule 6's scope, not a security one.

**Residual:** subscriptions created before the seal shipped carry none and fall back to the original
behaviour. This closes as that population churns; it is not worth blocking every existing subscription's
next invoice to shorten it.
