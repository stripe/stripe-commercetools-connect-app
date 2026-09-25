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

**Problem:** `processStripeEvent()` at `processor/src/services/stripe-payment.service.ts:637` contains a top-level try/catch that logs the exception and returns void. The route handler returns HTTP 200 to Stripe regardless of whether the CT payment update succeeded. Stripe considers the event delivered and does not retry. CT payment state is permanently left in an inconsistent state.
**Root cause:** `processor/src/services/stripe-payment.service.ts:637` — no exception is re-thrown to the route layer.
**Rule:** Webhook handlers must return HTTP 5xx when CT update fails so Stripe retries. See hub `known-issues.md` Issue 1.
**Implementation note:** Affects the events routed to `processStripeEvent()` itself: `charge.succeeded`, `payment_intent.succeeded`, `payment_intent.canceled`, `payment_intent.payment_failed` (`stripe-payment.route.ts:145-153`). `charge.updated` and `charge.refunded` do **not** go through this function — they route to `processStripeEventMultipleCaptured()` / `processStripeEventRefunded()` respectively (see KI-031 for that function's own error-swallowing behavior); `charge.captured` is logged only, no processing at all.

---

## KI-003: `processSubscriptionEventPaid/Charged/Failed` swallow errors → subscription webhook events permanently lost — ⚠️ PARTIALLY RESOLVED (2026-08-12, `5d73f32`)

**Status:** PARTIALLY RESOLVED for `processSubscriptionEventPaid()` and `processSubscriptionEventFailed()`. Their catch blocks now re-throw when the error message matches `RETRYABLE_CT_ERROR` (`/ConcurrentModification|409|429|50[23]|ETIMEDOUT|ECONNRESET/i`, `processor/src/services/stripe-subscription.service.ts:96`) — a transient CT-write failure now returns non-2xx so Stripe redelivers (redelivery is safe: order creation is guarded by `cartState:Ordered` and transaction writes are idempotent via `changeTransactionState`). **Permanent errors (auth, not-found, validation) are still swallowed by design** — re-raising them would cause a retry storm with no chance of success.
**Still open:** `processSubscriptionEventCharged()` (`:1522`) is now `@deprecated` and no longer wired (subscription-invoice charge/PI events are dropped in favour of `invoice.paid`), but its catch still swallows unconditionally if ever re-wired. A **permanent** failure on `invoice.paid` / `invoice.payment_failed` still returns HTTP 200 and is lost — merchants must reconcile manually.
**Root cause (residual):** `processor/src/services/stripe-subscription.service.ts` — the retryable-error filter covers transient failures only; permanent failures are intentionally not surfaced.
**Rule:** Transient CT-write failures on subscription webhooks must propagate so Stripe retries; permanent failures are logged and swallowed to avoid retry storms. See hub `known-issues.md` Issue 1.

---

## KI-004: `retrieveWebhookEndpoint()` and `updateWebhookEndpoint()` failures silently swallowed in post-deploy

**Problem:** At `processor/src/connectors/actions.ts:53` (`retrieveWebhookEndpoint()`) and `:65` (`updateWebhookEndpoint()`), errors from both calls are caught and logged only. If either the lookup or the update of the Stripe webhook endpoint fails during post-deploy, the deploy succeeds but the connector is registered at the stale webhook URL. All Stripe events for the new deployment are delivered to the old endpoint.
**Root cause:** `processor/src/connectors/actions.ts:53,65` — try/catch absorbs the Stripe error without re-throwing in either function.
**Rule:** Post-deploy failures that affect event delivery must abort the deploy. See hub `known-issues.md` Issue 4.

---

## KI-005 (RESOLVED — verified 2026-09-02 @ `a9e1fba`): `addPaymentToOrder()` swallows CT update errors — payment record lost on order update failure

**Problem (original):** When `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING=addPaymentToOrder`, the CT order update was wrapped in a local try/catch that logged and returned void, so a CT failure during `invoice.paid` left the charge in Stripe with no CT payment record and a 200 to Stripe.
**Resolution:** The path was refactored to `stripe-subscription.service.ts` — `handleSubscriptionPaymentAddToOrder()` (`:2173-2188`) now calls `addPaymentToOrder()` **without a local try/catch**, so the error propagates. Error handling is now governed centrally by the transient/permanent split in `processSubscriptionEventPaid/Failed()` (rethrow on `ConcurrentModification|409|429|502|503|ETIMEDOUT|ECONNRESET`, swallow otherwise) — see `business-rules/recurring-billing.md` Rule 7 / `decisions/adr-015-redeliver-transient-ct-errors.md`. The specific "swallow → void → 200" bug this KI described no longer exists; the residual permanent-error swallow is now the deliberate, documented Rule 7 behavior.

---

## KI-006: `resolvePaymentIdFromSubscription()` uses `setTimeout(2000)` race — subscription payment ID may not resolve before timeout

**Problem:** At `processor/src/services/stripe-subscription.service.ts:1425` (`resolvePaymentIdFromSubscription()`), the function polls for the Stripe payment ID using a `setTimeout(2000)` delay (`:1434`). If the Stripe subscription event delivers the payment ID after the 2-second timeout, the function resolves with `undefined` and the subsequent CT payment update skips the payment ID. The CT payment is created without an `interfaceId` linking it to Stripe.
**Root cause:** `processor/src/services/stripe-subscription.service.ts:1434` — polling via fixed timeout instead of retry loop or event-driven resolution.
**Rule:** Payment ID resolution must use a retry loop with exponential backoff and a maximum retry count, not a fixed timeout. A fixed 2-second timeout is not reliable under Stripe latency variance.
**Implementation note:** Results in CT payments without `interfaceId` — webhook matching for future events on that payment fails.

---

## KI-007 (RESOLVED): `coupons.del()` errors swallowed — next coupon creation attempt fails with duplicate key

**Problem:** At `processor/src/services/stripe-coupon.service.ts:75`, `stripe.coupons.del()` is called inside a try/catch that logs errors and continues. If the deletion fails (e.g., coupon still in use), the next `stripe.coupons.create()` with the same coupon ID fails with a duplicate key error. The CT discount is never synchronized to Stripe.
**Root cause:** `processor/src/services/stripe-coupon.service.ts:75` — deletion error absorbed; caller receives no signal that deletion failed.
**Rule:** Coupon deletion failures must be surfaced so the caller can skip creation or use a different ID strategy.
**Resolved (2026-09-17):** `deleteStripeDiscountCode()` re-throws after logging, so a failed delete aborts before the create instead of surfacing later as a duplicate-id error with its cause already logged away. Closed alongside KI-055, which is what made the delete path worth hardening: after that fix the path still exists, but only for the merchant-edit case. Regression test: *"should not attempt to recreate a coupon whose deletion failed"*.

---

## KI-008: Cart freeze/unfreeze errors silently continued — subscription cart may be permanently frozen or unfrozen

**Problem:** A `freezeCart()`/`unfreezeCart()` failure is caught and swallowed so the payment flow continues, which can leave the cart in the wrong frozen/unfrozen state (e.g. Active after subscription creation, editable mid-subscription).
**Root cause (updated 2026-09-02 @ `a9e1fba`):** The original location (`stripe-payment.service.ts:454`) and its `// Continue - do not break the payment flow if freeze fails` comment **no longer exist** — after the KI-044 fix the freeze moved off `createPaymentIntent` to the confirm gate and to per-rail commit points. The live swallow is now in `stripe-payment.service.ts:1021-1033` (inside `updatePaymentIntentStripeSuccessful`), carrying a new comment (`:1017-1020`) that documents it as deliberate. The invariant still holds — a swallowed freeze failure can still corrupt cart state — but at a different site than originally recorded.
**Rule:** Cart freeze on subscription initiation is a critical state change. Failure must abort the operation, not continue silently. See `business-rules/subscription-lifecycle.md`.

---

## KI-009: `customer.subscription.deleted` not registered in `actions.ts` — subscription cancellation via Stripe Dashboard doesn't update CT — ✅ RESOLVED (2026-08-12, `0375a54`)

**Status:** RESOLVED. `customer.subscription.deleted` is now registered in `enabled_events` (`processor/src/connectors/actions.ts:85`), dispatched in the webhook route (`processor/src/routes/stripe-payment.route.ts:358`), and handled by `processSubscriptionEventDeleted()` (`processor/src/services/stripe-subscription.service.ts:1655`), which resolves the cart via the `ct_payment_id` subscription metadata and **unfreezes it** on terminal cancellation (best-effort, never throws — a lingering frozen cart is not worth forcing a Stripe redelivery).
**Original problem:** The event was declared in the `StripeSubscriptionEvent` enum with a `//TODO when canceled subscription` comment but never registered, so Stripe never delivered it. A subscription canceled via the Stripe Dashboard (or by Dunning exhaustion) left the CT cart frozen indefinitely.
**Residual:** The handler unfreezes the cart but does **not** clear `stripeConnector_stripeSubscriptionId` on the line item — that field still holds the canceled subscription ID. Explicit operator-initiated cancellation via the management API is a separate, still-open gap — see KI-010.

---

## KI-010: `cancelSubscription()` does not update CT after Stripe cancellation

**Problem:** `cancelSubscription()` at `processor/src/services/stripe-subscription.service.ts:913` calls `stripe.subscriptions.cancel()` successfully but does not update CT. A commented-out TODO at line 934 acknowledges the gap: `//TODO cancel the subscription in commercetools`. The CT cart remains frozen and `stripeConnector_stripeSubscriptionId` holds the canceled subscription ID indefinitely.
**Root cause:** `processor/src/services/stripe-subscription.service.ts:934` — no CT update after Stripe cancel.
**Rule:** Every operator-initiated cancel via the API must update the corresponding CT cart state. See hub `feature-scope.md — Subscriptions`.
**Implementation note:** After `stripe.subscriptions.cancel()`, retrieve the associated CT cart from `canceledSubscription.metadata?.cartId`, clear `stripeConnector_stripeSubscriptionId`, and unfreeze the cart.

---

## KI-011: `getProductMasterPrice()` uses `prices[0]` without filtering by currency — wrong price in multi-currency catalogs

**Problem:** At `processor/src/services/commerce-tools/price-client.ts:49`, `getProductMasterPrice()` returns `prices[0]` without any currency or country filter. In a CT catalog with multiple price tiers or currency variants, the first price in the array may not match the cart's currency. Price sync then creates a Stripe price with the wrong amount.
**Root cause:** `processor/src/services/commerce-tools/price-client.ts:49` — no currency/country filter applied to the price lookup.
**Rule:** Price lookups must filter by the cart's currency code (and optionally country) before selecting a price tier.

---

## KI-012: `updateProductType()` uses delete-then-create — failure between steps permanently removes the product type

**Problem:** At `processor/src/services/commerce-tools/product-type-client.ts:33`, `updateProductType()` deletes the existing product type then creates a new one. If the create call fails (network error, schema mismatch), the product type is permanently deleted. All subscription product lookups fail at runtime until the type is manually re-created with all 15 attributes.
**Root cause:** `processor/src/services/commerce-tools/product-type-client.ts:33` — non-atomic delete-then-create with no rollback.
**Rule:** Product type updates must use an in-place update strategy (add missing fields, remove stale ones). See hub `failure-modes.md — CT Platform API: Post-deploy product type update`.

---

## KI-013: Price sync stamps the `ct_price_id` metadata field with `price_${Date.now()}` instead of a real CT price ID

**Problem:** At `processor/src/services/stripe-subscription.service.ts:1954` (inside `getOrCreateStripePriceForProduct()`), the new Stripe price created during price sync sets its `METADATA_PRICE_ID_FIELD` (`ct_price_id`) metadata to a synthetic `price_${Date.now()}` value instead of the actual CT price ID. **This is not Stripe's write-idempotency mechanism** — that is handled correctly and separately via `{ idempotencyKey: randomUUID() }` on the same `stripe.prices.create()` call. The defect is that `ct_price_id` metadata, whose purpose is to let a later lookup identify "the Stripe price for CT price X," can never do so: it holds a timestamp with no relationship to any CT price ID.
**Root cause:** `processor/src/services/stripe-subscription.service.ts:1954` — `ct_price_id` metadata is timestamp-derived, not sourced from the CT price object.
**Rule:** Metadata fields meant to reference a CT identifier (`ct_price_id`, `ct_variant_sku`, etc.) must be populated from the actual CT entity, never from a timestamp or other synthetic placeholder.
**Related:** This is a different defect from KI-032, which found that the *lookup* function (`findStripePriceByProductAndPrice()`) doesn't search by `ct_price_id` at all — it searches `ct_variant_sku` against a product ID. Fixing KI-013 alone (storing a real CT price ID here) would not make price-sync reuse work; KI-032's lookup key would also need to change. See `business-rules/price-sync.md` Rule 3.

---

## KI-014 (RESOLVED — verified 2026-09-02 @ `a9e1fba`): `billingAddressRequired` hardcoded to `true` in the enabler — billing address always collected

**Problem (original):** The enabler hardcoded `billingAddressRequired: true` and ignored the processor's config response, so billing address was always collected regardless of `STRIPE_COLLECT_BILLING_ADDRESS`.
**Resolution:** The enabler now reads `collectBillingAddress` from the processor config and passes it to the Payment Element: `payment-enabler-mock.ts:397` destructures `collectBillingAddress`, `:405-411` applies `fields.billingDetails.address = collectBillingAddress` when it is not `"auto"`, and `mergeConfiguration()` (`:488-491`) reads it from `backendConfig`. The Rule this KI asked for is implemented.
**Residual:** a `billingAddressRequired: true` literal survives at `:412`, but its own comment scopes it to **express checkout** ("Used for express checkout…"), not the standard Payment Element — a narrow, intentional case, not the original bug.

---

## KI-015: `createNewCartFromOrder()` falls back to `currency: 'USD'` / `country: 'US'` when the source order lacks that data — not an unconditional hardcode

**Problem:** At `processor/src/services/stripe-subscription.service.ts:2200, 2203`, when creating a new cart from an order for a recurring payment, the code reads `originalOrder.totalPrice?.currencyCode` and `originalOrder.shippingAddress?.country || originalOrder.billingAddress?.country`, falling back to `'USD'` / `'US'` **only if the original order is missing that field**. For a normal CT order (which always has `totalPrice.currencyCode`), the correct currency is inherited — the fallback branch is a defensive default, not the code's primary behavior. It would only misfire for an order missing `totalPrice` or both address fields, which should not occur for orders this connector itself created.
**Root cause:** `processor/src/services/stripe-subscription.service.ts:2200, 2203` — `||` fallback to US defaults exists for a case that is not expected to occur in practice; worth removing or replacing with an explicit error if it's meant to be unreachable.
**Rule:** Cart creation during subscription renewal must inherit currency and country from the source order — which it already does. If the fallback ever fires in production, that indicates the source order is missing expected fields and should be investigated, not silently defaulted to US values.

---

## KI-016: Coupon `duration` hardcoded to `'once'` — all synced CT discounts become single-use Stripe coupons

**Problem:** At `processor/src/services/stripe-coupon.service.ts:66`, `stripe.coupons.create()` is called with `duration: 'once'` hardcoded. All CT discounts sync to Stripe as coupons that apply only to the first invoice of a subscription.
**Root cause:** `processor/src/services/stripe-coupon.service.ts:66` — hardcoded Stripe coupon duration.

**Premise corrected (2026-09-17, while fixing KI-055 — this KI cannot be implemented as it was originally written):** the original text called for mapping "CT discount types (`forever`, `repeating`, `once`)" to Stripe's `duration`, and `validUntil` to `duration_in_months`. Neither mapping exists to be made.

- `forever` / `repeating` / `once` is **Stripe's** vocabulary. commercetools has no equivalent: the full `DiscountCode` field set is `description`, `code`, `cartDiscounts`, `cartPredicate`, `isActive`, `references`, `maxApplications`, `maxApplicationsPerCustomer`, `custom`, `groups`, `validFrom`, `validUntil`. There is no billing-cycle concept in CT at all — subscriptions are a Stripe-side construct assembled from `stripeConnector_*` product attributes.
- `validUntil` already maps correctly to `redeem_by` ("date after which the coupon can no longer be redeemed"). `duration_in_months` is a different concept — how long the discount lasts *once redeemed* — so mapping one to the other would be wrong, not merely incomplete.
- `duration: 'once'` also happens to be Stripe's own default, so the current value is not arbitrary.

**Rule (restated):** resolving this requires *introducing* a source for the value — a custom field on the CT discount code, a product attribute, or configuration — together with its custom type, post-deploy handling (subject to KI-012's update-in-place rule), adopter documentation and merchant setup. It is a feature with a new configuration surface, not a mapping fix, and it changes billing behaviour for live merchants: a discount that applies to the first invoice today would begin applying for the life of the subscription, while existing subscribers keep the old behaviour (deleting a Stripe coupon does not remove the discount from subscriptions that already carry it). **Deliberately left out of the KI-055 fix** for that reason, despite sitting in the same lines. Needs its own task and its own decision. See `business-rules/coupon-sync.md` coupon field mapping table.

---

## KI-017: `getSavedPaymentConfig()` swallows JSON parse error — invalid `STRIPE_SAVED_PAYMENT_METHODS_CONFIG` silently ignored

**Problem:** `getSavedPaymentConfig()` parses `STRIPE_SAVED_PAYMENT_METHODS_CONFIG` via a helper that returns a fallback on malformed JSON, so a bad env var silently disables saved payment methods with no startup error.
**Root cause (updated 2026-09-02 @ `a9e1fba`):** `getSavedPaymentConfig()` now lives at `config.ts:277-282` (not `:9`) and delegates to `parseJSON()` (`utils.ts:7`), which returns **`{}`** (not `undefined`) on invalid JSON — still swallowed, still no surfacing.
**Rule:** Configuration parse errors must be surfaced at startup, not silently ignored.
**Note:** the neighbouring env var `STRIPE_PAYMENT_BEHAVIOR_RULES` already follows the correct pattern — it **throws** at boot on invalid JSON (`config.ts:254-255`), which is exactly what this KI asks `getSavedPaymentConfig()` to do.

---

## KI-018: Mixed carts with more than one subscription product silently drop the extra subscriptions — no Stripe subscription, no charge, but the item ships in the CT order

**Problem:** `findSubscriptionLineItem()` at `processor/src/services/stripe-subscription.service.ts:863` selects the **first** subscription-type line item (`cart.lineItems.find`) with no validation that it is the only one. `getAllLineItemPrices()` at `:475` skips **all** subscription-type items when building `add_invoice_items`. With two or more subscription products in the cart, only the first gets a Stripe subscription; the rest are never subscribed, never billed on any invoice — yet they remain line items in the frozen cart, so the CT order created on `invoice.paid` includes them. The merchant ships an unbilled product and the customer never receives recurring invoices for it. Everything returns 200; nothing is logged.
**Root cause:** `processor/src/services/stripe-subscription.service.ts:863, 475` — the "exactly one subscription item per cart" assumption (`business-rules/mixed-carts.md` Rule 4) is assumed but never enforced; carts that violate it are processed silently instead of rejected.
**Rule:** The documented cart shapes are (a) all one-time items, or (b) exactly one subscription item + N one-time items. Any other shape must be rejected at subscription creation with an explicit error, not partially processed. Supporting multiple subscriptions per cart (or splitting the cart into separate subscription/one-time orders) contradicts `mixed-carts.md` Rules 1–4 and requires a product/design decision before implementation.
**Implementation note:** Reproduced 2026-07-03 in local testing (prueba 3 of a local test plan; not committed — the referenced `PLAN-PRUEBAS-fix-suscripciones.md` was ephemeral `workspace/` content and is not present in this checkout): cart with 2 subscription products (`charge_automatically` + `send_invoice`) + 2 one-time items → one subscription created with a single item; the second subscription product absent from both the invoice and the customer's subscriptions; CT order contains all 4 line items. Related finding in the same test — **partially fixed on `fix/composable-order-creation-on-success-only`**: product sale prices are now honored. `getLineItemPriceId()` (`processor/src/services/stripe-subscription.service.ts:419-431`) now uses the effective per-unit amount `lineItem.price.discounted?.value.centAmount ?? lineItem.price.value.centAmount`, so a product `price.discounted` (sale price) is charged instead of the list price. **Still open:** cart-level coupons/discounts are intended to flow through the subscription `discounts` field, and coupon `duration` mapping remains hardcoded — see KI-016.

---

## KI-019: `send_invoice` subscriptions leave checkout in limbo — first invoice stays open awaiting a manual payment, cart frozen, no CT order

**Problem:** When the subscription product has `stripeConnector_collection_method = send_invoice`, checkout runs the Setup Intent flow: the shopper enters and saves a card, the subscription is created, and the first invoice is finalized and **emailed** (`stripe.invoices.sendInvoice()` at `processor/src/services/stripe-subscription.service.ts:267`), remaining `open`. The CT payment is created with a Pending Charge transaction and the cart is frozen. The shopper sees a successful checkout, but nothing was charged and **no CT order is created** until someone manually pays the invoice (hosted invoice page or Dashboard). With `days_until_due` defaulting to 1 (`processor/src/mappers/subscription-mapper.ts:22`), an unpaid invoice drives the subscription to `past_due` within a day, and the frozen cart + Pending payment linger indefinitely (no expiry/cleanup handling — cf. KI-009/KI-010).
**Root cause:** Design/config mismatch — the collection method comes from the product attribute (`processor/src/custom-types/custom-types.ts:159`); the connector collects a payment method it then never uses to settle the first invoice, and neither the connector nor the storefront surfaces "invoice sent — pay via email" to the shopper.
**Rule:** `business-rules/recurring-billing.md` and `subscription-lifecycle.md` do not document the `send_invoice` flow — the intended UX is unspecified and needs a product decision: (a) auto-pay the first invoice with the saved payment method, (b) restrict `send_invoice` products to explicit B2B flows with clear storefront messaging, or (c) reject `send_invoice` products in the Payment Element checkout as invalid configuration.
**Implementation note:** Reproduced 2026-07-03 in local testing (prueba 4 of the same local test plan referenced in KI-018 — not committed, ephemeral `workspace/` content): invoice `in_1Toxn5...` stayed `open` for ~2h after a "successful" checkout; paying it manually in the Dashboard triggered `invoice.paid` and the order was created correctly. A sibling subscription from the previous day was already `past_due` with its invoice still open.

---

## KI-020: `/applePayConfig` is registered without any auth pre-handler — the only unauthenticated storefront endpoint

**Problem:** At `processor/src/routes/stripe-payment.route.ts:224`, `GET /applePayConfig` is registered with no `preHandler`, unlike every sibling storefront route (e.g. `GET /config-element/:payment` immediately above it at `:199` uses `preHandler: [opts.sessionHeaderAuthHook.authenticate()]`). Any unauthenticated caller can invoke it. It returns the Stripe Apple Pay domain-association value (`STRIPE_APPLE_PAY_WELL_KNOWN`), which is low-sensitivity, but the endpoint is an unauthenticated surface on a service that otherwise gates every storefront route behind session auth.
**Root cause:** `processor/src/routes/stripe-payment.route.ts:224` — route options object omits the `preHandler` array present on all sibling routes.
**Rule:** Every storefront endpoint on the processor must carry a session-header auth pre-handler unless there is a documented reason for it to be public. If `/applePayConfig` is intentionally public (served during Apple Pay domain verification), document that decision explicitly rather than leaving the omission implicit.
**Implementation note:** Add `preHandler: [opts.sessionHeaderAuthHook.authenticate()]` to the route options, or record an ADR noting the endpoint is intentionally public and why.

---

## KI-021: `getSubscriptionShippingPriceId()` reuses an active Stripe shipping price by `active` alone — a changed shipping rate is charged at the stale amount

**Problem:** At `processor/src/services/stripe-subscription.service.ts:393-417`, `getSubscriptionShippingPriceId()` looks up an existing Stripe shipping price by metadata and reuses it when `price.active` is true (`:407-409`) — **without** comparing `unit_amount` to the current cart shipping cost. Its sibling price-lookup methods in the same file do compare amount: `getLineItemPriceId()` checks `isActive && hasSamePrice` (`:434-437`) and `getCreateSubscriptionPriceId()` checks `isActive && hasSamePrice && hasSameInterval && hasSameIntervalCount` (`:375-380`). If a merchant changes a shipping rate, the previously-created active Stripe price is reused and the subscription is billed the **old** shipping amount on renewal.
**Root cause:** `processor/src/services/stripe-subscription.service.ts:407-409` — reuse guard checks only `isActive`, missing the `unit_amount === amount.centAmount` comparison the sibling methods apply.
**Rule:** Any reuse of an existing Stripe Price for a subscription must verify the amount matches the current CT price, not just that the price is active. See `business-rules/price-sync.md`.
**Implementation note:** Align with `getLineItemPriceId()` / `getCreateSubscriptionPriceId()`: gate reuse on `isActive && price.unit_amount === <current shipping centAmount>`, otherwise create a new shipping price (as those methods do via `disableStripePrice` + create).

---

## KI-022: `createLaunchpadPurchaseOrderNumberCustomType()` silently does nothing when the custom type doesn't exist

**Problem:** The function only calls `getTypeByKey()` (a read) and logs "already exists" when found; when the type is absent, it does nothing despite its name and its role in post-deploy. The same bug exists independently in `ct-connect-stripe-checkout` (its KI-016).
**Root cause:** `processor/src/connectors/actions.ts:42-47` — no create/update call to CT when the type is absent.
**Rule:** Post-deploy must either create the custom type with its required fields or fail loudly if the type is absent. Silent no-op is not acceptable.
**Implementation note:** The `payment-launchpad-purchase-order` custom type must be created manually before deploying.

---

## KI-023: `processStripeEventRefunded` always resolves to `refunds.data[0]` — two near-simultaneous refunds can misattribute amount/ID

**Problem:** The handler lists refunds with `limit: 2` and always takes the most recent (`refunds.data[0]`) as "the" refund for this webhook event. If two refunds are issued in quick succession, both resulting `charge.refunded` webhooks can resolve to the same (latest) refund record, misattributing refund amount/ID to the wrong CT transaction.
**Root cause:** `processor/src/services/stripe-payment.service.ts:812-862` (list call at `:819`) — no correlation between the webhook event's own refund object and which list entry is picked.
**Rule:** The refund a `charge.refunded` webhook is about should be identified from the event payload itself (the event carries the specific refund), not re-derived by listing and guessing the latest.
**Implementation note:** Higher risk on connectors with multi-refund enabled (`STRIPE_ENABLE_MULTI_OPERATIONS=true`), where issuing several partial refunds close together is a normal operator action.

---

## KI-024: `.env.template` omits several environment variables that `config.ts` actually reads

**Problem:** The template is missing, among others: `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED`, `STRIPE_API_VERSION`, `STRIPE_SAVED_PAYMENT_METHODS_CONFIG`, `STRIPE_LAYOUT`, `STRIPE_COLLECT_BILLING_ADDRESS`, `HEALTH_CHECK_TIMEOUT`, `LOGGER_LEVEL`, `MOCK_CLIENT_KEY`, `MOCK_ENVIRONMENT`. (`CONNECT_SERVICE_URL` does not belong on this list — see Root cause.)
**Root cause:** `processor/.env.template` — not kept in sync with `src/config/config.ts`. Note: `CONNECT_SERVICE_URL` is not one of the omissions — `config.ts` never reads it. It is read in two other places, neither of which is `config.ts`: `processor/src/connectors/post-deploy.ts:21` reads it off the CT Connect post-deploy `properties` Map argument, and `processor/src/clients/stripe.client.ts:7-8` reads it from `process.env` directly via a local `new Map(Object.entries(process.env))` wrapper (so it is `process.env`-sourced there, just not through `config.ts`). Either way, its absence from `.env.template` is expected — `.env.template` documents vars consumed through `config.ts`, and this one isn't.
**Rule:** Every env var read by `config.ts` should have a corresponding (even if commented-out/optional) entry in `.env.template`.
**Implementation note:** Adopters following the template alone will not discover these toggles, including the price-sync feature flag — a meaningful operational gap, not just cosmetic.

---

## KI-025 (Enabler): `createComponentBuilder()` always throws — hardcoded empty `supportedMethods` map

**Problem:** `createComponentBuilder(type)` always throws `"Component type not supported"` for every `type` because `supportedMethods` is hardcoded to `{}` — no concrete `PaymentComponentBuilder` implementation exists anywhere in `src/`. Only `createDropinBuilder('embedded')` is functional. Same bug independently present in `ct-connect-stripe-checkout`.
**Root cause:** `enabler/src/payment-enabler/payment-enabler-mock.ts:109-124`.
**Rule:** A publicly documented method must either work as documented or be removed/marked unsupported.

---

## KI-026 (Enabler): `getElements()` swallows Stripe Elements init errors and returns `null`; caller doesn't null-check

**Problem:** `getElements` catches Stripe Elements initialization errors, logs them, and returns `null`. The `null` is passed straight into `getPaymentElement`, which unconditionally calls `elements.create(...)` on it — turning a meaningful init failure into an unrelated `TypeError` further downstream, bypassing the caller's `onError` callback entirely. Same pattern independently present in `ct-connect-stripe-checkout`.
**Root cause:** `enabler/src/payment-enabler/payment-enabler-mock.ts:159-194, 220-230`.
**Rule:** A function that catches and logs an error to "handle" it must not leave callers free to immediately dereference the null result.

---

## KI-027 (Enabler): Express Checkout `cancel` handler swallows `removeShippingRate()` errors — no `onError`, no rethrow

**Problem:** The `cancel` event handler catches errors from `removeShippingRate()` and only `console.error`s them — never calls `onError` nor rethrows. The merchant page has no way to detect that shipping-rate removal failed; cart totals may go stale silently.
**Root cause:** `enabler/src/dropin/dropin-embedded.ts:102-113`.
**Rule:** Errors surfaced only to the console, with no `onError` callback invoked, are invisible to the host application — at minimum forward them through the same error channel used elsewhere.

---

## KI-028 (Enabler): `tsconfig.json` has `strict` mode disabled — contradicts the hub-level TypeScript rule

**Problem:** `"strict": true` is commented out in the enabler's `tsconfig.json`, contradicting this integration's own `CLAUDE.md` rule requiring strict mode for all TypeScript code.
**Root cause:** `enabler/tsconfig.json:18`.
**Rule:** All TypeScript modules in this integration must build with `"strict": true`.

---

## KI-029 (Enabler, dev-only): dev harness builds a Basic Auth header from CT client secret directly in browser-executed JS

**Problem:** `dev-utils/session.js` builds a Basic Auth header from `VITE_CTP_CLIENT_ID`/`VITE_CTP_CLIENT_SECRET` inside browser-executed JS to fetch an admin token. This is confined to the local dev site (not part of the production bundle), but exposes a commercetools client secret to the browser context, which conflicts with the hub rule against exposing provider/platform credentials outside secure server-side config.
**Root cause:** `enabler/dev-utils/session.js:1-27`.
**Rule:** Never construct credential-bearing auth headers in browser-executed code, even for local development conveniences — use a local proxy/backend instead.

---

## KI-030 (Enabler): `confirmPaymentIntent`/`confirmSubscriptionPayment` throw raw string literals instead of `Error` objects

**Problem:** Both functions throw string literals on failure, inconsistent with the `Error`-based throws used elsewhere in the same file — breaks `error.message`/`.stack`/instanceof checks for any host application catch handler.
**Root cause:** `enabler/src/services/api-service.ts:136, 209`.
**Rule:** All throw sites must throw an `Error` instance or subclass. Same pattern independently found in `ct-connect-stripe-checkout`'s enabler (its KI-006).

---

## KI-031: `capturePayment`/`cancelPayment`/`refundPayment` catch Stripe errors and return REJECTED with no CT state update

**Problem:** `capturePayment()`, `cancelPayment()`, and `refundPayment()` each have a try/catch that catches Stripe API errors and returns `{ outcome: 'REJECTED' }` with HTTP 200. When Stripe rejects the operation, no CT Payment transaction is written and the CT payment state is not updated to reflect the failure. Same pattern independently present in `ct-connect-stripe-checkout` (its KI-002).
**Root cause:** `processor/src/services/stripe-payment.service.ts:223` (`capturePayment()`), `:251` (`cancelPayment()`), `:310` (`refundPayment()`) — error is caught, logged, and converted to REJECTED outcome without updating CT.
**Rule:** After a Stripe operation failure, the CT payment must be updated to a FAILED state before returning. See `../../context/failure-modes.md — Stripe API: Payment Intent operations`.
**Implementation note:** The operator dashboard shows REJECTED with no Stripe error details. CT/Stripe divergence requires manual reconciliation. Found 2026-07-28 while reconciling a gap flagged during the `ct-stripe-tax` audit pass — this connector had the code pattern but no corresponding KI entry.

---

## KI-032: `findStripePriceByProductAndPrice()` searches Price metadata by the wrong key — price sync never reuses an existing Stripe Price, creating a new orphaned Price object every sync cycle

**Problem:** `findStripePriceByProductAndPrice(ctProductId, ctPrice)` at `processor/src/services/stripe-subscription.service.ts:1984-2010` searches Stripe prices with `metadata['ct_variant_sku']:'${ctProductId}' AND active:'true'` (`:1990`) — i.e. it compares the `ct_variant_sku` metadata field against a **product ID** value. Every Stripe Price created at checkout time by this connector (`createStripePrice()` at `:599-626`, `getLineItemPriceId()` at `:419-468`) stores `ct_variant_sku` as the **actual variant SKU**, never the product ID — and no Price object carries `ct_product_id` metadata at all (only Stripe *Product* objects do, via `createStripeProduct()`). So this search can never match a checkout-created price. The price-sync path is self-consistent in isolation — when it creates its own price (`:1947-1962`) it also stores `ct_variant_sku = ctProductId`, so a later sync cycle at the *same* amount could find its own prior price — but it can never find or reuse the price the subscription actually started with. Called from `getOrCreateStripePriceForProduct()` (`:1909-1976`), which is reached from `synchronizeSubscriptionPrice()` (`:1818-1873`) only after confirming the CT price actually changed — so most `invoice.upcoming` cycles where a subscribed product's price differs create a brand-new Stripe Price instead of reusing the checkout-created one. Distinct from KI-013 (which concerns the synthetic `ct_price_id` value stamped on that same creation call): KI-013 means the metadata can't be searched by real CT price ID; this issue means the metadata field that *is* searched (`ct_variant_sku`) never matches what checkout-created prices actually stored under that key. Fixing either one alone does not fix reuse — both the stored value and the search key need to agree.
**Root cause:** `processor/src/services/stripe-subscription.service.ts:1990` — query key (`METADATA_VARIANT_SKU_FIELD`) does not match the value being searched for (a product ID, not a SKU), and no price-level metadata field stores the product ID to search by instead.
**Rule:** A price lookup used to avoid duplicate creation must search on a metadata field that was actually written with the value being compared. See `business-rules/price-sync.md`.
**Implementation note:** Either search by `METADATA_PRODUCT_ID_FIELD` after adding that field to the Price metadata at creation time, or resolve the product's SKU and search `ct_variant_sku` by SKU (matching the pattern already used in `getStripePriceByMetadata()` at `:493-498`). Found 2026-07-28 during the composable docs-audit pass while tracing the `invoice.upcoming` price-sync path for KI-013 verification.

---

## KI-033: `ConcurrentModification` (409) race when async-settlement webhooks write the same Payment near-simultaneously

**Problem:** For async settlement (crypto/stablecoin), `payment_intent.processing`, `payment_intent.succeeded`, `charge.succeeded` and the pending→success authorization transition all update the same CT Payment within a short window. Concurrent `updatePayment` calls collide on the Payment's optimistic-locking version, producing a `409 ConcurrentModification`. Observed during E2E crypto testing (e.g. on the `setMethodInfoMethod` and `changeTransactionState` actions).
**Root cause:** `processor/src/services/stripe-payment.service.ts` — each webhook handler does `getPayment` + `updatePayment` independently; the added `processing`/`Pending` writes increase write contention on the same Payment.
**Rule:** The built-in retry recovers (the update is retried against the fresh version and becomes a no-op if already applied), so the final CT state stays coherent — this is NOT a data-loss bug today. Under heavier load a retry could exhaust; a periodic reconciliation is recommended (see hub follow-ups).
**Implementation note:** `processor/src/services/stripe-payment.service.ts` (webhook write path); recovery via the SDK retry wrapper.

---

## KI-034: Synchronous confirm gate — fail-closed on `retrieve()` failure and non-atomic Pending dedup (operational awareness)

**Problem:** The one-time synchronous confirm gate (`updatePaymentIntentStripeSuccessful`, `processor/src/services/stripe-payment.service.ts`) now calls `stripeApi().paymentIntents.retrieve()` before writing to CT. Two operational edge cases follow: (1) **fail-closed (D1):** if `retrieve()` fails/times out, the route responds `400 REJECTED` and the buyer sees an error — yet the `payment_intent.succeeded` webhook may still create the order, so a buyer re-attempt can create a second PaymentIntent (double-charge risk lives at the checkout layer, outside this function). (2) **non-atomic dedup:** the `hasTransactionInState` read + `updatePayment` write for the `processing → Authorization/Pending` case is not atomic against the concurrent `payment_intent.processing` webhook; both can write `Authorization/Pending` (duplicate transaction, no double-charge — Pending moves no money; CT optimistic locking may 409, recovered by the SDK retry — see KI-033).
**Root cause:** `processor/src/services/stripe-payment.service.ts` — `retrieve()` failure is intentionally fail-closed (D1 decision, mirrors the checkout connector); the anti-duplicate guard is best-effort, not transactional.
**Rule:** Accepted trade-offs, documented for operational awareness. The webhook remains the source of truth for order creation; the Pending dedup guard + SDK retry keep the final CT state coherent. If checkout-layer re-attempts become a problem, gate the re-attempt on the existing PI rather than creating a new one.
**Implementation note:** Fail-closed path at the `retrieve()` try/catch; dedup guard via `hasTransactionInState` (`Authorization/Pending` + `Charge/Success`) before the Pending write. Introduced with the sync-gate fix (commit `a09b963`); identity binding rationale in `decisions/adr-009-sync-confirmation-identity-binding.md`.

---

## KI-035: `partially_funded` returns HTTP 200 after a CT write failure — deliberate, but it contradicts the letter of the never-do rule

**Problem:** When the interface-interaction write for `payment_intent.partially_funded` fails, the catch in `processStripeEvent` logs and returns, so the connector answers Stripe with 200 and the event is never redelivered. Read against the connector's own never-do rule ("never catch a Stripe or CT error inside a webhook handler and return HTTP 200 anyway", KI-002/KI-003), this looks like a violation.
**Root cause:** `processor/src/services/stripe-payment.service.ts` — `partially_funded` is deliberately excluded from `ASYNC_PENDING_EVENTS`, the set whose members re-throw so Stripe retries.
**Rule:** Accepted trade-off, not a defect. The event writes **no** CT transaction, so losing it costs one audit line, not state correctness — the damage the never-do rule exists to prevent (silent CT divergence) is not in play. Re-throwing would instead cause a retry storm on an event that fires on every partial funding. `requires_action`, which *does* write a transaction, is in the set and does re-throw.
**Implementation note:** `ASYNC_PENDING_EVENTS` covers `payment_intent.processing` and `payment_intent.requires_action` only. Introduced with the bank transfer event routing (commit `4b59124`, SB3-207).

---

## KI-036: `client_secret` redaction is keyed on payload shape, not on the PaymentIntent being open

**Problem:** `buildPspInteractionResponse` nulls `client_secret` (and strips `financial_addresses` / `hosted_instructions_url`) only inside the branch that detects `next_action.display_bank_transfer_instructions`. Any event for a still-open PaymentIntent whose payload lacks that object takes the early return and persists a **live, usable** `client_secret` into the commercetools interface interaction — the exact exposure the redaction exists to prevent. This is the first code path that persists a PI while it is still open, so unlike the settled-PI precedent the secret is valid for the whole funding window.
**Root cause:** `processor/src/services/converters/stripeEventConverter.ts` — the redaction predicate is the presence of the instructions object; the correct key is the PaymentIntent's `status` (`requires_action` / `partially_funded`).
**Rule:** Re-key the redaction on PI status rather than payload shape. Do not widen the early return without re-checking this.
**Measured 2026-07-31 — the exposure is latent, not active.** A real `payment_intent.partially_funded` payload from the dev Stripe account (`evt_3TzJOPL2sIzjTVbd1DcCXQ7P`) does carry `client_secret`, **and** it carries `next_action.display_bank_transfer_instructions` — so the redaction branch does fire, and no live secret is written today for either routed event. But the two properties are independent: the redaction is correct only *because* the predicate happens to hold (see KI-040). Nothing enforces the coupling, so a payload change on Stripe's side would silently turn this into a real exposure.
**Implementation note:** Early return at the top of `buildPspInteractionResponse`; `client_secret` nulled only in the branch below it. Found by the module read of commit `4b59124` (SB3-207).

---

## KI-037: The async dedup guard skips before persisting the interface interaction, losing the audit trail it justifies elsewhere

**Problem:** When the dedup guard in `processStripeEvent` decides an async-pending event is a duplicate or arrives out of order, it returns before any `updatePayment` call — including the interface-interaction-only write. A redelivered `payment_intent.requires_action` therefore leaves no trace at all. This contradicts the rationale used two blocks later to justify persisting `partially_funded`'s interaction: that an event should leave an audit trail rather than be silently discarded.
**Root cause:** `processor/src/services/stripe-payment.service.ts` — the guard's early return precedes the persistence branch instead of falling through to an interaction-only write.
**Rule:** The two paths should agree. Either both persist the interaction on a no-op, or neither does. Prefer persisting: a redelivery is exactly the event support wants a timestamp for.
**Implementation note:** Dedup guard in `processStripeEvent`, gated on `ASYNC_PENDING_EVENTS`. Found by the module read of commit `4b59124` (SB3-207).

---

## KI-038: `getCtPaymentId` is typed `string` but can return `undefined` at runtime

**Problem:** `getCtPaymentId` declares a `string` return, but it reads `metadata['ct_payment_id']` from the Stripe SDK's index signature, which is `string | undefined` at runtime. The compiler cannot see the gap. Commit `4b59124` added a guard at one call site, but every other consumer of `StripeEventUpdatePayment.id` still trusts a type that can be `undefined`.
**Root cause:** `processor/src/services/converters/stripeEventConverter.ts` — the declared return type is wider than what the metadata lookup can guarantee.
**Rule:** Narrow the return type to `string | undefined` and make each caller handle the absence explicitly, rather than guarding case by case as new paths appear.
**Implementation note:** Guarded call site added in `processStripeEvent`; other consumers unchanged. Found by the module read of commit `4b59124` (SB3-207).

---

## KI-039: A PaymentIntent that carries no `ct_payment_id` is now dropped instead of retried — including on the crypto settlement path

**Problem:** `processStripeEvent` returns early with a `log.warn` and HTTP 200 when `metadata.ct_payment_id` is absent. This is correct for the case it was written for — retrying cannot make metadata appear — but the guard is not scoped to bank transfers. It changes `payment_intent.processing` (crypto/stablecoin settlement) from "throw → 500 → Stripe retries for three days" to "warn → 200 → dropped permanently". Any transient cause of an unreadable metadata field is now unrecoverable.
**Root cause:** `processor/src/services/stripe-payment.service.ts` — the guard sits before the event-type dispatch, so it applies to every event.
**Rule:** Deliberate: the prior behavior risked Stripe disabling the whole webhook endpoint after three days of 500s, which would silence every event for every flow. Documented because it is a behavior change to an unrelated flow, and it must be called out in the PR rather than discovered later.
**Implementation note:** Early return in `processStripeEvent`, before the dedup guard. Introduced by commit `4b59124` (SB3-207).

---

## KI-040: `partially_funded` routing depends on a `requires_action`-shaped payload

**Problem:** The route gates `payment_intent.partially_funded` on `isBankTransferNextAction`, which requires `next_action.display_bank_transfer_instructions`. Only PaymentIntents using `customer_balance` emit this event at all, so the gate cannot admit anything it should reject — but if Stripe ever emits it with `next_action: null`, the event silently becomes log-only, and both the converter's `PARTIALLY_FUNDED` case and its `ZERO_TRANSACTION_PERSIST_EVENTS` entry become dead code.
**Root cause:** `processor/src/routes/stripe-payment.route.ts` — `requires_action` and `partially_funded` share one `case` and therefore one predicate.
**Measured 2026-07-31 — the shape holds on a real payload.** `evt_3TzJOPL2sIzjTVbd1DcCXQ7P` on the dev Stripe account, a genuine `partially_funded` from a `us_bank_transfer` funded at 2000 of 5000: `status: requires_action`, `next_action.type: display_bank_transfer_instructions`, instructions object present, `amount_remaining: 3000`. So the shared predicate does admit the event, and the `PARTIALLY_FUNDED` converter case is reachable. This supersedes the original note that the only evidence was a hand-written fixture.
**Rule:** Downgraded from speculative failure to residual risk — one observed payload is evidence, not a contract, and the failure mode is silent. Do not split the cases on this basis (splitting duplicates the subscription-invoice guard for no measured gain). Do re-check if Stripe changes the `customer_balance` payload, because KI-036's redaction correctness depends on this same property.
**Implementation note:** Shared `case` in the webhook switch. Introduced by commit `4b59124` (SB3-207).

---

## KI-041: Cash-balance clawbacks are logged and never reconciled

**Problem:** `funding_reversed` and `adjusted_for_overdraft` mean Stripe withdrew funds **after** the connector wrote `Charge/Success` and created the CT order. The connector's only response is a `log.error`: no CT transaction, no alert channel, no remediation path. commercetools and Stripe silently diverge on real money, and the divergence does not surface as a dispute. USD funding can be reversed for up to five days.
**Root cause:** `processor/src/routes/stripe-payment.route.ts` — the event is observability-only by design in v1; modelling the reversal in CT is a separate design (the event object is customer-scoped and carries no `ct_payment_id`).
**Rule:** Treat the `log.error` as an alertable signal and wire it to monitoring — it is the only detection available. Full CT modelling is deferred to v1.1. Do not assume a completed bank transfer is final until the reversal window has passed.
**Implementation note:** `logCustomerCashBalanceTransaction` branches on `event.data.object.type`. Introduced by commit `4b59124` (SB3-207). See `failure-modes.md`.

---

## KI-042: Adding events to `actions.ts` does not register them on an existing webhook endpoint

**Problem:** `updateWebhookEndpoint` replaces the endpoint's `enabled_events` array wholesale, inside a `try/catch` that logs and does **not** re-throw (KI-004). If the call fails during post-deploy, the deploy still reports success while the new events are never delivered. Verified empirically on 2026-07-31: both webhook endpoints on the dev Stripe account are missing `invoice.upcoming`, which *is* present in the code's array.
**Root cause:** `processor/src/connectors/actions.ts` — swallowed error.

**What is actually lost — corrected 2026-08-18.** An earlier version of this entry said registration was "the single gate for the whole bank transfer feature" and that without it "bank transfers *appear* to work at checkout and never complete". **That is wrong and is retracted.** Comparing the `enabled_events` array at `137b8f2` against HEAD: `payment_intent.requires_action` and `payment_intent.succeeded` were **already registered** before SB3-207. Those two carry the core flow — the cart freeze at `requires_action` and the order creation at `succeeded` — so a failed update does not stop a bank transfer from completing.

SB3-207 adds exactly four events, and these are what a failed update costs:

| Event | What is lost |
| --- | --- |
| `refund.updated`, `refund.failed` | A refund Stripe later rejects keeps reading as successful in commercetools — the exact gap this work set out to close |
| `payment_intent.partially_funded` | No audit trail on an underpayment |
| `customer_cash_balance_transaction.created` | No alerting when funds are clawed back (`funding_reversed`) |

So the failure mode is degraded **refund correctness and observability**, not a broken checkout. Narrower than first recorded, and different in kind.

**Rule:** After every deploy, verify the endpoint's `enabled_events` contains all four events in the table above — `stripe webhook_endpoints list --project-name=<profile>`. Verifying only `payment_intent.partially_funded` and `customer_cash_balance_transaction.created`, as this entry previously instructed, checks the two least consequential of the four and skips the refund pair entirely.
**Implementation note:** Called from `processor/src/connectors/post-deploy.ts`. Cross-reference KI-004. Surfaced by commit `4b59124` (SB3-207). The swallowed-error question — whether a failed webhook update should abort the deploy — is left open here deliberately: it is a deploy-behaviour decision, not a bank transfer one, and KI-004 owns it.

---

## KI-043 (RESOLVED — commit `04b02d5`): `isFromSubscriptionInvoice` read a PaymentIntent field Stripe removed in Basil — the duplicate-payment guard was dead

**Problem:** `isFromSubscriptionInvoice` reads `paymentIntent.invoice` through an intersection cast, so the compiler cannot see that **Stripe removed that field in the Basil API version (`2025-03-31.basil`)**; `stripe@20.4.1` does not type it on `PaymentIntent` or `Charge`, and the invoice→payment link moved to `invoice.payments`. Where the webhook endpoint's `api_version` is Basil or later, the guard returns `false` for every event. That guard is what stops `payment_intent.succeeded`, `canceled`, `payment_failed`, `charge.succeeded` and `processing` from being processed for subscription invoices — its stated purpose is preventing **duplicate commercetools payments and orders** for recurring charges, with `invoice.paid` as the single source of truth (`business-rules/recurring-billing.md` Rule 4).

**Not a regional issue.** The 2026-08-04 team sync minutes record this as a "Brazil subscription conflict" — that is a transcription of *Basil* as *Brasil*. It is an API-version issue and applies to every account and region whose endpoint runs Basil or later.

**Root cause:** `processor/src/utils.ts` — the intersection cast hides the missing field. `connectors/actions.ts` never sets `api_version` when creating the webhook endpoint, so the endpoint inherits the Stripe account default; accounts created recently default to a post-Basil version.

**Measured 2026-07-31:** both webhook endpoints on the dev Stripe account report `api_version: 2026-06-24.dahlia`, well past Basil. On that account the guard is dead. `stripe listen` independently reports the same version.

**Rule:** Do not assume the subscription-invoice guard is active. Verify per environment before relying on it:

```
stripe webhook_endpoints list --project-name=<profile>
# api_version >= 2025-03-31.basil  →  the guard is dead; rewrite it against invoice.payments
```

Staging and production were **not** verified — only a maintainer with access to those Stripe accounts can run the check. Deferred by the team lead on 2026-08-04 as "document it, address it if it causes real problems"; that decision was taken while the finding was understood as a regional edge case, so it is worth re-confirming with the corrected framing.

**Implementation note:** Surfaced while implementing bank transfer event routing (SB3-207), which adds two more consumers of the same guard. Independent of bank transfers: the exposure predates it and affects subscriptions on their own.

**Resolution:** Confirmed dead rather than merely suspected — measured 2026-08-05 on API version `2026-06-24.dahlia`, where a real subscription charge returned `null` for BOTH `paymentIntent.invoice` and `charge.invoice` while the invoice genuinely owned the PaymentIntent. The consequence was live: one 359.15 USD mixed-cart charge produced THREE commercetools transactions — Authorization and Charge from the invoice, plus a duplicate Charge from `payment_intent.succeeded`. Now keyed on the connector's own `subscription_id` metadata, sharing `METADATA_SUBSCRIPTION_ID_FIELD` with the code that writes it; the `invoice` reads are kept as a fallback for accounts pinned pre-Basil. Every existing test fabricated the removed field, which is why the suite stayed green throughout — rewritten against measured payloads with a negative control. Residual risk documented at the function: the metadata is written by an update-after-create, so the signal is no longer atomic.

---

## KI-044 (RESOLVED — commits `b22e657`, `b7bcf4e`): A cart frozen by an abandoned async payment got emptied on the shopper's next attempt

**Problem:** Creating a PaymentIntent freezes the commercetools cart (`freezeCart` inside `createPaymentIntent`). If the shopper never completes an async payment — a bank transfer that is never wired, a crypto payment abandoned at the redirect — the cart stays `Frozen` until the merchant cancels the PaymentIntent in the Stripe Dashboard, because nothing in the connector expires it (B8, no scheduler). On the shopper's next visit the sample site's checkout sees `cartState !== 'Active'` and calls `clearCart()`: **the shopper loses their items.**
**Observed 2026-08-03**, not inferred: a crypto payment froze cart `c6e6f33d-…`; signing in migrated `customerId` onto that same frozen cart; adding an item succeeded and `/cart` rendered it; opening `/checkout` emptied it. Verified by API — `cartState: Frozen` with 1 line item.
**Root cause:** two independent behaviors compounding. The connector freezes on PaymentIntent creation and has no unfreeze-on-abandonment path; the sample site treats any non-`Active` cart as unrecoverable.
**Rule:** With bank transfers the funding window is **days**, so this is the normal path, not an edge case — and it degrades the `/pending` page directly: a shopper who lands there, leaves, and comes back finds an empty cart. Do not treat the frozen cart as a rare state. Any expiry design (B8) has to decide whether abandonment unfreezes, and the storefront has to distinguish "frozen, payment in flight" from "unusable".
**Escalated by `pi_first`:** under `pi_first` the PaymentIntent is created at **Element mount** rather than at submit, so merely *opening* the payment page would freeze the cart. That is why `pi_first` ships disabled — see `decisions/adr-010-pi-first-elements-initialization.md`, where it is one of the two Consequences blocking enablement. The remaining product decision (freeze at confirm instead of mount, add unfreeze-on-abandonment, or accept it per rule) is still open.
**Implementation note:** `processor/src/services/stripe-payment.service.ts` — `freezeCart` in `createPaymentIntent`; `unfreezeCartOnPaymentCancelOrFailed` only covers `canceled`/`payment_failed`. Storefront side: `CheckoutComposable`'s cart-state effect. Cross-reference KI-008 (freeze failures) and B8.

**Resolution:** Two changes, one per side. **Connector** (`b22e657`): the cart is no longer frozen in `createPaymentIntent`. Each rail freezes at its own commitment point instead — instant rails in `updatePaymentIntentStripeSuccessful`, bank transfer in the `payment_intent.requires_action` handler, since its confirm returns `requires_action` and never reaches the confirm endpoint (verified 2026-08-06). Verified live: two of two confirmations froze, zero mount-time freezes. **Sample site** (`b7bcf4e`): the `Cart` type's `cartState` union omitted `'Frozen'` entirely, so no recovery branch existed; recovery now re-reads the cart and decides on its actual state rather than matching commercetools' error wording, which only covered the `Ordered` case. **Not resolved by this:** the PaymentIntent and commercetools Payment created at mount are still orphaned when a shopper abandons. Carts stop being collateral damage; the Stripe-side litter needs a deterministic idempotency key at creation.

---

## KI-045 (RESOLVED — commit `90110ef`): A rule combining `flowType: 'pi_first'` with `setupFutureUsage` passed startup validation and then silently discarded the mandate

**Problem:** `validateBehaviorRule` checks each rule field independently, so `STRIPE_PAYMENT_BEHAVIOR_RULES={"DE":{"flowType":"pi_first","setupFutureUsage":"off_session"}}` is accepted at boot. At request time `applyPiFirstOverride` discards `setup_future_usage` for any cart resolving to `pi_first` — including a value the rule itself supplied. The merchant configured an off-session mandate, startup reported no problem, and the PaymentIntent goes to Stripe without it. The only trace is a `log.info`.
**Root cause:** `processor/src/config/config.ts` — field-level validation exists, cross-field validation does not. `processor/src/services/stripe-payment.service.ts` — `applyPiFirstOverride` cannot distinguish "no value configured" from "value configured and being dropped" in its return, only in its log.
**Rule:** This is the same failure mode the boot validation was written to prevent: config that looks configured and is not. Reject the combination at boot, or downgrade it to a startup warning that names the offending rule key — either moves a silent per-request loss of a payment mandate to deploy time. Until then, do not set both fields on one rule.
**Resolution:** `validateBehaviorRule` now rejects the combination at boot. Tested against the mandate values (`off_session`/`on_session`) only — `setupFutureUsage` is stored canonicalized, so the disabling spellings are present as their own strings and ask for exactly what `pi_first` produces; rejecting those would fail a harmless config.
**Implementation note:** Introduced by commit `139b685` (P1), resolved in `90110ef`. Kept on record because the shape of the bug — field-level validation passing a self-defeating field *combination* — will recur as the rule schema grows.

---

## KI-046 (RESOLVED — commit `90110ef`): `flowType` was reachable from a shopper-typed billing country, and since P1 it had a financial effect

**Problem:** `extractCountry` resolves `cart.country ?? cart.billingAddress?.country`. On a cart with no top-level `country`, the billing country — which the merchant's storefront collects from the shopper — selects which behavior rule applies. When P1 made `flowType` live, that became a financially relevant choice: `flowType: 'pi_first'` strips `setup_future_usage` from the PaymentIntent (KI-045). So on a country-less cart, a shopper who enters a billing country matching a `pi_first` rule suppresses a merchant-configured mandate for their own cart.
**Root cause:** `processor/src/services/payment-behavior-resolver.ts` — the "third category" rationale added for `flowType` argues it is safe to resolve through `extractCountry` because it "moves no money, enables no payment rail, and chooses no destination for funds". That was assessed against what `flowType` does to the *initialization flow*; it did not account for `applyPiFirstOverride`, which arrived in the same commit and does change PaymentIntent parameters. The comment defers re-evaluation to "the enabler port", but the coupling is already here.
**Rule:** Anything that changes PaymentIntent parameters should read `cart.country` only — the same rule already applied to `bankTransfer` eligibility and `eu_bank_transfer.country`. Narrowing costs nothing measurable: real carts from the sample site carry `country: 'US'` at the top level (measured 2026-08-03), and `billingAddress` was **empty** on a completed checkout cart, so the fallback is not doing the work the comment credits it with.
**Scope:** Narrow. Requires a cart with no `cart.country`, a merchant rule keyed to the country the shopper types, and the merchant to have configured `payment_method_save_usage` or a rule-level `setupFutureUsage` for there to be anything to lose. No funds move and no destination changes. But it is shopper input defeating merchant configuration, which the resolver's own reasoning set out to prevent.
**Resolution:** Added `extractTrustedDiscriminator` and `resolveTrustedPaymentBehavior` — the same lookup without the billing fallback. `flowType` resolves through them at both call sites, kept identical so the `/config-element` response and the PaymentIntent can never disagree about which flow a cart is on. `captureMethod` and `setupFutureUsage` keep the wider discriminator. **The justification recorded here at the time — "they select policy, not PaymentIntent parameters" — was wrong and is retracted: both ARE PaymentIntent parameters.** The decision to keep them on the wider discriminator still stands, but on different grounds; see KI-048, which restates it and records the residual. **`bankTransfer` eligibility and `eu_bank_transfer.country` must use the trusted resolver when they arrive (P3).** The retracted reasoning was replaced rather than deleted, so the next reader comparing the two resolvers does not "restore parity" and reopen the hole.
**Implementation note:** Introduced by commit `139b685` (P1), resolved in `90110ef`.

---

## KI-047 (RESOLVED — commits `b22e657`, `a867e51`): The confirm gate validated the amount against a snapshot, not the current cart

**Problem:** `updatePaymentIntentStripeSuccessful` fetches the cart but uses it only for a log field. Its amount comparison reads `ctPayment.amountPlanned` — the value captured when the PaymentIntent was created — never the cart's current total. Under `deferred` that snapshot is milliseconds old, because the PaymentIntent is created at submit and confirmed immediately after. Under `pi_first` the PaymentIntent is created at Element **mount**, so the snapshot can be as old as the page.

`POST /shipping-methods/update` unfreezes the cart, changes the shipping rate and refreezes it. So:

```
mount           → PaymentIntent created for X, ctPayment.amountPlanned = X
shopper changes shipping → cart total becomes Y > X
confirm         → gate compares PI amount (X) against amountPlanned (X) → passes
result          → Authorization/Success for X on a cart worth Y
```

**Underpayment, undetected.** commercetools records the order as authorized for less than it is worth, and nothing flags the divergence.

**Excluding Express Checkout does not close it.** `/shipping-methods/update` and `/shipping-methods/remove` are HTTP endpoints with session auth, reachable from a Payment Element page in `pi_first` — not only from the express flow whose `shippingaddresschange` handler calls them.

**Root cause:** `processor/src/services/stripe-payment.service.ts` — the gate treats `amountPlanned` as authoritative for the cart's value. It is authoritative for *the payment*, which is a different thing once the two can drift.

**Rule:** Re-validate against the current cart total at confirm, not against the payment's snapshot — or refuse to confirm a PaymentIntent whose amount no longer matches the cart. Until then, **do not enable `pi_first`**: this is the second of the two open reasons recorded in `connect.yaml` and in `decisions/adr-010-pi-first-elements-initialization.md`, alongside KI-044.

**Reframes the open P0 decision.** P0 was scoped as a UX question — the frozen cart, the shopper who loses their items. With this it is also a financial-correctness question, which changes what is being decided and who should decide it.

**Implementation note:** Found while scoping the enabler port (P2, commit `3120046`); the defect itself predates it and exists under `deferred` too, with a window too narrow to exploit. Not introduced by P2 and not fixed by it.

**Resolution:** The gate now compares against the cart's own current total — `taxedPrice.totalGross` when tax has been calculated, `totalPrice` otherwise. This shipped together with the KI-044 freeze change and must not be reverted separately: the mount-time freeze was what prevented the divergence, so removing it without this would have traded a stuck cart for an underpayment window. **A first attempt used `ctCartService.getPaymentAmount` and was wrong** — that function also validates that the cart is still payable and throws `InvalidOperation` once it is fully paid, and this endpoint races the `payment_intent.succeeded` webhook, so when the webhook wins the cart already is. Observed live with `cartAmount` and `paidAmount` both 12300: the payment succeeded, the order was created, and only the browser's confirmation call returned 400 — which the storefront rendered as a spinner that never stopped. The `confirmPayments` catch now also logs its rejection reason; it previously swallowed the error entirely, which is why diagnosing this needed a second reproduction.

---

## KI-048: `captureMethod` is reachable from a shopper-typed billing country, and it does decide whether the rail exists

**Problem:** `captureMethod` and `setupFutureUsage` resolve through `resolvePaymentBehavior`, whose discriminator is `cart.country ?? cart.billingAddress?.country ?? store.key`. The billing country is data the merchant's storefront collects from the shopper. Because manual capture and an `off_session`/`on_session` mandate each remove `customer_balance` from the methods Stripe resolves, a shopper on a cart with no top-level `country` can turn bank transfer on or off for their own checkout by entering a billing country that matches a rule key. Same mechanism as KI-046, which was closed for `flowType`.

**Root cause:** `processor/src/services/stripe-payment.service.ts:493` and `:502` read the untrusted `behaviorRule`, while `flowType` and `euBankTransferCountry` (`:483`, `:536`) read `trustedRule`. The categorisation the resolver documented — "financially directive" fields go through the trusted lookup — does not match this split: `capture_method` and `setup_future_usage` are PaymentIntent parameters like the other two, so by the stated criterion they belong on the trusted side. KI-046's resolution note justified the split as "they select policy, not PaymentIntent parameters", which is false; `connect.yaml`'s own `STRIPE_PAYMENT_BEHAVIOR_RULES` description documents `captureMethod` as the bank-transfer enable switch.

**Why it is accepted rather than fixed:** three reasons, all recorded so the decision can be re-opened knowingly.
1. **Bounded choice.** The shopper can only select among rules the merchant authored; every reachable value is one the merchant already approved for a market of their own. They cannot introduce a value, only pick which merchant policy applies to them. This is the criterion that actually separates the two categories, and it is now the one written in `extractCountry`.
2. **Parity with `ct-connect-stripe-checkout`**, which resolves `captureMethod` from the same untrusted discriminator. Narrowing it here alone makes the two connectors behave differently for the same rules map, which is the property the port exists to preserve.
3. **The precondition does not hold today.** Real sample-site carts carry `country: 'US'` at the top level (measured 2026-08-03), so the billing fallback is not reached.

**Scope:** Narrow. Requires a cart with no `cart.country`, a merchant rule keyed to a country the shopper can type, and a rule value that differs from the flat env var. No funds move to a new destination and no banking data is chosen — that remains `euBankTransferCountry`'s exclusive risk, and it resolves through the trusted lookup.

**Rule:** If this is ever closed, move **both** `:493` and `:502` to `trustedRule` in the same change, and decide explicitly to diverge from checkout. Closing only one leaves the PaymentIntent with its capture policy and its save mandate resolved by different trust criteria, which is harder to reason about than either end state. The tests that currently pin the behaviour (`'resolves rule via billingAddress.country when cart.country is absent'`, `'a rule reached via store.key overrides capture_method'`) must be updated in the same commit.

**Implementation note:** Not introduced by SB3-207 — `captureMethod` predates it. Surfaced during review of the bank transfer work, when `connect.yaml` began documenting `captureMethod` as the enable switch for a payment rail, which is what made the previously-recorded justification false. Cross-reference KI-046.

---

## KI-049: "Awaiting funds" and "paid" are the same state to commercetools — a bank transfer counts as paid in full the moment instructions are issued

**Problem:** `payment_intent.requires_action` writes an `Authorization/Pending` for the full PaymentIntent amount, which is the correct choice (see below). But the connect-payments-sdk counts a `Pending` `Authorization` as an approved payment:

```js
// ct-cart.service.js — isPaymentApproved
(transaction.state === 'Success' || transaction.state === 'Pending') &&
(transaction.type === 'Authorization' || transaction.type === 'Charge')
```

`calculatePaymentAmount` then credits the **full** `amountPlanned`. So from the instant Stripe issues funding instructions — before a single cent has moved — `calculateTotalPaidAmount` reports the cart as paid in full, and `getPaymentAmount` throws `ErrorInvalidOperation('The cart has already been paid in full')`.

That method is on the hot path twice: `createPaymentIntent` (`stripe-payment.service.ts:504`) and `initializeCartPayment` (`:1139`), the latter being the `/config-element` endpoint. A shopper who reloads the payment page while waiting to make their transfer therefore receives an error instead of the widget — there is no frozen-cart guard ahead of it.

**Root cause:** Not a connector defect. commercetools' transaction model, as the SDK reads it, has no state between "authorized" and "paid": `Pending` and `Success` carry identical weight. The chain is real and was verified end to end — `handleCtPaymentCreation` links the CT Payment to `cart.paymentInfo` via `addCtPayment` (`ct-payment-creation.service.ts:86`), the payment starts at `Authorization/INITIAL` (which correctly does **not** count), and the `requires_action` webhook transitions it `INITIAL → Pending` through the SDK's own state machine.

**Scope — what this does NOT do,** stated explicitly because the mechanism reads worse than the impact:
- No money is lost and no amount is miscalculated.
- No double charge. The effect is to *prevent* a second payment against the same cart, which is protective rather than harmful.
- The order is correct once funds arrive: `payment_intent.succeeded` writes `Charge/Success` and the order is created normally.
- The `Authorization` simply stays `Pending` forever; `payment_intent.succeeded` writes only a `Charge`, and the `charge.succeeded` fixup promotes only from `INITIAL`, never from `PENDING`.

The user-visible symptom is an error on reload where a designed "awaiting your transfer" state belongs. That is UX and state modelling, not financial correctness.

**Why it is accepted rather than fixed:**
1. **The alternative is worse.** Writing `Charge/Success` at `requires_action` would book revenue that is not on the platform balance. The converter already documents why it does not reuse `populateAmount` there. Of the two available options, the current one is right.
2. **The identical mechanism is already in production.** `payment_intent.processing` (crypto/stablecoin, commit `84e3bb4`) writes the same `Authorization/Pending`, and that commit is an ancestor of `origin/composable`. SB3-207 does not introduce this; it makes it more frequent. Note the events do differ in meaning — `processing` means the shopper already sent funds, `requires_action` only means instructions were displayed and they may never transfer — so bank transfer stretches the same mechanism over a weaker signal.
3. Bank transfer ships disabled, so nothing reaches this path without `STRIPE_PAYMENT_FLOW=pi_first`.

**Rule:** Treat this as a **prerequisite for enabling `pi_first`**, alongside the orphaned-PaymentIntent gap already recorded in the CHANGELOG — it is the more concrete of the two. Closing it is a data-model decision (how "awaiting funds" is represented in commercetools), not a patch: do not "fix" it by changing the transaction type or state at `requires_action` without deciding that question first. This is also the concrete answer to the open product question of whether commercetools supports partial payment states — it does not distinguish them.

**Implementation note:** Surfaced during review of SB3-207. Pre-existing behaviour, shared with the crypto settlement path. Cross-reference KI-044 (abandoned carts) and KI-035.

---

## KI-050 (RESOLVED): ACH micro-deposit underpayment — cart not frozen, order created at the mutated total

**Problem:** ACH `us_bank_account` verified by micro-deposits leaves the cart editable while the debit settles (days), and the `payment_intent.succeeded` webhook created the order from the cart's **current** total regardless of what was paid. Reproduced live 2026-08-21: pay $6.99 → return and add $4000 of items → on micro-deposit settlement the order was created `Ordered` at $4000 while only $6.99 was collected.

**Root cause — three gaps aligning only on this rail:**
1. The confirm gate's amount validation (`stripe-payment.service.ts` `updatePaymentIntentStripeSuccessful`, status allowlist `['succeeded','requires_capture','processing']`) never runs: micro-deposits confirm to `requires_action` (`next_action.type = verify_with_microdeposits`).
2. The `requires_action` freeze covered only bank transfer (`isBankTransferNextAction` → `display_bank_transfer_instructions`); micro-deposits did not freeze, so the cart stayed editable.
3. `handlePaymentIntentSucceededFlow` only logged `amountMismatch` as a `warn` and created the order anyway.

This is the **residual** of KI-044 (freeze moved to each rail's commitment point — micro-deposits had none) and KI-047 (confirm gate validates the current total — but not for `requires_action`). Same family as boleto/OXXO/konbini/multibanco, which share gap 3.

**Resolution — two layers (see ADR-016):**
- **Layer 1 (backstop, universal):** `handlePaymentIntentSucceededFlow` now refuses to create the order unless `pi.amount === currentCartTotal.centAmount` **and** `pi.amount_received === pi.amount` **and** currency matches (`currentCartTotal = taxedPrice?.totalGross ?? totalPrice`, integer minor-unit comparison — correct for JPY too). On mismatch it logs `error` and returns; the `Charge/Success` already persisted upstream leaves a *paid-without-order* state for manual reconciliation. Also added an idempotency guard: an already-`Ordered` cart skips cleanly (mirrors the subscription path).
- **Layer 2 (freeze, ACH micro-deposit rail):** new `isMicrodepositNextAction` predicate (kept separate from `isBankTransferNextAction` so the 3DS/Boleto release-gates stay green); the `requires_action` handler now freezes for micro-deposits too.

**Accepted trade-offs:**
- No auto-refund on a blocked order (hub rule: divergence is surfaced, never auto-corrected) — the money-captured-without-order state is logged for reconciliation.
- Layer 2 inherits KI-044: an abandoned micro-deposit cart stays `Frozen` with no unfreeze-on-abandonment.
- Layer 2 covers only ACH micro-deposits; boleto/OXXO/etc. rely on Layer 1 for correctness (a follow-up may generalise the freeze).

**Implementation note:** `processor/src/services/stripe-payment.service.ts` (`handlePaymentIntentSucceededFlow`), `processor/src/utils.ts` (`isMicrodepositNextAction`), `processor/src/routes/stripe-payment.route.ts` (`handleBankTransferPendingEvent` guard). Extends `business-rules/payment-confirmation.md` Rule 5 to the async order-creation path. Cross-reference KI-044, KI-047.

---

## KI-051: `charge.updated` is never registered, so multicapture silently does nothing

**Problem:** `handleMulticaptureEvent` (`stripe-payment.route.ts:249-257`) routes `charge.updated` to `processStripeEventMultipleCaptured()`, but `charge.updated` is **not** in the `enabled_events` array in `connectors/actions.ts`. Stripe therefore never delivers it and the handler never runs. A merchant who sets `STRIPE_ENABLE_MULTI_OPERATIONS=true`, switches to `STRIPE_CAPTURE_METHOD=manual` and performs a second partial capture gets the capture in Stripe and **no** incremental `Charge/Success` transaction in commercetools. The feature reads as enabled from every configuration surface and produces nothing.

**Why it survived:** the handler, its tests and the documentation all exist and pass — nothing in the codebase asserts that a routed event is also a registered one. This is the general class KI-042 describes from the other direction: KI-042 is "the array is right but the endpoint update failed"; this is "the endpoint update succeeds and the array itself is missing the event".

**Rule:** An event with a route-dispatcher case must also appear in `enabled_events`, and the reverse. The two are a single contract; neither file is meaningful alone. This is already stated in `CLAUDE.md → What Claude Must Never Do`, which names `charge.updated` as the live example of the mismatch — a bug to fix, not a pattern to copy.

**Workaround:** add `charge.updated` to the webhook endpoint by hand in the Stripe Dashboard. Note that this is also required for existing deployments even after the code is fixed, per KI-042.

**Not yet fixed, and the fix is a judgement call, not a one-liner:** `charge.updated` is high-volume — it fires on many charge mutations, not only on a second capture. Registering it sends that stream to **every** deployment, including the default `STRIPE_ENABLE_MULTI_OPERATIONS=false` ones, where `handleMulticaptureEvent` logs one line and discards it. The options are to register it unconditionally and accept the noise, to register it only when multi-operations is enabled (which makes `enabled_events` config-dependent — new behavior for `actions.ts`), or to leave it manual and document it as a merchant step. Needs an owner.

**Implementation note:** `processor/src/connectors/actions.ts` (`enabled_events`), `processor/src/routes/stripe-payment.route.ts:249-257`. Cross-reference KI-042, KI-031, and `business-rules/multi-operations.md` Rule 1.

---

## KI-052: `Error freezing cart` at confirmation — order-creating webhook lands before the synchronous freeze (race)

**Problem:** On the synchronous card path, the order-creating webhook (`payment_intent.succeeded`) can land and create the CT order *before* the synchronous `/confirmPayments` freeze runs. The freeze then executes against an already-`Ordered` cart and logs `Error freezing cart at payment confirmation` ("cart not in active state"). Observed in 100% of the affected timing in the 2026-09-01 regression baseline (anomaly **A2**, 3DS scenario). **Non-fatal:** the payment succeeds and the order is Paid — the cart is already consumed by the order, so the freeze is moot.
**Root cause:** `processor/src/services/stripe-payment.service.ts:1022-1028` — `log.error('Error freezing cart at payment confirmation')`. A confirm↔webhook ordering race, not a logic bug; the two paths are not serialized. Same confirm↔webhook family as KI-047 (amount-gate), different failure point.
**Rule / status:** Known non-fatal race, surfaced for operator awareness — **do not treat the `Error freezing cart` log line as a payment failure.** Serializing confirm and webhook, or making the freeze tolerant of an already-`Ordered` cart, would remove the noise.
**Implementation note:** observed in the regression baseline 2026-09-01 (A2); `stripe-payment.service.ts:1022-1028`.

---

## KI-053: `Error getting payment mode` logged on every one-time checkout — non-fatal, falls back to `payment` mode

**Problem:** Every one-time (non-subscription) checkout logs a `log.error` `Error getting payment mode` with an empty `error:{}` payload. Observed in **100% of checkouts** in the 2026-09-01 regression baseline (anomaly **A7**). **Non-fatal:** the Payment Element mounts normally and the mode correctly falls back to `payment`.
**Root cause:** `processor/src/services/stripe-subscription.service.ts:847-862` — `getPaymentMode` calls `findSubscriptionLineItem`, which throws on any cart with no subscription line item (i.e. every one-time cart), and the catch logs `log.error` (`:859`) before falling back to `payment` mode. It is expected control flow logged at the wrong severity.
**Rule / status:** Known non-fatal noise. The context previously described `getPaymentMode` only as normal behavior (`adopter-guide.md`, ADR-010) without noting the per-checkout error log. Lowering the "no subscription line item" case from `log.error` to `log.debug`/`info` (or short-circuiting before the throw) would silence it — **do not alert on this log line.**
**Implementation note:** observed in the regression baseline 2026-09-01 (A7); `stripe-subscription.service.ts:847-862`, `log.error` at `:859`.

---

## KI-054 (RESOLVED): Subscription underpayment — `invoice.paid` minted a Paid order from a mutated cart with no amount comparison

**Problem:** An authenticated shopper, using their own cart and no privileged credentials, could be billed for one amount and receive an order for a larger one. Reported through an external bug bounty against v1.7.5 and reproduced live: **order created `Paid` for €70.00 while Stripe collected €20.00.** It scales with whatever is added to the cart after the first step.

**Chain, verified end to end:**
1. `POST /subscription` prices the first invoice once (`getAllLineItemPrices` → `add_invoice_items`) and freezes the cart as the only control. The freeze is best-effort — a failure is logged and the flow continues, which is KI-008, so it was never a reliable control.
2. `GET /shipping-methods/remove` (`removeShippingRate`, session auth only, reachable by the shopper for their own cart) unfreezes the cart and **by design never re-freezes** — the code says so explicitly. The cart is editable again while the invoice stays locked at its original amount.
3. `invoice.paid` → `createSubscriptionOrderFromCart` re-read the now-enlarged cart, `log.warn`ed that it was not frozen, and created the order `Paid` anyway. **Nothing compared what Stripe collected against the cart total.**

**Root cause — the guard existed and could not run.** `handlePaymentIntentSucceededFlow` has enforced exactly this comparison since KI-050 (ADR-016, `business-rules/payment-confirmation.md` Rule 5). But the webhook dispatcher deliberately drops subscription-invoice `payment_intent.succeeded` and `charge.*` events (`stripe-payment.route.ts:321-338`) because `invoice.paid` is the single source of truth for subscription money — correctly so, routing them would duplicate payments and orders. **The guard was therefore structurally unreachable from the subscription path.** This is the same defect class closed on one branch of the webhook handler and left open on the other, not a missing condition. KI-047 had already flagged `/shipping-methods/update` and `/shipping-methods/remove` as reachable attack surface — for the one-time flow only; the subscription flow was never revisited.

**Resolution:** `createSubscriptionOrderFromCart` now validates the amount actually collected (`invoice.amount_paid`, `invoice.currency`) against the cart the order is minted from — the **post-`updateCartAddress`** snapshot, since the address is shopper-controlled — and refuses to create the order on divergence, pinning the validated cart version via `expectedVersion` so a cart that moves after validation cannot still mint an order. Applied at the `invoice.paid` and `charge.succeeded` call sites; see ADR-017 for the scope decisions and for why the `paymentState: Failed` call site and recurring cycles are deliberately exempt. The comparison itself is the single shared `paidAmountMatchesTotal` (`src/utils.ts`) that the one-time guard also calls — a second implementation of the same check is precisely what produced this bug.

**Compared against `totalPrice`, NOT `taxedPrice.totalGross`** — deliberately, and unlike the one-time guard. The subscription invoice is assembled from Stripe Prices built off the line items' own price values plus the shipping price, and this connector sets neither `automatic_tax` nor a Stripe Tax calculation on the subscription path, so the invoice carries no tax. Using `totalGross` here would reject every legitimate order in a tax-on-top configuration — the KI-047 false-positive failure mode from the other direction. See KI-056 for the separate, pre-existing defect this exposed.

**Hard block is scoped, on purpose.** It applies only where the first invoice *must* equal the cart total: first cycle (`billing_reason: subscription_create`), `charge_automatically`, no trial, `amount_paid > 0`, and an invoice carrying no discounts. Every condition is read from Stripe-owned data, never from the cart — the cart is what the attack mutates. Outside that configuration a first invoice legitimately differs (trial, free anchor days, `send_invoice`, recurring cycles, coupon translation pending verification in `stripe-coupon.service.ts`), so the divergence is logged for reconciliation and the order is still created. **Do not widen the hard block on assumption** — each case needs measuring in staging first.

> **The discount exemption must be read from the invoice, never from the cart — this was caught as a self-inflicted bypass before merge.** The first implementation excluded carts whose `discountCodes` were non-empty, to avoid a false positive while the coupon translation in `stripe-coupon.service.ts` remains unverified. But `cart.discountCodes` is shopper-controlled at exactly the moment of the attack: the same commercetools call that enlarges the unfrozen cart can add a discount code, which switched the guard off and reproduced the original vulnerability in full. `invoice.discounts` / `invoice.total_discount_amounts` are fixed when the subscription is created and are the only evidence that a coupon was actually involved in what Stripe charged. Regression test: *"still blocks when the cart gained a discount code but the invoice carries none"*. The general rule — every condition of a guard must be immutable by the actor the guard defends against — is the whole reason the other four conditions read from the invoice and the subscription.

> **Reopened and re-closed 2026-09-17 — the discount exemption was attacker-selectable.** The paragraph
> above records that the exemption must be read from `invoice.discounts` rather than `cart.discountCodes`,
> and that is correct as far as it goes. What it missed is that a shopper decides whether their cart
> carries a discount code *before* the subscription is created, so any valid code puts `discounts` on the
> invoice and switches the hard block off for that subscription's whole life — after which this exact
> chain runs unimpeded. Reproduced against the shipped guard at the reporter's own figures: EUR 20.00
> collected, EUR 70.00 ordered. **"Immutable after creation" and "not chosen by the attacker" are
> different properties, and a guard condition needs the second.** Closed by sealing the cart total onto
> the subscription at creation and comparing the cart against it at `invoice.paid` — a question with no
> Stripe arithmetic in it, so the unverified coupon translation (KI-055) cannot make it misfire. The
> exemption itself stays, on its original and still-sound reasoning. See `business-rules/payment-confirmation.md`
> Rule 7 and the ADR-017 addendum.

**Accepted trade-off:** no auto-refund on a blocked order (hub rule: divergence is surfaced, never auto-corrected). The `Charge/Success` is already persisted upstream, so a block leaves a *paid-without-order* state for manual reconciliation.

**Not fixed here, deliberately:** `removeShippingRate` still unfreezes and never re-freezes. The amount guard is what closes the financial loss; the unfreeze only makes the attack convenient. Conditioning it on "a subscription is in flight" would leave a genuine Express Checkout canceller with a frozen cart — the KI-044 family — and pulls Express Checkout regression into scope. **Do not present a re-freeze as the fix:** the freeze is best-effort in at least four places (KI-008), and making it load-bearing repeats the mistake this bug exposed. Tracked separately; `workflows/process-shipping.md` now records that the cancel path is not a security boundary.

**Implementation note:** `processor/src/services/stripe-subscription.service.ts` (`createSubscriptionOrderFromCart`, `isFirstCycleAmountGuardApplicable`), `processor/src/utils.ts` (`paidAmountMatchesTotal`), `processor/src/services/stripe-payment.service.ts` (`paidAmountMatchesCart` now delegates). Extends `business-rules/payment-confirmation.md` — new Rule 6. Cross-reference KI-008, KI-044, KI-047, KI-050, KI-056. **Scope:** `ct-connect-stripe-composable` only — `ct-connect-stripe-checkout` has no `stripe-subscription.service.ts` and no `/shipping-methods/remove` route, verified on branch `ctCheckout`.

---

## KI-055 (RESOLVED): Discount-code usage cap never enforced — the connector reset the Stripe counter on every over-limit application

**Problem:** `getStripeCoupons` translated every discount code on a cart into a Stripe coupon without ever reading `DiscountCodeInfo.state`, and treated *any* unusable Stripe coupon as a signal to delete and recreate it on the same id. Since the Stripe coupon id **is** the CT discount code id, and Stripe permits reusing a deleted coupon's id with `times_redeemed` back at 0, a coupon that had reached `max_redemptions` was destroyed and reissued at the exact moment its limit engaged. The cap could never stop a redemption.

**Reproduced 2026-09-15** against CT project `stripe-subscription` + a Stripe test account, connector v4.0.1: a `maxApplications: 1` code discounted three consecutive subscriptions. From the second onwards, commercetools reported `MaxApplicationReached` and priced the cart at the full amount while Stripe charged the discounted amount for the same cart.

**Root cause:** two independent gaps in `processor/src/services/stripe-coupon.service.ts` that only combine into a defect together. (a) `DiscountCodeInfo.state` was read nowhere in `processor/src` — commercetools' verdict on whether a code applies was ignored entirely. (b) `validateDiscountCode()` returned `false` for any coupon with `valid: false` *before* comparing a single configuration field, and the caller's `else` branch read that as "the merchant edited the config" — so "spent" and "edited" were indistinguishable.

**Measured impact — and it is not the over-valued order the external report describes.** commercetools refuses to create an order from a cart carrying a capped code (`The discountCode '…' cannot be applied to the cart`). The third run ended with Stripe having collected the discounted amount on a real card, **zero CT orders**, and the cart left `Frozen` at the undiscounted total, with the CT payment recording both an `Authorization Success` at the cart total and a `Charge Success` at the collected amount. The handler catches that error and it is not retryable, so Stripe receives HTTP 200 and never redelivers — the state is permanent. The real outcome is money collected with nothing to fulfil or refund against: a reconciliation problem, worse than an over-valued order in that the shopper has paid for nothing, less bad in that no order is recorded at the wrong price. What is fully proven and is the core issue: a capped code can be redeemed without limit against subscription first invoices, and commercetools and Stripe disagree on the price of the same cart.

**Rule:** commercetools decides whether a discount code applies; the connector only honours that verdict. The Stripe coupon carries the price onto the invoice and is not an enforcement point. See `business-rules/coupon-sync.md` Rules 3-5 and `decisions/adr-018-ct-state-authority-coupon-price-vehicle.md`.

**Resolved (2026-09-17):** gated coupon translation on `DiscountCodeInfo.state === 'MatchesCart'`; split "is the coupon in sync" from "is the coupon usable" so only configuration divergence triggers delete-and-recreate; stopped mirroring `maxApplications` into `max_redemptions`. The gate shipped first, deliberately — fixing the reset without it turns the undercharge into a failed subscription creation for every capped code, which is a checkout outage. Legacy coupons still carrying a mirrored cap count as divergent and are replaced once, on first touch.

**Also closed by the same gate:** the separately reported `DoesNotMatchCart` coupon-state finding. Both coupon findings were communicated to the client as closing together.

**Not a backstop for this, verified:** the KI-054 subscription amount guard cannot catch it — CT blocks the order first, for an unrelated reason, and the guard exempts discounted invoices by design.

**Collateral observation from the run:** `DiscountCode.applicationCount` stayed `null` in the CT API throughout while the cap was fully enforced. It is not a usable readout; `DiscountCodeInfo.state` is.

**Implementation note:** `processor/src/services/stripe-coupon.service.ts` (`appliesToCart`, `resolveStripeCoupon`, `hasDivergentConfig`, `createStripeDiscountCode`, `deleteStripeDiscountCode`). Cross-reference KI-007 (resolved alongside), KI-016 (adjacent, deliberately excluded — its premise is corrected in place), KI-054, KI-057. **Scope:** `ct-connect-stripe-composable` only — `ct-connect-stripe-checkout` has no coupon service and no subscription path.

---

## KI-056: Subscription invoices never carry tax — in a tax-on-top configuration the merchant under-collects

**Problem:** A subscription's Stripe invoice is built by summing per-line `unit_amount` values taken from `lineItem.price.discounted?.value ?? lineItem.price.value` (`stripe-subscription.service.ts:428-438`) plus `shipping.price.centAmount` (`:642`). This connector sets **no** `automatic_tax`, no `tax_behavior`, no `tax_rates` anywhere in `processor/src`, and the Stripe Tax calculation reference (`connectorStripeTax_calculationReferences`) is read **only** in `stripe-payment.service.ts` — the one-time path. So the subscription invoice carries no tax line at all.

Where commercetools computes tax **on top of** the price (`taxedPrice.totalGross > totalPrice`, the typical US configuration), the shopper is charged the net amount and the tax is never collected. This is **not** the KI-054 exploit and needs no attacker: it happens with an entirely honest shopper on the first cycle.

**How it stayed invisible:** the connector's own `amountPlanned` for a subscription comes from `getPaymentAmount`, which returns `taxedPrice.totalGross ?? totalPrice` — so commercetools records the gross amount as planned while Stripe collects the net. The one-time flow does charge gross (Express Checkout explicitly presents net subtotal + tax + shipping, `stripe-shipping.service.ts:200-206`), which is why this is specific to subscriptions. **No subscription cart fixture in the test suite carries a `taxedPrice`**, and none of the subscription business rules mentions tax: the flow was built and tested only against untaxed carts.

**Found:** 2026-09-17, while establishing the correct comparison base for the KI-054 guard. It is the reason that guard compares against `totalPrice` — comparing against `totalGross` would have converted this pre-existing revenue gap into a mass rejection of legitimate orders.

**Status:** open, needs an owner. The fix is a design decision, not a patch: either carry the CT-computed tax onto the invoice as a line item, or enable Stripe Tax on the subscription path and reconcile it with what `ct-stripe-tax` writes to the cart. Direction of loss is the merchant's revenue, not the shopper's money — which is why it is not bundled into a security fix.

**Implementation note:** `stripe-subscription.service.ts:428-438` / `:642` (invoice assembly), `:340` (`amountPlanned` via `getPaymentAmount`), `business-rules/tax-integration.md` Rules 1-3 (one-time path only). Cross-reference KI-054.

---

## KI-057: `invoice.paid` writes its transactions with no dedupe guard — a redelivery appends a second set

**Problem:** `processSubscriptionEventPaid` builds a transaction list and writes it with a bare loop — `for (const tx of updateData.transactions) await this.ctPaymentService.updatePayment({ ...updateData, transaction: tx })` — with no check for whether a transaction of that type and `interactionId` is already on the payment. Processing the same `invoice.paid` twice appends the transactions twice.

**It is worse than a plain duplicate, because the second run takes a different branch.** `isPaymentChargePending` is read from the CT payment's *current* state, which the first run already mutated. On the first pass a pending charge yields a single `Charge`; on the second the charge is no longer pending, so the converter returns the `[Authorization, Charge]` pair instead (`subscriptionEventConverter.ts`, `populateTransactions`, `INVOICE_PAID` case). The payment ends with an asymmetric, non-obvious set rather than a clean duplicate — which is what was observed.

**Not only a replay artifact — reachable in production.** The observation came from a manual `invoice.paid` replay, but the same path opens without one: KI-003 / ADR-015 made `processSubscriptionEventPaid` re-throw retryable CT errors so that Stripe redelivers. The transaction loop runs *before* `createSubscriptionOrderFromCart`, so a retryable failure during order creation returns non-2xx **after** the transactions are already written. Stripe redelivers, the loop runs again, and the payment accumulates a second set. The fix that made delivery reliable is what makes this reachable.

**Root cause:** `processor/src/services/stripe-subscription.service.ts` — `processSubscriptionEventPaid`, the transaction write loop; no `hasTransactionInState` guard. The one-time payment path guards extensively before writing (`stripe-payment.service.ts:404-430`, `:1047-1052`, `:1289`, `:1362-1367`); the subscription path has no equivalent. Same defect class as KI-054: a guard present on one branch of the webhook handling and absent on the other.

**Rule:** A webhook handler that may be redelivered must be idempotent in its writes. Transactions must be keyed and checked before being appended, not appended unconditionally.

**Found:** 2026-09-17, while investigating a collateral observation from the KI-055 reproduction (two `Authorization` and two `Charge` transactions on one payment after a single `invoice.paid` replay).

**Status:** open, diagnosed but not fixed. Deliberately not bundled into the KI-055 coupon fix — different root cause, different area, and it needs its own regression coverage for the branch asymmetry above. Cross-reference KI-003, KI-054, ADR-015.
