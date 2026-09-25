# Business Rule: Coupon / Discount Sync (CT → Stripe)

Discount codes applied to a CT cart are synchronized to Stripe coupons when a subscription is created. The `StripeCouponService` handles this translation during `subscriptions.create()`.

---

## Rule 1: CT discount codes are synced to Stripe coupons at subscription creation time

**What:** During `POST /subscription` and `POST /subscription/withSetupIntent`, `getStripeCoupons(cart)` is called before `subscriptions.create()`. The resulting Stripe coupon IDs are passed as `discounts: [{ coupon: id }]` on the subscription.

**Why:** Stripe subscriptions do not read CT discounts — they must be expressed as Stripe coupons at the time of creation. There is no background sync; the sync happens only at subscription creation.

**Invariant:** Coupons are applied once, at subscription creation. Changes to CT discount codes after subscription creation are NOT automatically reflected on the Stripe subscription.

**Implementation:** `stripe-subscription.service.ts` lines 163 and 253 — `discounts: await this.stripeCouponService.getStripeCoupons(cart)`.

---

## Rule 2: Each CT discount code must have exactly one cart discount

**What:** A CT discount code with multiple `cartDiscounts` is rejected and throws an error. Stripe coupons map 1-to-1 with CT cart discounts.

**Why:** Stripe's coupon model does not support compound discounts (one coupon applying multiple rules). A CT discount code with multiple cart discounts cannot be safely represented as a single Stripe coupon.

**Invariant:** Never apply a discount code with `cartDiscounts.length !== 1` to a subscription cart. Validation happens in `getStripeCoupons()` — it throws before reaching `subscriptions.create()`.

---

## Rule 3: commercetools decides whether a discount code applies; the connector never re-derives that

**What:** A discount code is translated into a Stripe coupon only when its `DiscountCodeInfo.state` on the cart is `MatchesCart`. Every other state — `MaxApplicationReached`, `DoesNotMatchCart`, `NotActive`, `NotValid`, `ApplicationStoppedByPreviousDiscount`, `ApplicationStoppedByGroupBestDeal` — is logged and skipped before any Stripe API call. If every code on the cart is skipped, `getStripeCoupons()` returns `undefined`, exactly as for a cart carrying no codes.

**Why:** Hub rule — the commerce platform is the source of truth for cart state. `MatchesCart` is the only state in which the discount is part of the CT cart total. Translating a code in any other state attaches a discount to the Stripe subscription that the CT cart does not carry, and Stripe then collects less than commercetools says the cart is worth.

The usage cap is the case that made this concrete: CT stops applying a spent code (`MaxApplicationReached`) while the connector kept mirroring it onto the subscription. Note that `DiscountCode.applicationCount` is **not** a usable substitute — it was observed to stay `null` through a run in which the cap was fully enforced. `DiscountCodeInfo.state` is the reliable signal.

**Invariant:** No Stripe coupon is created, retrieved, deleted, or attached for a discount code whose cart state is not `MatchesCart`.

**Closure criterion:** `grep -n "MatchesCart" processor/src/services/stripe-coupon.service.ts` returns the gate in `appliesToCart()`, and `getStripeCoupons()` calls it before reading `code.discountCode.obj`.

**What breaks if violated:** Stripe's invoice total and the CT cart total diverge for the same cart. commercetools then refuses to create an order from that cart (`The discountCode '…' cannot be applied to the cart`), so the shopper is charged, no order exists, and the cart stays `Frozen` — a paid-without-order state that must be reconciled by hand.

**Implementation:** `stripe-coupon.service.ts` → `appliesToCart()`, called first in the `getStripeCoupons()` loop.

---

## Rule 3b: A code commercetools will not order with refuses the checkout, before anything is charged

**What:** Before any Stripe object is created, every code on the cart is checked against the states
commercetools will still create an order from — `MatchesCart` and `ApplicationStoppedByGroupBestDeal`,
per the platform SDK's own documentation of `DiscountCodeState`. Any other state throws
`DiscountCodeNonApplicable` (HTTP 400) and the subscription is never created.

**Why:** Rule 3 stops the connector translating a code commercetools does not apply. That is necessary
and not sufficient. Skipping the code left the subscription being created and the shopper charged — at
the **full** amount, since no coupon was attached — and only then did commercetools refuse to create
the order, for the same reason the code was skipped. The error is not retryable, so it is logged,
Stripe receives HTTP 200 and never redelivers, and the state is permanent: money collected with
nothing to fulfil and nothing to refund against.

The cap fix (Rule 5) made that outcome *more* expensive for the shopper, not less. Before it, the
resurrected coupon at least meant they were charged the discounted amount for the nothing they
received. This rule is what makes Rules 3 and 5 safe to ship.

**Invariant:** No subscription is created, and no money is collected, from a cart carrying a code whose
state commercetools will reject the order for. Everything needed to decide this is on the cart before
any money moves.

**`ApplicationStoppedByGroupBestDeal` must not refuse.** commercetools creates that order and simply
does not apply the discount — a legitimate outcome the shopper must not be blocked on. It is the one
non-applying state that is skipped rather than refused, and the distinction is pinned by a test.

**Whitelist, not blacklist, deliberately.** A state commercetools adds later is unknown to this
connector and must not be assumed orderable. Failing closed there costs a checkout; failing open costs
a payment with no order.

**Ordering is load-bearing:** the refusal runs *before* the applicability skip. Reversed, a blocking
state is skipped by the `continue` and never reaches the check — the guard reads correct and does
nothing. Pinned by a mutation test.

**Implementation:** `stripe-coupon.service.ts` → `assertOrderableWithCode`, called first in the
`getStripeCoupons` loop. Thrown from there because that call is awaited as an argument to
`subscriptions.create`, so nothing is created and no CT payment is recorded.

**Closure criterion:** a cart whose only code is `MaxApplicationReached` rejects with
`DiscountCodeNonApplicable` and zero calls to `coupons.retrieve`, `coupons.del` and `coupons.create`.

**What breaks if violated:** the shopper pays in full and receives nothing, permanently, with no
automatic path back — the outcome measured in KI-055 rather than the over-valued order the external
report described.

---

## Rule 4: Only configuration divergence re-syncs a Stripe coupon — never unusability

**What:** An existing Stripe coupon (matched by CT discount code ID) is deleted and recreated **only** when its stored configuration no longer matches the CT discount code. `hasDivergentConfig()` compares:
- `percent_off` or `amount_off`
- `redeem_by` (expiration date)
- `currency`
- whether the coupon still carries a `max_redemptions` the connector no longer writes (see Rule 5)

Whether Stripe considers the coupon usable (`valid`) is a **separate** question, asked after divergence has been ruled out. A coupon that is in sync but that Stripe will not apply is neither reissued nor silently dropped: the operation fails and is reconciled by an operator.

**Why:** The Stripe coupon ID *is* the CT discount code ID, and Stripe permits reusing the ID of a deleted coupon, handing the new coupon a `times_redeemed` of 0. Treating unusability as a re-sync trigger therefore cleared whatever limit Stripe was applying at the exact moment that limit was reached. The two questions — "is it in sync" and "can it still be used" — were fused in a single boolean, which is how an exhausted coupon came to be read as a merchant edit.

Failing is the correct outcome for the in-sync-but-unusable case because both alternatives are wrong in opposite directions: recreating the coupon discounts the invoice past what Stripe still permits, and dropping it charges the shopper more than the CT cart says. Neither is the connector's to choose silently.

**Invariant:** `stripe.coupons.del()` is reached only from the divergence branch. A coupon is never deleted because `valid` is `false`.

**Closure criterion:** `deleteStripeDiscountCode()` has exactly one caller, inside the `hasDivergentConfig()` branch of `resolveStripeCoupon()`.

**What breaks if violated:** The redemption counter resets on every application, and the coupon's limit can never stop anything.

**Note on scope:** deleting a Stripe coupon prevents it from applying to *future* subscriptions and invoices; it does not remove the discount from subscriptions that already carry it. A re-sync therefore only ever affects subscriptions created after it.

**Implementation:** `stripe-coupon.service.ts` → `resolveStripeCoupon()`, `hasDivergentConfig()`, `getStripeCouponById()`, `deleteStripeDiscountCode()`, `createStripeDiscountCode()`.

---

## Rule 5: The CT usage cap is not mirrored into Stripe

**What:** `createStripeDiscountCode()` does not send `max_redemptions`. `DiscountCode.maxApplications` is read by nobody in the connector.

**Why:** commercetools enforces the cap, and Rule 3 makes the connector honour that verdict. Mirroring the cap enforced nothing CT was not already enforcing, and had one real effect: it made Stripe mark the coupon `valid: false` on exhaustion, which is what drove the destructive re-sync of Rule 4. The Stripe coupon exists to carry the price onto the invoice — it is not an enforcement point. See `decisions/adr-018-ct-state-authority-coupon-price-vehicle.md`.

**Invariant:** No `max_redemptions` is written to Stripe. A stored coupon that still carries one predates this rule and is divergent by definition (Rule 4), so it is replaced once, on first touch.

**Closure criterion:** `grep -n "max_redemptions" processor/src/services/stripe-coupon.service.ts` returns only the staleness check in `hasDivergentConfig()`, never a write.

**What breaks if violated:** The `valid: false` that Rule 4 must never act on comes back, and with it the pressure to reissue exhausted coupons.

**Trade-off accepted:** the cap is no longer visible on the Stripe Dashboard. It is visible in commercetools, which is where it is enforced.

---

## Rule 6: Unsupported discount types throw before reaching Stripe

**What:** CT cart discount types `fixed` and `giftLineItem` are not supported and throw an error in `getDiscountConfig()`. Only `relative` (percentage) and `absolute` (amount off) are supported.

**Why:** Stripe coupons only support `percent_off` and `amount_off`. `fixed` and `giftLineItem` discounts have no equivalent.

**Invariant:** Never place a `fixed` or `giftLineItem` cart discount on a subscription cart. The error propagates to the `POST /subscription` response.

---

## Rule 7: commercetools' stacking verdict is read, never re-derived

**What:** Every discount code that reaches the translation loop is translated. The connector does not
inspect `stackingMode` and does not stop early.

**Why:** It used to break out of the loop when a code's cart discount carried `StopAfterThisDiscount`.
That is Rule 3's error in another form — re-deriving commercetools' verdict from configuration — and
it was wrong in a way that costs the shopper money: commercetools applies cart discounts by
`sortOrder`, while `cart.discountCodes` is in insertion order. A stopping discount that sorted last, and
therefore stopped nothing, still broke the loop and dropped a code commercetools *had* applied. The CT
total carried both discounts; the Stripe invoice carried one. The shopper is overcharged, and the
first-cycle amount guard cannot catch it because it exempts discounted invoices.

**Invariant:** The set of coupons on the subscription equals the set of codes commercetools reports as
`MatchesCart`. Nothing else decides membership.

**Where the stacking outcome actually comes from:** commercetools reports it. Anything it stopped
carries `ApplicationStoppedByPreviousDiscount`, which Rule 3b refuses before the loop — so a stopped
code never reaches translation, and no simulation is needed.

**Implementation:** `stripe-coupon.service.ts` → `getStripeCoupons`, which no longer reads
`stackingMode`.

**Closure criterion:** a cart with two `MatchesCart` codes, the first carrying
`StopAfterThisDiscount`, produces two coupons.

---

## Rule 8: An absolute discount is read in the cart's own currency

**What:** An absolute CT cart discount holds one `CentPrecisionMoney` per currency it is defined for.
The entry matching the cart's currency is selected, case-insensitively. If the discount is not defined
for that currency, the checkout is refused with `DiscountCodeCurrencyMismatch` (HTTP 400).

**Why:** The connector took `money[0]` — whichever entry the API happened to list first. On a
multi-currency discount that is the wrong amount in the wrong currency. Stripe then rejects the
subscription create, but only after this checkout's products, prices and customer already exist, so the
failure is both late and untraceable from the shopper's side. And because `hasDivergentConfig` compared
against the same `money[0]`, the mistake could never self-correct.

**Invariant:** A Stripe coupon's `amount_off` and `currency` always come from the cart's own currency,
or no coupon is built at all.

**Refusing is the right failure.** There is no correct coupon to build for a currency the discount does
not define, and guessing one charges the shopper a number the merchant never authorized for their
market.

**Known consequence:** the Stripe coupon id is the CT discount code id, so the same code used from
carts in two currencies re-syncs the coupon each time the currency changes (Rule 4 sees a divergent
currency). That is extra API calls, not a correctness problem, and it is harmless now that the usage cap
is no longer mirrored (Rule 5) — there is no counter for the recreate to reset.

**Implementation:** `stripe-coupon.service.ts` → `getDiscountConfig`, which now takes the cart currency;
threaded from `getStripeCoupons` through `resolveStripeCoupon`, `hasDivergentConfig` and
`createStripeDiscountCode`.

**Closure criterion:** a discount defined for EUR, JPY and USD in that order, on a USD cart, produces a
coupon of the USD amount; the same discount on a GBP cart throws.


---

## Coupon field mapping

| CT field | Stripe coupon field | Notes |
|---|---|---|
| `discount.id` | `coupon.id` | Used as the Stripe coupon ID — enables lookup without metadata |
| `cartDiscount.value.permyriad / 100` | `percent_off` | Only when `type = 'relative'` |
| `cartDiscount.value.money[0].centAmount` | `amount_off` | Only when `type = 'absolute'` |
| `cartDiscount.value.money[0].currencyCode` | `currency` | Only when `type = 'absolute'` |
| `discount.validUntil` (converted to Unix timestamp) | `redeem_by` | Optional |
| `discount.maxApplications` | _(not mapped)_ | Deliberately not mirrored — see Rule 5 |
| `cartDiscount.name` (localized) | `name` | Display name on Stripe invoice |
| _(always)_ | `duration: 'once'` | Discount applies to first invoice only. commercetools has no field expressing how many billing cycles a discount spans, so there is nothing to map this from — see KI-016 |
