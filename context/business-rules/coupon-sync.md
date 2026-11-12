# Business Rule: Coupon / Discount Sync (CT → Stripe)

Discount codes applied to a CT cart are synchronized to Stripe coupons when a subscription is created. The `StripeCouponService` handles this translation during `subscriptions.create()`.

---

## Rule 1: CT discount codes are synced to Stripe coupons at subscription creation time

**What:** During `POST /subscription` and `POST /subscription/withSetupIntent`, `getStripeCoupons(cart)` is called before `subscriptions.create()`. The resulting Stripe coupon IDs are passed as `discounts: [{ coupon: id }]` on the subscription.

**Why:** Stripe subscriptions do not read CT discounts — they must be expressed as Stripe coupons at the time of creation. There is no background sync; the sync happens only at subscription creation.

**Invariant:** Coupons are applied once, at subscription creation. Changes to CT discount codes after subscription creation are NOT automatically reflected on the Stripe subscription.

**Implementation:** `stripe-subscription.service.ts` — the `discounts: await this.stripeCouponService.getStripeCoupons(cart)` argument built for each `subscriptions.create()` call (the direct and SetupIntent paths). The Stripe coupon id is the CT discount code id, unscoped (`stripe-coupon.service.ts` → `createStripeDiscountCode`). This service owns **which** codes translate: `translatesToWholeInvoiceCoupon(code, cart)` is true only for a `MatchesCart` code targeting the cart total, or a single percentage line-item code on a cart whose only billed line is the subscription (quantity 1, no shipping charge, no positive fee, and commercetools applied the code to it, read from `discountedPricePerQuantity`). The subscription flow refuses what it rejects rather than re-deriving the rule; only those codes reach `getStripeCoupons`, the rest refused upstream (`mixed-carts.md` Rule 5). The refusal (`UnsupportedCartDiscountForSubscription`, 400) is built in one place, `StripeCouponService.unsupportedSubscriptionDiscountError(reason)`: its body carries `code` and `reason` only, the ids go to the warn log.

---

## Rule 2: Each CT discount code must have exactly one cart discount

**What:** A CT discount code with multiple `cartDiscounts` is rejected and throws an error. Stripe coupons map 1-to-1 with CT cart discounts.

**Why:** Stripe's coupon model does not support compound discounts (one coupon applying multiple rules). A CT discount code with multiple cart discounts cannot be safely represented as a single Stripe coupon.

**Invariant:** Never apply a discount code with `cartDiscounts.length !== 1` to a subscription cart. Validation happens in `getStripeCoupons()` — it throws before reaching `subscriptions.create()`.

---

## Rule 3: commercetools decides whether a discount code applies; the connector never re-derives that

**What:** A discount code is translated into a Stripe coupon only when its `DiscountCodeInfo.state` on the cart is `MatchesCart`. No other state is translated, and none reaches a Stripe API call: `ApplicationStoppedByGroupBestDeal` is logged and skipped (`appliesToCart()`); every other state — `MaxApplicationReached`, `DoesNotMatchCart`, `NotActive`, `NotValid`, `ApplicationStoppedByPreviousDiscount`, and any state not on the `ORDERABLE_STATES` whitelist — is refused before that, by Rule 3b, which throws `DiscountCodeNonApplicable` (HTTP 400) (`assertOrderableWithCode()`). If every code on the cart is skipped, `getStripeCoupons()` returns `undefined`, exactly as for a cart carrying no codes.

**Why:** Hub rule — the commerce platform is the source of truth for cart state. `MatchesCart` is the only state in which the discount is part of the CT cart total.

**Invariant:** No Stripe coupon is created, retrieved, deleted, or attached for a discount code whose cart state is not `MatchesCart`.

**Implementation:** `stripe-coupon.service.ts` → `appliesToCart()`, called first in the `getStripeCoupons()` loop.

---

## Rule 3b: A code commercetools will not order with refuses the checkout, before anything is charged

**What:** Before any Stripe object is created, every code on the cart is checked against the states
commercetools will still create an order from — `MatchesCart` and `ApplicationStoppedByGroupBestDeal`,
per the platform SDK's own documentation of `DiscountCodeState`. Any other state throws
`DiscountCodeNonApplicable` (HTTP 400) and the subscription is never created.

**Invariant:** No subscription is created, and no money is collected, from a cart carrying a code whose
state commercetools will reject the order for. Everything needed to decide this is on the cart before
any money moves.

**`ApplicationStoppedByGroupBestDeal` must not refuse.** commercetools creates that order and simply
does not apply the discount — a legitimate outcome the shopper must not be blocked on. It is the one
non-applying state that is skipped rather than refused.

**Whitelist, not blacklist, deliberately.** A state commercetools adds later is unknown to this
connector and must not be assumed orderable.

The refusal runs *before* the applicability skip.

**Implementation:** `stripe-coupon.service.ts` → `assertOrderableWithCode`, called first in the
`getStripeCoupons` loop. Thrown from there because that call is awaited as an argument to
`subscriptions.create`, so nothing is created and no CT payment is recorded.

---

## Rule 4: Only configuration divergence re-syncs a Stripe coupon — never unusability

**What:** An existing Stripe coupon (matched by CT discount code ID) is deleted and recreated **only** when its stored configuration no longer matches the CT discount code. `hasDivergentConfig()` compares:
- `percent_off` or `amount_off`
- `redeem_by` (expiration date)
- `currency`
- whether the coupon still carries a `max_redemptions` the connector no longer writes (see Rule 5)

Whether Stripe considers the coupon usable (`valid`) is a **separate** question, asked after divergence has been ruled out. A coupon that is in sync but that Stripe will not apply is not reissued: the operation fails and is reconciled by an operator.

**Why:** The Stripe coupon ID *is* the CT discount code ID, and Stripe permits reusing the ID of a deleted coupon, handing the new coupon a `times_redeemed` of 0.

**Invariant:** `stripe.coupons.del()` is reached only from the divergence branch. A coupon is never deleted because `valid` is `false`.

**Note on scope:** deleting a Stripe coupon prevents it from applying to *future* subscriptions and invoices; it does not remove the discount from subscriptions that already carry it. A re-sync therefore only ever affects subscriptions created after it.

**Implementation:** `stripe-coupon.service.ts` → `resolveStripeCoupon()`, `hasDivergentConfig()`, `getStripeCouponById()`, `deleteStripeDiscountCode()`, `createStripeDiscountCode()`.

---

## Rule 5: The CT usage cap is not mirrored into Stripe

**What:** `createStripeDiscountCode()` does not send `max_redemptions`. `DiscountCode.maxApplications` is read by nobody in the connector.

**Why:** commercetools enforces the cap, and Rule 3 makes the connector honour that verdict. The Stripe coupon exists to carry the price onto the invoice — it is not an enforcement point.

**Invariant:** No `max_redemptions` is written to Stripe. A stored coupon that still carries one predates this rule and is divergent by definition (Rule 4), so it is replaced once, on first touch.

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

**Invariant:** The set of coupons on the subscription equals the set of codes commercetools reports as
`MatchesCart` — except that a `MatchesCart` code the invoice-wide coupon cannot reproduce **refuses the cart**:
any target but the cart total, save a single percentage line-item code when the subscription is the only
billed line; and any code on a trial that bills one-time charges or on a prorating anchor. So it never
becomes a coupon. The target is read only to refuse, never to skip a code commercetools applied: among the
codes that are translated, nothing but the `MatchesCart` verdict decides membership.

**Where the stacking outcome actually comes from:** commercetools reports it. Anything it stopped
carries `ApplicationStoppedByPreviousDiscount`, which Rule 3b refuses before the loop — so a stopped
code never reaches translation, and no simulation is needed.

**Implementation:** `stripe-coupon.service.ts` → `getStripeCoupons`, which no longer reads
`stackingMode`.

---

## Rule 8: An absolute discount is read in the cart's own currency

**What:** An absolute CT cart discount holds one `CentPrecisionMoney` per currency it is defined for.
The entry matching the cart's currency is selected, case-insensitively. If the discount is not defined
for that currency, the checkout is refused with `DiscountCodeCurrencyMismatch` (HTTP 400).

**Invariant:** A Stripe coupon's `amount_off` and `currency` always come from the cart's own currency,
or no coupon is built at all.

**Refusing is the right failure.** There is no correct coupon to build for a currency the discount does
not define.

**Known consequence:** the Stripe coupon id is the CT discount code id, so the same code used from
carts in two currencies re-syncs the coupon each time the currency changes (Rule 4 sees a divergent
currency). That is extra API calls, not a correctness problem.

**Implementation:** `stripe-coupon.service.ts` → `getDiscountConfig`, which now takes the cart currency;
threaded from `getStripeCoupons` through `resolveStripeCoupon`, `hasDivergentConfig` and
`createStripeDiscountCode`.

---

## Coupon field mapping

| CT field | Stripe coupon field | Notes |
|---|---|---|
| `discount.id` | `coupon.id` | Used as the Stripe coupon ID — enables lookup without metadata |
| `cartDiscount.value.permyriad / 100` | `percent_off` | Only when `type = 'relative'` |
| `cartDiscount.value.money[]` entry whose `currencyCode` equals the cart's `totalPrice.currencyCode` → `.centAmount` | `amount_off` | Only when `type = 'absolute'`; no entry for the cart currency throws `DiscountCodeCurrencyMismatch` (`getDiscountConfig()`) |
| the same cart-currency entry → `.currencyCode` | `currency` | Only when `type = 'absolute'` (`getDiscountConfig()`) |
| `discount.validUntil` (converted to Unix timestamp) | `redeem_by` | Optional |
| `discount.maxApplications` | _(not mapped)_ | Deliberately not mirrored — see Rule 5 |
| `discount.name` (the DiscountCode's localized name, via `getLocalizedString`) | `name` | Display name on Stripe invoice (`getDiscountConfig()`) |
| _(always)_ | `duration: 'once'` | Discount applies to first invoice only. commercetools has no field expressing how many billing cycles a discount spans, so there is nothing to map this from |
