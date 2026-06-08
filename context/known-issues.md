# Known Issues — ct-connect-stripe-composable

Connector-specific limitations, code defects, and operational gotchas. Cross-cutting issues (webhook swallow, idempotency, CORS, credential defaults) are also documented in the hub `context/known-issues.md` — cross-references are noted below.

---

## KI-001: `StripeHeaderAuthHook` only checks header presence, not signature — any caller with the header set bypasses the guard

**Problem:** `processor/src/libs/fastify/hooks/stripe-header-auth.hook.ts:7` checks only that the `stripe-signature` header is present (non-empty). It does not verify the HMAC signature. Any HTTP client that sends `stripe-signature: any-value` passes the hook and reaches the webhook route handler. Full HMAC verification only happens inside `stripe.webhooks.constructEvent()` further down the call stack.
**Root cause:** `processor/src/libs/fastify/hooks/stripe-header-auth.hook.ts:7` — hook stops at `header !== undefined`, no cryptographic check.
**Rule:** The pre-handler hook must not be the sole defense. The route handler correctly verifies via `constructEvent()`, so this is defense-in-depth concern, not a direct bypass. However, any attacker who can reach the endpoint can trigger the full signature verification path — the hook does not block malformed requests early.
**Implementation note:** The hook's role is rate-limiting early rejection. It does not provide additional security beyond what `constructEvent()` already provides.

---

## KI-002: `processStripeEvent()` swallows all errors → HTTP 200 returned to Stripe on CT update failure

**Problem:** `processStripeEvent()` at `processor/src/services/stripe-payment.service.ts:694` contains a top-level try/catch that logs the exception and returns void. The route handler returns HTTP 200 to Stripe regardless of whether the CT payment update succeeded. Stripe considers the event delivered and does not retry. CT payment state is permanently left in an inconsistent state.
**Root cause:** `processor/src/services/stripe-payment.service.ts:694` — no exception is re-thrown to the route layer.
**Rule:** Webhook handlers must return HTTP 5xx when CT update fails so Stripe retries. See hub `known-issues.md` Issue 1.
**Implementation note:** Affects `charge.succeeded`, `charge.updated`, `charge.refunded`, `payment_intent.succeeded`, `payment_intent.canceled`, `payment_intent.payment_failed`.

---

## KI-003: `processSubscriptionEventPaid/Charged/Failed` all swallow errors → subscription webhook events permanently lost

**Problem:** `processSubscriptionEventPaid()`, `processSubscriptionEventCharged()`, and `processSubscriptionEventFailed()` at `processor/src/services/stripe-subscription.service.ts:1208, 1485, 1608` each have top-level try/catch blocks that log exceptions and return void. The route handler returns HTTP 200 to Stripe on any failure. Failed invoice processing (CT order creation failure, CT payment update failure) is permanently lost.
**Root cause:** `processor/src/services/stripe-subscription.service.ts:1208, 1485, 1608` — exceptions absorbed before reaching the route layer.
**Rule:** Subscription event handlers must propagate failures so Stripe retries delivery. See hub `known-issues.md` Issue 1.
**Implementation note:** A failed `invoice.paid` event means a recurring payment is processed in Stripe but no CT order or payment record is created. Merchants must reconcile manually.

---

## KI-004: `updateWebhookEndpoint()` failure silently swallowed in post-deploy

**Problem:** At `processor/src/connectors/actions.ts:82`, `updateWebhookEndpoint()` errors are caught and logged only. If the Stripe webhook endpoint update fails during post-deploy, the deploy succeeds but the connector is registered at the stale webhook URL. All Stripe events for the new deployment are delivered to the old endpoint.
**Root cause:** `processor/src/connectors/actions.ts:82` — try/catch absorbs the Stripe error without re-throwing.
**Rule:** Post-deploy failures that affect event delivery must abort the deploy. See hub `known-issues.md` Issue 6.

---

## KI-005: `addPaymentToOrder()` swallows CT update errors — payment record lost on order update failure

**Problem:** At `processor/src/services/stripe-payment.service.ts:973`, when `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING=addPaymentToOrder`, the CT order update call is wrapped in a try/catch that logs the error and returns void. A CT API failure during the `invoice.paid` handler means the payment was charged in Stripe but no payment record is added to the CT order.
**Root cause:** `processor/src/services/stripe-payment.service.ts:973` — CT update error suppressed, Stripe returns 200.
**Rule:** A successful Stripe charge must always produce a CT payment record. CT update errors must propagate so Stripe retries the event.

---

## KI-006: `resolvePaymentIdFromSubscription()` uses `setTimeout(2000)` race — subscription payment ID may not resolve before timeout

**Problem:** At `processor/src/services/stripe-subscription.service.ts:1358`, `resolvePaymentIdFromSubscription()` polls for the Stripe payment ID using a `setTimeout(2000)` delay. If the Stripe subscription event delivers the payment ID after the 2-second timeout, the function resolves with `undefined` and the subsequent CT payment update skips the payment ID. The CT payment is created without an `interfaceId` linking it to Stripe.
**Root cause:** `processor/src/services/stripe-subscription.service.ts:1358` — polling via fixed timeout instead of retry loop or event-driven resolution.
**Rule:** Payment ID resolution must use a retry loop with exponential backoff and a maximum retry count, not a fixed timeout. A fixed 2-second timeout is not reliable under Stripe latency variance.
**Implementation note:** Results in CT payments without `interfaceId` — webhook matching for future events on that payment fails.

---

## KI-007: `coupons.del()` errors swallowed — next coupon creation attempt fails with duplicate key

**Problem:** At `processor/src/services/stripe-coupon.service.ts:75`, `stripe.coupons.del()` is called inside a try/catch that logs errors and continues. If the deletion fails (e.g., coupon still in use), the next `stripe.coupons.create()` with the same coupon ID fails with a duplicate key error. The CT discount is never synchronized to Stripe.
**Root cause:** `processor/src/services/stripe-coupon.service.ts:75` — deletion error absorbed; caller receives no signal that deletion failed.
**Rule:** Coupon deletion failures must be surfaced so the caller can skip creation or use a different ID strategy.

---

## KI-008: Cart freeze/unfreeze errors silently continued — subscription cart may be permanently frozen or unfrozen

**Problem:** At `processor/src/services/stripe-payment.service.ts:459`, `freezeCart()` and `unfreezeCart()` calls are wrapped in try/catch blocks with `// Continue even if freeze/unfreeze fails` comments. A failure to freeze the cart after subscription creation leaves the cart in Active state — users can modify it, potentially corrupting an in-flight subscription.
**Root cause:** `processor/src/services/stripe-payment.service.ts:459` — freeze/unfreeze errors suppressed by design comment.
**Rule:** Cart freeze on subscription initiation is a critical state change. Failure must abort the operation, not continue silently. See `business-rules/subscription-lifecycle.md`.

---

## KI-009: `customer.subscription.deleted` not registered in `actions.ts` — subscription cancellation via Stripe Dashboard doesn't update CT

**Problem:** `StripeSubscriptionEvent.CUSTOMER_SUBSCRIPTION_DELETED` is declared in the enum at `processor/src/services/types/stripe-payment.type.ts:49` with a `//TODO when canceled subscription` comment, but is not registered in the `enabledEvents` array in `processor/src/connectors/actions.ts`. Stripe never delivers this event. When a subscription is canceled via Stripe Dashboard (or by Dunning exhaustion), the CT cart remains frozen indefinitely.
**Root cause:** `processor/src/connectors/actions.ts` — event not in `enabledEvents`; `processor/src/routes/stripe-payment.route.ts:137–186` — no route case for this event.
**Rule:** Every subscription lifecycle event that changes Stripe state must have a corresponding CT state update. See hub `feature-scope.md — Subscriptions`.
**Implementation note:** To implement: register `customer.subscription.deleted` in `enabledEvents`, add a switch case in the route dispatcher, implement a handler that unfreezes the cart and clears `stripeConnector_stripeSubscriptionId`.

---

## KI-010: `cancelSubscription()` does not update CT after Stripe cancellation

**Problem:** `cancelSubscription()` at `processor/src/services/stripe-subscription.service.ts:849–884` calls `stripe.subscriptions.cancel()` successfully but does not update CT. A commented-out TODO at line 870 acknowledges the gap: `//TODO cancel the subscription in commercetools`. The CT cart remains frozen and `stripeConnector_stripeSubscriptionId` holds the canceled subscription ID indefinitely.
**Root cause:** `processor/src/services/stripe-subscription.service.ts:870` — no CT update after Stripe cancel.
**Rule:** Every operator-initiated cancel via the API must update the corresponding CT cart state. See hub `feature-scope.md — Subscriptions`.
**Implementation note:** After `stripe.subscriptions.cancel()`, retrieve the associated CT cart from `canceledSubscription.metadata?.cartId`, clear `stripeConnector_stripeSubscriptionId`, and unfreeze the cart.

---

## KI-011: `getProductMasterPrice()` uses `prices[0]` without filtering by currency — wrong price in multi-currency catalogs

**Problem:** At `processor/src/services/commerce-tools/price-client.ts:44`, `getProductMasterPrice()` returns `prices[0]` without any currency or country filter. In a CT catalog with multiple price tiers or currency variants, the first price in the array may not match the cart's currency. Price sync then creates a Stripe price with the wrong amount.
**Root cause:** `processor/src/services/commerce-tools/price-client.ts:44` — no currency/country filter applied to the price lookup.
**Rule:** Price lookups must filter by the cart's currency code (and optionally country) before selecting a price tier.

---

## KI-012: `updateProductType()` uses delete-then-create — failure between steps permanently removes the product type

**Problem:** At `processor/src/services/commerce-tools/product-type-client.ts:33`, `updateProductType()` deletes the existing product type then creates a new one. If the create call fails (network error, schema mismatch), the product type is permanently deleted. All subscription product lookups fail at runtime until the type is manually re-created with all 15 attributes.
**Root cause:** `processor/src/services/commerce-tools/product-type-client.ts:33` — non-atomic delete-then-create with no rollback.
**Rule:** Product type updates must use an in-place update strategy (add missing fields, remove stale ones). See hub `failure-modes.md — CT Platform API: Post-deploy product type update`.

---

## KI-013: Price sync creates Stripe prices with `price_${Date.now()}` — ID is not stable across retries

**Problem:** At `processor/src/services/stripe-subscription.service.ts:1869`, the idempotency key used when creating a new Stripe price during sync is derived from `Date.now()`. If the sync runs twice for the same CT price (e.g., on Stripe retry or `invoice.upcoming` re-delivery), two duplicate Stripe prices are created with different IDs. Active subscriptions may be updated to the wrong price.
**Root cause:** `processor/src/services/stripe-subscription.service.ts:1869` — timestamp-based ID is not idempotent.
**Rule:** Stripe price creation idempotency keys must be derived from stable CT identifiers (CT price ID + variant SKU), not timestamps.

---

## KI-014: `billingAddressRequired` hardcoded to `true` in the enabler — billing address always collected

**Problem:** At `enabler/src/payment-enabler/payment-enabler-mock.ts:213`, `billingAddressRequired` is hardcoded to `true`. The `STRIPE_COLLECT_BILLING_ADDRESS` environment variable configures this at the processor level but the enabler ignores the processor response and always tells the Payment Element to collect billing address.
**Root cause:** `enabler/src/payment-enabler/payment-enabler-mock.ts:213` — hardcoded boolean, not read from processor config response.
**Rule:** The enabler must read `collectBillingAddress` from the processor's config response and pass it to the Payment Element.

---

## KI-015: `createNewCartFromOrder()` hardcodes `currency: 'USD'` and `country: 'US'` — breaks non-US subscription renewals

**Problem:** At `processor/src/services/stripe-subscription.service.ts:2093, 2096`, when creating a new cart from an order for a recurring payment, the code hardcodes `currency: 'USD'` and `country: 'US'`. Non-US customers with non-USD subscriptions receive incorrect cart data on renewal.
**Root cause:** `processor/src/services/stripe-subscription.service.ts:2093, 2096` — currency and country not derived from the original order.
**Rule:** Cart creation during subscription renewal must inherit currency and country from the source order.

---

## KI-016: Coupon `duration` hardcoded to `'once'` — all synced CT discounts become single-use Stripe coupons

**Problem:** At `processor/src/services/stripe-coupon.service.ts:64`, `stripe.coupons.create()` is called with `duration: 'once'` hardcoded. CT discount types (`forever`, `repeating`, `once`) are not mapped to Stripe coupon `duration`. All CT discounts sync to Stripe as coupons that apply only to the first invoice.
**Root cause:** `processor/src/services/stripe-coupon.service.ts:64` — hardcoded Stripe coupon duration.
**Rule:** CT discount `validUntil` and discount type must be mapped to Stripe coupon `duration` and `duration_in_months` fields. See `business-rules/coupon-sync.md`.

---

## KI-017: `getSavedPaymentConfig()` swallows JSON parse error — invalid `STRIPE_SAVED_PAYMENT_METHODS_CONFIG` silently ignored

**Problem:** At `processor/src/config/config.ts:9`, `getSavedPaymentConfig()` wraps `JSON.parse(env.STRIPE_SAVED_PAYMENT_METHODS_CONFIG)` in a try/catch that returns `undefined` on parse failure. If the env var contains malformed JSON, the connector starts without saved payment method configuration and no error is surfaced.
**Root cause:** `processor/src/config/config.ts:9` — parse error swallowed, fallback to undefined.
**Rule:** Configuration parse errors must be surfaced at startup, not silently ignored. An undefined saved payment config disables the feature without any operator notification.
