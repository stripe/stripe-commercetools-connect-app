# ADR-018: commercetools is the authority on discount application; the Stripe coupon is a price vehicle

**Status:** Accepted
**Date:** 2026-09-17

## Context

`StripeCouponService` translated every discount code on a cart into a Stripe coupon whose id is the
CT discount code id, and mirrored `DiscountCode.maxApplications` into the coupon's `max_redemptions`.
Two properties of that design combined into a defect.

First, `DiscountCodeInfo.state` was never read anywhere in the connector. commercetools' own verdict
on whether a code applies to a cart was ignored, so a code that CT had stopped applying was still
attached to the Stripe subscription.

Second, Stripe marks a coupon `valid: false` once `times_redeemed` reaches `max_redemptions`, and the
connector read *any* unusable coupon as "the merchant edited the configuration, re-sync it" — delete,
then recreate on the same id. Stripe permits reusing the id of a deleted coupon and gives the new
coupon a `times_redeemed` of 0. The cap therefore reset at the exact moment it was reached, and could
never stop a redemption. Reproduced live on 2026-09-15: a `maxApplications: 1` code discounted three
consecutive subscriptions.

The measured end state of the third run is what fixes the direction of the fix: commercetools refuses
to create an order from a cart carrying a code it has capped, so Stripe collected the discounted
amount, no CT order was created, and the cart was left `Frozen` at the undiscounted total. Money
collected against nothing to fulfil, not an order recorded at the wrong price.

A decision was needed because the two halves pull in different directions: the code is wrong where it
resets the counter, but the counter was never enforcement in the first place.

## Decision

commercetools is the sole authority on whether a discount code applies to a cart. The connector reads
`DiscountCodeInfo.state` and translates only `MatchesCart` codes. The Stripe coupon exists solely to
carry the discounted price onto the subscription invoice; it is not an enforcement point, so the CT
usage cap is no longer mirrored into `max_redemptions`. A stored coupon is deleted and recreated only
when its configuration diverges from commercetools — never because Stripe reports it unusable.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Keep mirroring `max_redemptions`, and distinguish "invalid because exhausted" from "invalid because edited" | Leaves the connector permanently owing a correct exhausted-vs-edited distinction for a field that enforces nothing CT is not already enforcing, and it is the mirror itself that manufactures the `valid: false` driving the destructive branch. It also creates a case that otherwise cannot arise: CT says `MatchesCart` while the Stripe coupon is spent, where skipping the coupon overcharges the shopper and failing is a checkout outage. Dashboard visibility of the cap was the only argument for keeping it, and that visibility is misleading — Stripe's counter and CT's do not agree. |
| Fix the counter reset without gating on `DiscountCodeInfo.state` | Converts an undercharge into a failed subscription creation for every capped code. Better than losing money, worse than working: a checkout outage. The gate must come first, which is why it shipped as the first of the two commits. |
| Create each coupon under a fresh, non-CT id (e.g. `{discountCodeId}-{hash}`) | Fully decouples the coupon from the CT id and removes counter semantics entirely, but abandons the id as a join key, leaves orphaned coupons accumulating in the Stripe account, and is a larger change than the finding warrants. |
| Skip the coupon when CT says the code applies but Stripe will not honour it | Charges the shopper more than the CT cart total. Trades a loss of promotional integrity for taking the shopper's money — the wrong direction. The operation fails instead. |

## Consequences

**Positive:** The usage cap is enforced in one system instead of being split between two that disagree.
The delete-and-recreate path shrinks to the merchant-edit case it was written for, and that path no
longer fails silently (KI-007 closed alongside). `DoesNotMatchCart`, a separately reported finding, is
closed by the same gate. Nothing about an honest shopper's checkout changes.

**Negative:** The cap is no longer visible on the Stripe Dashboard. Coupons created before this ADR
still carry a mirrored cap and are replaced once, on first touch, which costs one extra delete+create
per legacy coupon.

**Risks:** The in-sync-but-unusable case now throws rather than degrading, so a Stripe-side condition
this connector does not anticipate surfaces as a failed subscription creation. That is deliberate —
both silent alternatives move money in the wrong direction — but it is a failure mode to watch in
staging. By construction it should be unreachable: with the cap no longer mirrored, exhaustion cannot
occur, and expiry is already caught by CT's own `NotValid` state before the coupon is looked up.

## Notes

Deleting a Stripe coupon prevents it applying to future subscriptions and invoices but does not remove
the discount from subscriptions that already carry it. A re-sync therefore only affects subscriptions
created after it — true before this ADR as well, and now recorded in `business-rules/coupon-sync.md`
Rule 4.

`DiscountCode.applicationCount` is not a usable signal: it stayed `null` throughout the reproduction
while the cap was fully enforced. `DiscountCodeInfo.state` is the one to read.
