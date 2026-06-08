# Business Rule: Subscription Lifecycle

> Rules shared with checkout (payment-lifecycle, webhook-handling, customer-session, refunds-reversals, multi-operations) apply here unchanged. This file documents subscription-specific rules only.

---

## Rule 1: Cart is frozen immediately after subscription creation

**What:** After `POST /subscription` creates the Stripe subscription and CT Payment, `freezeCart()` is called to set `frozen: true` on the CT cart.

**Why:** A subscription is tied to a fixed set of items and prices at creation time. Allowing cart modifications after subscription initiation would create a mismatch between what Stripe charges each cycle and what CT's cart contains.

**Invariant:** A cart with an active subscription must remain frozen. Never allow line item changes, quantity updates, or price changes on a frozen cart without first canceling or updating the subscription.

**Implementation:** `stripe-subscription.service.ts` → `createSubscription()` → `freezeCart()`

**What breaks if violated:** The cart diverges from the Stripe subscription. Monthly charges reflect the original subscription, not the modified cart, causing silent billing inconsistencies.

---

## Rule 2: Cart remains frozen on subscription payment failure

**What:** When `invoice.payment_failed` is received for a subscription, the CT Payment is updated with a failed transaction, but the cart is **not unfrozen**. The cart stays frozen for the duration of the subscription lifecycle.

**Why:** The connector does not currently implement cart-level recovery on invoice failure. Stripe handles payment retries automatically via its Smart Retries / Dunning logic (`invoice.payment_failed` can fire multiple times before the subscription is canceled). Unfreezing the cart on every retry would complicate the billing state.

**Invariant:** `unfreezeCart()` is NOT called from `processSubscriptionEventFailed()`. Cart unfreeze for subscriptions only happens temporarily during Express Checkout address updates (see Rule 6).

**Implementation:** `stripe-subscription.service.ts` → `processSubscriptionEventFailed()` → updates CT Payment only, no cart unfreeze.

**Note — limitation:** If a subscription is ultimately cancelled due to failed payment (`customer.subscription.deleted`), the cart remains frozen. Recovery requires the merchant to manually unfreeze or create a new cart. This is a known gap — if cart-level retry UX is needed, `unfreezeCart()` must be added to `handleFailedEventOrder()` in the subscription service.

---

## Rule 3: Subscription products are identified by product type key

**What:** A line item is considered a subscription item if its product belongs to the product type identified by `CT_PRODUCT_TYPE_SUBSCRIPTION_KEY` (default: `payment-connector-subscription-information`).

**Why:** Mixed carts can contain both subscription and one-time items. The product type is the discriminator. Without it, the connector cannot separate what should recur from what should be charged once.

**Invariant:** A cart must contain at most ONE subscription line item. Multiple subscription items in the same cart are not supported. One-time items are unlimited.

**Implementation:** `subscription-mapper.ts` → `getSubscriptionAttributes()`, cart processing logic.

**What breaks if violated:** Multiple subscription items would create multiple Stripe subscriptions from a single cart, or the mapper picks the wrong item and creates an incorrect subscription configuration.

---

## Rule 4: Subscription attributes come from product variant, not cart line item

**What:** Billing interval, trial days, billing cycle anchor, and all Stripe subscription parameters are read from the product variant's custom attributes (prefixed `stripeConnector_`), not from the CT line item.

**Why:** Subscription terms are product-level decisions set by the merchant at product configuration time, not at checkout time. The cart line item only indicates which variant was selected.

**Invariant:** Never read subscription parameters from line item custom fields. Always read from the variant attributes via `subscription-mapper.ts`.

**Implementation:** `subscription-mapper.ts` → `getSubscriptionAttributes()`

**What breaks if violated:** Subscription parameters could be manipulated at checkout time by a client setting custom fields on line items, allowing unauthorized trial extensions or billing cycle changes.

---

## Rule 5: SetupIntent is used to save a payment method without charging

**What:** `POST /setupIntent` creates a Stripe SetupIntent. The frontend confirms it via `stripe.confirmSetup()`. No money is moved. The resulting payment method is then used via `POST /subscription/withSetupIntent`.

**Why:** Some subscription flows require capturing the payment method during a free trial period before the first charge occurs. SetupIntent is the correct Stripe mechanism for this.

**Invariant:** A SetupIntent must be confirmed by the frontend before being used to create a subscription. Never pass an unconfirmed `setupIntentId` to `POST /subscription/withSetupIntent`.

**Implementation:** `stripe-subscription.service.ts` → `createSetupIntent()`, `createSubscriptionFromSetupIntent()`

**What breaks if violated:** The subscription is created with an invalid or unattached payment method, causing the first invoice to fail immediately.

---

## Rule 6: Express Checkout temporarily unfreezes and refreezes the cart

**What:** When a shipping address is updated during Express Checkout for a subscription cart, the cart is briefly unfrozen to allow the update, then immediately refrozen.

**Why:** Express Checkout requires updating shipping on the CT cart when the user selects an address in the wallet. The frozen state must be bypassed for this specific update but restored immediately.

**Invariant:** The unfreeze/refreeze is best-effort within the address update operation — there is no transaction wrapping the sequence. If the update throws after `unfreezeCart()` but before `freezeCart()`, the cart may be left unfrozen. The caller must handle this failure mode; current implementation does not auto-refreeze on error.

**Implementation:** `stripe-shipping.service.ts` → address update handler.

**What breaks if violated:** A failed address update could leave the subscription cart unfrozen, allowing unintended cart modifications that diverge from the subscription.
