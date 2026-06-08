# Business Rule: Coupon / Discount Sync (CT → Stripe)

Discount codes applied to a CT cart are synchronized to Stripe coupons when a subscription is created. The `StripeCouponService` handles this translation during `subscriptions.create()`.

---

## Rule 1: CT discount codes are synced to Stripe coupons at subscription creation time

**What:** During `POST /subscription` and `POST /subscription/withSetupIntent`, `getStripeCoupons(cart)` is called before `subscriptions.create()`. The resulting Stripe coupon IDs are passed as `discounts: [{ coupon: id }]` on the subscription.

**Why:** Stripe subscriptions do not read CT discounts — they must be expressed as Stripe coupons at the time of creation. There is no background sync; the sync happens only at subscription creation.

**Invariant:** Coupons are applied once, at subscription creation. Changes to CT discount codes after subscription creation are NOT automatically reflected on the Stripe subscription.

**Implementation:** `stripe-subscription.service.ts` lines 163 and 245 — `discounts: await this.stripeCouponService.getStripeCoupons(cart)`.

---

## Rule 2: Each CT discount code must have exactly one cart discount

**What:** A CT discount code with multiple `cartDiscounts` is rejected and throws an error. Stripe coupons map 1-to-1 with CT cart discounts.

**Why:** Stripe's coupon model does not support compound discounts (one coupon applying multiple rules). A CT discount code with multiple cart discounts cannot be safely represented as a single Stripe coupon.

**Invariant:** Never apply a discount code with `cartDiscounts.length !== 1` to a subscription cart. Validation happens in `getStripeCoupons()` — it throws before reaching `subscriptions.create()`.

---

## Rule 3: Stripe coupon is validated before reuse; stale coupons are deleted and recreated

**What:** Before reusing an existing Stripe coupon (matched by CT discount code ID), `validateDiscountCode()` compares:
- `percent_off` or `amount_off`
- `redeem_by` (expiration date)
- `currency`
- `max_redemptions`

If any field diverges, the existing Stripe coupon is deleted and a new one is created with the current CT values.

**Why:** CT discount codes can be updated (e.g., expiration date extended, redemption limit increased). The Stripe coupon must reflect the current CT state at subscription creation time.

**Invariant:** The Stripe coupon ID always equals the CT discount code ID (`discount.id`). This is the join key used to check for existing coupons.

**Implementation:** `stripe-coupon.service.ts` → `getStripeCouponById()`, `validateDiscountCode()`, `deleteStripeDiscountCode()`, `createStripeDiscountCode()`.

---

## Rule 4: Unsupported discount types throw before reaching Stripe

**What:** CT cart discount types `fixed` and `giftLineItem` are not supported and throw an error in `getDiscountConfig()`. Only `relative` (percentage) and `absolute` (amount off) are supported.

**Why:** Stripe coupons only support `percent_off` and `amount_off`. `fixed` and `giftLineItem` discounts have no equivalent.

**Invariant:** Never place a `fixed` or `giftLineItem` cart discount on a subscription cart. The error propagates to the `POST /subscription` response.

---

## Rule 5: StopAfterThisDiscount stackingMode is respected

**What:** If a discount code's cart discount has `stackingMode = 'StopAfterThisDiscount'`, no further discount codes are processed — the loop breaks immediately after that coupon.

**Why:** CT's stacking rules must be honored when translating to Stripe's coupon list. Stripe applies all coupons in the `discounts` array; stopping early is the only way to implement the CT stacking constraint.

---

## Coupon field mapping

| CT field | Stripe coupon field | Notes |
|---|---|---|
| `discount.id` | `coupon.id` | Used as the Stripe coupon ID — enables lookup without metadata |
| `cartDiscount.value.permyriad / 100` | `percent_off` | Only when `type = 'relative'` |
| `cartDiscount.value.money[0].centAmount` | `amount_off` | Only when `type = 'absolute'` |
| `cartDiscount.value.money[0].currencyCode` | `currency` | Only when `type = 'absolute'` |
| `discount.validUntil` (converted to Unix timestamp) | `redeem_by` | Optional |
| `discount.maxApplications` | `max_redemptions` | Optional |
| `cartDiscount.name` (localized) | `name` | Display name on Stripe invoice |
| _(always)_ | `duration: 'once'` | Discount applies to first invoice only |
