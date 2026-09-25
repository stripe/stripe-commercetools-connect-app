# ADR-019: The post-address guard triggers on the cart's value, and the version pin is unconditional

**Status:** Accepted
**Date:** 2026-09-17

> **Numbering:** 017 and 018 are taken by work in flight on sibling branches (the subscription
> `invoice.paid` guard and the CT-state coupon authority). This ADR is numbered 019 so the three can
> land in any order without collision.

## Context

`handlePaymentIntentSucceededFlow` validates the amount collected against the cart, then does two more
awaits before creating the order: `charges.retrieve`, and `updateCartAddress`, which writes the
shopper-controlled address from the charge onto the cart. In Platform tax mode commercetools recomputes
`taxedPrice` for the new destination. The order is minted from *that* snapshot, which the first guard
never saw — so a client holding the `client_secret` could confirm with a high-tax destination and receive
a fully `Paid` order worth more than was collected.

A first fix added a second guard after `updateCartAddress` and pinned the cart version so a cart moving
after validation could not mint an order. It was then found to drop legitimate paid orders, and the pin
was made conditional on the address having changed. That narrowed the damage but left three problems:

1. **The second guard hard-failed any `Platform` cart with no `taxedPrice`**, reasoning that the
   `totalPrice` fallback could hide uncollected destination tax. But that same fallback is what the
   connect-payments-sdk prices the PaymentIntent from and what the first guard accepts, so the rule
   refused orders it had validated as exactly matching, against the same number, seconds earlier.
   `Platform` is commercetools' default tax mode and a project whose products carry no tax category
   never gets a `taxedPrice` — the repository's own canonical cart fixture has none. The outcome was
   money captured, no order, no auto-refund, on carts that had done nothing wrong.
2. **"Did the address change" was inferred from the version counter.** `updateCartAddress` bumps the
   version up to three times without the destination moving — unfreeze, `setShippingAddress`, refreeze —
   so a frozen cart whose charge address already matched entered the re-check, which is how (1) became
   reachable on carts where nothing had changed.
3. **The conditional pin reopened the window on the dominant path.** With no address change there is no
   destination tax to inflate, which is what the justification said; but the window protects more than
   tax. Between the cart read and the order POST, any writer can add a line item, a discount or a
   shipping method, and an unpinned create mints from whatever the cart holds by then. That is the path
   most card checkouts take.

## Decision

**The guard triggers on the cart's orderable total changing across `updateCartAddress`, not on its
version changing and not on its tax mode.** `orderableCartTotal` — `taxedPrice?.totalGross ?? totalPrice`
— is shared with the pre-mutation guard, so the two can never disagree about what a cart is worth.

**The amount is not re-compared once the total has moved.** The pre-mutation guard has already
established that the payment equals the total *before* the write, so once the total moves the payment
cannot equal the one after. Writing the comparison in would read as though some moved-total case still
proceeds; none does.

**The version is pinned on every path, and the 409 it can produce is resolved rather than avoided.** On
`ConcurrentModification` the cart is re-read and re-decided: still worth what was collected → the order
is created from the new snapshot; not → no order, logged distinctly. Exactly one retry.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Keep the `Platform`/`taxedPrice` hard-fail | Rejects a shape the whole rest of the pipeline supports, on carts the sibling guard just accepted. Under-collected tax on a never-taxed cart is real but it is KI-056's, and refusing paid orders does not answer it. |
| Keep the pin conditional | Protects the confirm-freeze race by leaving the TOCTOU open on the path most checkouts take. Trades a rare dropped order for a reachable one. |
| Pin unconditionally with no retry | This is what produced the dropped-order regression that made the pin conditional. The retry is what makes unconditional pinning safe; they are one change. |
| Retry on 409 without re-validating | Would defeat the pin entirely: the retry would mint the order from exactly the moved cart the pin refused. |
| Derive "address changed" by comparing address fields | Closer than the version counter, but still a proxy. The total moving is the thing the guard defends; compare that. |

## Consequences

**Positive:** no legitimate cart shape is refused for lacking a `taxedPrice`. The TOCTOU is closed on
both paths. The two guards share one definition of a cart's worth, so they cannot diverge.

**Negative:** a genuine concurrent write now costs one extra cart read and one retry before the order is
created. A second conflict gives up rather than looping — deliberate, while holding a captured payment.

**Risks:** the guard still cannot distinguish "the shopper picked a high-tax destination" from
"commercetools learned the destination for the first time and computed tax honestly". Both move the
total and both are refused. `updateCartAddress` exists precisely because the destination is often not on
the cart until the charge arrives, so on a tax-on-top Platform configuration this can reject an honest,
fully paid checkout. How often that happens depends on how often a charge carries a complete address —
**an open question that needs measuring against real Stripe data, not reasoning.** Express Checkout is
not exposed (the address is on the cart before confirm) and the default card Payment Element usually is
not (it collects only country and postal code), so the exposed population is merchants collecting a full
billing address, methods whose `billing_details` carry one, and Link autofill.

## Deliberately untested, and why

Two branches carry no test rather than a test that cannot fail:

- **`amount_received` vs `amount`** in the retry check. The pre-mutation guard refuses the event unless
  the two are equal, so the webhook cannot tell the choice apart. `amount_received` is kept because it is
  the semantically correct field and stays correct if that upstream equality is relaxed.
- **The currency half of the total comparison.** commercetools does not change a cart's currency on a
  `setShippingAddress`. Kept as one cheap comparison so an equal-looking amount in a different currency
  can never read as unchanged.

Both are recorded here and in comments at the call sites so their lack of coverage is not read as an
oversight — and so nobody "fixes" it by writing a test that passes for the wrong reason.
