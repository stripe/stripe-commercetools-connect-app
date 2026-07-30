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

## KI-003: `processSubscriptionEventPaid/Charged/Failed` all swallow errors → subscription webhook events permanently lost

**Problem:** `processSubscriptionEventPaid()`, `processSubscriptionEventCharged()`, and `processSubscriptionEventFailed()` at `processor/src/services/stripe-subscription.service.ts:1186, 1492, 1617` each have top-level try/catch blocks that log exceptions and return void. The route handler returns HTTP 200 to Stripe on any failure. Failed invoice processing (CT order creation failure, CT payment update failure) is permanently lost.
**Root cause:** `processor/src/services/stripe-subscription.service.ts:1186, 1492, 1617` — exceptions absorbed before reaching the route layer.
**Rule:** Subscription event handlers must propagate failures so Stripe retries delivery. See hub `known-issues.md` Issue 1.
**Implementation note:** A failed `invoice.paid` event means a recurring payment is processed in Stripe but no CT order or payment record is created. Merchants must reconcile manually.

---

## KI-004: `retrieveWebhookEndpoint()` and `updateWebhookEndpoint()` failures silently swallowed in post-deploy

**Problem:** At `processor/src/connectors/actions.ts:53` (`retrieveWebhookEndpoint()`) and `:65` (`updateWebhookEndpoint()`), errors from both calls are caught and logged only. If either the lookup or the update of the Stripe webhook endpoint fails during post-deploy, the deploy succeeds but the connector is registered at the stale webhook URL. All Stripe events for the new deployment are delivered to the old endpoint.
**Root cause:** `processor/src/connectors/actions.ts:53,65` — try/catch absorbs the Stripe error without re-throwing in either function.
**Rule:** Post-deploy failures that affect event delivery must abort the deploy. See hub `known-issues.md` Issue 4.

---

## KI-005: `addPaymentToOrder()` swallows CT update errors — payment record lost on order update failure

**Problem:** At `processor/src/services/stripe-payment.service.ts:967`, when `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING=addPaymentToOrder`, the CT order update call is wrapped in a try/catch that logs the error and returns void. A CT API failure during the `invoice.paid` handler means the payment was charged in Stripe but no payment record is added to the CT order.
**Root cause:** `processor/src/services/stripe-payment.service.ts:967` — CT update error suppressed, Stripe returns 200.
**Rule:** A successful Stripe charge must always produce a CT payment record. CT update errors must propagate so Stripe retries the event.

---

## KI-006: `resolvePaymentIdFromSubscription()` uses `setTimeout(2000)` race — subscription payment ID may not resolve before timeout

**Problem:** At `processor/src/services/stripe-subscription.service.ts:1425` (`resolvePaymentIdFromSubscription()`), the function polls for the Stripe payment ID using a `setTimeout(2000)` delay (`:1434`). If the Stripe subscription event delivers the payment ID after the 2-second timeout, the function resolves with `undefined` and the subsequent CT payment update skips the payment ID. The CT payment is created without an `interfaceId` linking it to Stripe.
**Root cause:** `processor/src/services/stripe-subscription.service.ts:1434` — polling via fixed timeout instead of retry loop or event-driven resolution.
**Rule:** Payment ID resolution must use a retry loop with exponential backoff and a maximum retry count, not a fixed timeout. A fixed 2-second timeout is not reliable under Stripe latency variance.
**Implementation note:** Results in CT payments without `interfaceId` — webhook matching for future events on that payment fails.

---

## KI-007: `coupons.del()` errors swallowed — next coupon creation attempt fails with duplicate key

**Problem:** At `processor/src/services/stripe-coupon.service.ts:75`, `stripe.coupons.del()` is called inside a try/catch that logs errors and continues. If the deletion fails (e.g., coupon still in use), the next `stripe.coupons.create()` with the same coupon ID fails with a duplicate key error. The CT discount is never synchronized to Stripe.
**Root cause:** `processor/src/services/stripe-coupon.service.ts:75` — deletion error absorbed; caller receives no signal that deletion failed.
**Rule:** Coupon deletion failures must be surfaced so the caller can skip creation or use a different ID strategy.

---

## KI-008: Cart freeze/unfreeze errors silently continued — subscription cart may be permanently frozen or unfrozen

**Problem:** At `processor/src/services/stripe-payment.service.ts:454`, `freezeCart()` and `unfreezeCart()` calls are wrapped in try/catch blocks with a `// Continue - do not break the payment flow if freeze fails` comment. A failure to freeze the cart after subscription creation leaves the cart in Active state — users can modify it, potentially corrupting an in-flight subscription.
**Root cause:** `processor/src/services/stripe-payment.service.ts:454` — freeze/unfreeze errors suppressed by design comment.
**Rule:** Cart freeze on subscription initiation is a critical state change. Failure must abort the operation, not continue silently. See `business-rules/subscription-lifecycle.md`.

---

## KI-009: `customer.subscription.deleted` not registered in `actions.ts` — subscription cancellation via Stripe Dashboard doesn't update CT

**Problem:** `StripeSubscriptionEvent.CUSTOMER_SUBSCRIPTION_DELETED` is declared in the enum at `processor/src/services/types/stripe-payment.type.ts:49` with a `//TODO when canceled subscription` comment, but is not registered in the `enabled_events` array in `processor/src/connectors/actions.ts:66`. Stripe never delivers this event. When a subscription is canceled via Stripe Dashboard (or by Dunning exhaustion), the CT cart remains frozen indefinitely.
**Root cause:** `processor/src/connectors/actions.ts:66` — event not in `enabled_events`; `processor/src/routes/stripe-payment.route.ts:137–186` — no route case for this event.
**Rule:** Every subscription lifecycle event that changes Stripe state must have a corresponding CT state update. See hub `feature-scope.md — Subscriptions`.
**Implementation note:** To implement: register `customer.subscription.deleted` in the `enabled_events` array, add a switch case in the route dispatcher, implement a handler that unfreezes the cart and clears `stripeConnector_stripeSubscriptionId`.

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

## KI-014: `billingAddressRequired` hardcoded to `true` in the enabler — billing address always collected

**Problem:** At `enabler/src/payment-enabler/payment-enabler-mock.ts:215`, `billingAddressRequired` is hardcoded to `true`. The `STRIPE_COLLECT_BILLING_ADDRESS` environment variable configures this at the processor level but the enabler ignores the processor response and always tells the Payment Element to collect billing address.
**Root cause:** `enabler/src/payment-enabler/payment-enabler-mock.ts:215` — hardcoded boolean, not read from processor config response.
**Rule:** The enabler must read `collectBillingAddress` from the processor's config response and pass it to the Payment Element.

---

## KI-015: `createNewCartFromOrder()` falls back to `currency: 'USD'` / `country: 'US'` when the source order lacks that data — not an unconditional hardcode

**Problem:** At `processor/src/services/stripe-subscription.service.ts:2200, 2203`, when creating a new cart from an order for a recurring payment, the code reads `originalOrder.totalPrice?.currencyCode` and `originalOrder.shippingAddress?.country || originalOrder.billingAddress?.country`, falling back to `'USD'` / `'US'` **only if the original order is missing that field**. For a normal CT order (which always has `totalPrice.currencyCode`), the correct currency is inherited — the fallback branch is a defensive default, not the code's primary behavior. It would only misfire for an order missing `totalPrice` or both address fields, which should not occur for orders this connector itself created.
**Root cause:** `processor/src/services/stripe-subscription.service.ts:2200, 2203` — `||` fallback to US defaults exists for a case that is not expected to occur in practice; worth removing or replacing with an explicit error if it's meant to be unreachable.
**Rule:** Cart creation during subscription renewal must inherit currency and country from the source order — which it already does. If the fallback ever fires in production, that indicates the source order is missing expected fields and should be investigated, not silently defaulted to US values.

---

## KI-016: Coupon `duration` hardcoded to `'once'` — all synced CT discounts become single-use Stripe coupons

**Problem:** At `processor/src/services/stripe-coupon.service.ts:66`, `stripe.coupons.create()` is called with `duration: 'once'` hardcoded. CT discount types (`forever`, `repeating`, `once`) are not mapped to Stripe coupon `duration`. All CT discounts sync to Stripe as coupons that apply only to the first invoice.
**Root cause:** `processor/src/services/stripe-coupon.service.ts:66` — hardcoded Stripe coupon duration.
**Rule:** CT discount `validUntil` and discount type must be mapped to Stripe coupon `duration` and `duration_in_months` fields. See `business-rules/coupon-sync.md`.

---

## KI-017: `getSavedPaymentConfig()` swallows JSON parse error — invalid `STRIPE_SAVED_PAYMENT_METHODS_CONFIG` silently ignored

**Problem:** At `processor/src/config/config.ts:9`, `getSavedPaymentConfig()` wraps `JSON.parse(env.STRIPE_SAVED_PAYMENT_METHODS_CONFIG)` in a try/catch that returns `undefined` on parse failure. If the env var contains malformed JSON, the connector starts without saved payment method configuration and no error is surfaced.
**Root cause:** `processor/src/config/config.ts:9` — parse error swallowed, fallback to undefined.
**Rule:** Configuration parse errors must be surfaced at startup, not silently ignored. An undefined saved payment config disables the feature without any operator notification.

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
