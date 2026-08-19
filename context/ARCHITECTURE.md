# Architecture — ct-connect-stripe-composable

Extends `ct-connect-stripe-checkout` with subscription billing, mixed carts (one-time + recurring items), price synchronization, coupon sync, and setup intents. Everything documented in [checkout's ARCHITECTURE.md](../../ct-connect-stripe-checkout/context/ARCHITECTURE.md) applies here unless explicitly overridden below.

## What's Different from Checkout

| Capability | Checkout | Composable |
| --- | --- | --- |
| Payment model | One-time charges | One-time + recurring subscriptions |
| Cart lifecycle | Active until order | **Frozen at payment commitment** — confirmation for instant rails, funding-instruction issuance for bank transfer, subscription initiation for subscriptions |
| Payment method capture | Direct via PaymentIntent | Also via SetupIntent (save now, charge later) |
| Webhooks handled | `payment_intent.*`, `charge.*` | + `invoice.paid`, `invoice.payment_failed`, `invoice.upcoming`, `charge.refunded` (always registered), `charge.captured` (always registered), `payment_intent.requires_action` (bank transfer only, gated on `next_action.type`), `payment_intent.partially_funded` (interface interaction only, no CT transaction), `customer_cash_balance_transaction.created` (observability only), `payment_intent.processing` (async settlement, e.g. crypto/stablecoin → `Authorization/Pending`). `charge.succeeded` for a subscription invoice is registered but deliberately **dropped** (`isFromSubscriptionInvoice()` guard) — `invoice.paid` is the sole source of truth for recurring payments, see `business-rules/recurring-billing.md` Rule 4. `customer.subscription.deleted` declared in code but NOT registered — no handler (TODO). `charge.updated` route handler exists but NOT registered in `actions.ts` enabled events. |
| Order creation | Once per cart | Configurable: once or per recurring event |
| Price management | Not applicable | CT → Stripe price sync (optional) |
| Customer API | Session only | + Subscription management endpoints |

---

## Additional Components

### Processor internals (additions to checkout)

| Layer | Path | Purpose |
| --- | --- | --- |
| Service | `src/services/stripe-subscription.service.ts` | All subscription logic (2,300+ lines): creation, cancellation, update, price sync, recurring invoice handling |
| Service | `src/services/stripe-coupon.service.ts` | CT discount → Stripe coupon sync |
| Service | `src/services/stripe-shipping.service.ts` | Express Checkout shipping address and rate sync |
| Service | `src/services/ct-payment-creation.service.ts` | CT payment object creation for subscription flows |
| Service | `src/services/stripe-customer.service.ts` | Customer session by Stripe ID |
| Mapper | `src/mappers/subscription-mapper.ts` | Product variant attributes → Stripe subscription params |
| Converter | `src/services/converters/subscriptionEventConverter.ts` | Stripe invoice events → CT transactions |
| Price client | `src/services/commerce-tools/price-client.ts` | CT product/price lookups for sync |
| Cart client | `src/services/commerce-tools/cart-client.ts` | Adds `freezeCart()` / `unfreezeCart()` |
| Routes | `src/routes/stripe-subscription.route.ts` | Subscription creation and management |
| Routes | `src/routes/stripe-customer.route.ts` | Customer session by Stripe ID |

---

## Additional API Endpoints

### Subscription creation (`stripe-subscription.route.ts` — SessionHeader auth)

| Endpoint | Purpose |
| --- | --- |
| `POST /setupIntent` | Creates Stripe SetupIntent to save payment method without charging |
| `POST /subscription` | Creates subscription from cart; freezes cart; returns `clientSecret` |
| `POST /subscription/withSetupIntent` | Creates subscription using a previously saved payment method |
| `POST /subscription/confirm` | Confirms subscription after client-side Stripe confirmation |

### Subscription management (OAuth2 auth)

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /subscription-api/:customerId` | OAuth2 | Lists customer's active Stripe subscriptions |
| `DELETE /subscription-api/:customerId/:subscriptionId` | OAuth2 + Authorization | Cancels subscription in Stripe (does NOT update CT — see `known-issues.md` KI-010) |
| `POST /subscription-api/:customerId` | OAuth2 + Authorization | Updates subscription to new variant/price |
| `POST /subscription-api/advanced/:customerId` | OAuth2 + Authorization | Advanced subscription update (raw Stripe params) |

### Shipping (`stripe-shipping.route.ts` — SessionHeader auth)

| Endpoint | Purpose |
| --- | --- |
| `POST /shipping-methods` | Fetches CT shipping methods for an address; used by Express Checkout |
| `POST /shipping-methods/update` | Updates selected shipping rate on CT cart |
| `GET /shipping-methods/remove` | Removes shipping selection from CT cart |

### Customer session (`stripe-customer.route.ts`)

| Endpoint | Purpose |
| --- | --- |
| `GET /customer/session?stripeCustomerId=cus_xxx` | Returns stored Stripe customer for a known Stripe ID |

---

## CT Data Model (additions to checkout)

### Custom types installed by `post-deploy`

| Custom type | Applied to | Purpose |
| --- | --- | --- |
| `payment-connector-subscription-information` (`CT_PRODUCT_TYPE_SUBSCRIPTION_KEY`) | Product type | Subscription attributes on product variants — 15 attributes with `stripeConnector_` prefix |
| `payment-connector-subscription-line-item-type` (`CT_CUSTOM_TYPE_SUBSCRIPTION_LINE_ITEM_KEY`) | Line item | Fields: `stripeConnector_productSubscriptionId`, `stripeConnector_stripeSubscriptionId`, `stripeConnector_stripeSubscriptionError` |
| `payment-connector-stripe-customer-id` (`CT_CUSTOM_TYPE_STRIPE_CUSTOMER_KEY`) | Customer | Stores `stripeConnector_stripeCustomerId` |
| `payment-launchpad-purchase-order` (`CT_CUSTOM_TYPE_LAUNCHPAD_PURCHASE_ORDER_KEY`) | Payment | Existence check only — must be pre-created by merchant; fields: `launchpadPurchaseOrderNumber`, `launchpadPurchaseOrderInvoiceMemo` |

**Post-deploy product type lifecycle risk:** `updateProductType()` uses delete-then-create. If create fails after delete, the product type is permanently removed from the CT project. See `known-issues.md` KI-012.

### Subscription product type attributes

Products used as subscription items must belong to a product type with these attributes:

| Attribute | Required | Values |
| --- | --- | --- |
| `stripeConnector_recurring_interval` | Yes | `day`, `week`, `month`, `year` |
| `stripeConnector_recurring_interval_count` | Yes | integer |
| `stripeConnector_off_session` | Yes | boolean |
| `stripeConnector_collection_method` | Yes | `charge_automatically`, `send_invoice` |
| `stripeConnector_description` | No | string |
| `stripeConnector_trial_period_days` | No | integer — **mutually exclusive with `trial_end_date`** |
| `stripeConnector_trial_end_date` | No | datetime — **mutually exclusive with `trial_period_days`** |
| `stripeConnector_billing_cycle_anchor_day` | No | integer (1–31) |
| `stripeConnector_billing_cycle_anchor_time` | No | string (HH:MM UTC) |
| `stripeConnector_billing_cycle_anchor_date` | No | datetime — overrides day + time |
| `stripeConnector_cancel_at_period_end` | No | boolean |
| `stripeConnector_cancel_at` | No | datetime |
| `stripeConnector_proration_behavior` | No | `none`, `create_prorations`, `always_invoice` |
| `stripeConnector_days_until_due` | No | integer (only when `collection_method=send_invoice`; default: 1) |
| `stripeConnector_missing_payment_method_at_trial_end` | No | `cancel`, `create_invoice`, `pause` |

### Stripe metadata fields written by this connector

| Field | On | Value |
| --- | --- | --- |
| `subscription_id` | Stripe Subscription item metadata | CT subscription line item custom field value |
| `ct_price_id` | Stripe Price metadata | CT price ID |
| `ct_variant_sku` | Stripe Price metadata | CT variant SKU |
| `ct_shipping_price_amount` | Stripe Price metadata | CT shipping cost in cents |
| `cart_id` | Stripe objects | CT cart ID |
| `ct_project_key` | Stripe objects | CT project key |
| `ct_payment_id` | Stripe objects | CT payment ID |
| `ct_customer_id` | Stripe objects | CT customer ID |
| `ct_product_id` | Stripe objects | CT product ID |
| `ct_order_id` | Stripe objects | CT order ID |

---

## Webhook Event Subscriptions

Events registered in `processor/src/connectors/actions.ts` (in addition to checkout events):

| Event | Handled | Effect |
| --- | --- | --- |
| `invoice.paid` | ✅ | Creates CT order or adds payment per `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING` |
| `invoice.payment_failed` | ✅ | Updates CT payment state |
| `invoice.upcoming` | ✅ | Triggers price sync when `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true` |
| `charge.succeeded` (subscription invoice) | ⚠️ Registered, deliberately dropped | `isFromSubscriptionInvoice()` guard in `stripe-payment.route.ts` stops it before processing — `invoice.paid` is the single source of truth for recurring payments (`business-rules/recurring-billing.md` Rule 4), avoiding the duplicate CT payments/orders this used to cause |
| `charge.refunded` | ✅ Always registered | Multi-refund behavior |
| `charge.captured` | ✅ Always registered | Multi-capture behavior |
| `payment_intent.requires_action` | ✅ Handled — bank transfer only | Three-way gate in `stripe-payment.route.ts`. Subscription-invoice events log and stop. Otherwise `isBankTransferNextAction()` (`utils.ts`) decides: only a PI whose `next_action.type` is exactly `display_bank_transfer_instructions` **and** that carries the instructions object reaches `processStripeEvent`, writing one `Authorization/Pending` for the **full `pi.amount`** — never `populateAmount()`, which reads `amount_received` (0 while awaiting funds). Card 3DS (`use_stripe_sdk`, `redirect_to_url`) and Boleto (`boleto_display_details`) fail the predicate and keep their pre-existing log-only path; the predicate fails closed on a `null`/unrecognized `next_action`. Release-gate tested. |
| `payment_intent.partially_funded` | ✅ Handled — no CT transaction | Same three-way gate as `requires_action`. Writes **zero** transactions by design (`business-rules` rationale: a second Pending breaks the dedup invariant; a partial `Charge/Success` books revenue not on the platform balance; `Charge/Pending` collides with KI-019). Persists only the interface interaction, via `ZERO_TRANSACTION_PERSIST_EVENTS` — the nested `Authorization Initial→Success` fixup in that branch stays scoped to `charge.succeeded`. Errors are swallowed and 200 returned deliberately (KI-035). |
| `customer_cash_balance_transaction.created` | ✅ Registered — observability only | Never reaches `processStripeEvent`; `convert()` throws if it ever does. `logCustomerCashBalanceTransaction` logs a field-by-field payload — `funding_reversed` / `adjusted_for_overdraft` at `log.error`, everything else at `log.info`. The raw event is never logged: the payload carries `sender_name`, `iban_last4`, `account_number_last4` and `sort_code`. **No CT write of any kind** — see `failure-modes.md`. |
| `payment_intent.processing` | ✅ Handled | Async settlement (crypto/stablecoin): writes `Authorization/Pending`; resolved by `payment_intent.succeeded` (→ Success) or `payment_intent.payment_failed`/`canceled` (→ Failure). Guarded against out-of-order/duplicate events (`hasTransactionInState`) — the guard is now shared with `requires_action` via `ASYNC_PENDING_EVENTS`, and both re-throw on CT write failure so Stripe retries. |
| `customer.subscription.deleted` | ❌ NOT registered | Declared in `StripeSubscriptionEvent` enum; marked as TODO; no route handler |
| `charge.updated` | ❌ Route handler exists, NOT registered | Must be manually added to `actions.ts` enabled events |

---

## Enabler (Frontend)

The enabler extends the checkout enabler with subscription payment modes.

### Entry point

`enabler/src/main.ts` re-exports `MockPaymentEnabler` (as `Enabler`). `DropinEmbeddedBuilder` is used internally but not re-exported.

### Payment modes

| Mode | `paymentMode` value | Flow |
| --- | --- | --- |
| One-time | `payment` | `getPayment()` → `confirmStripePayment()` → `confirmPaymentIntent()`. The confirm gate (`updatePaymentIntentStripeSuccessful`) retrieves the real PI (fail-closed), validates status (`succeeded`/`requires_capture`/`processing`) plus amount/currency, and returns `APPROVED` (HTTP 200) or — when the PI is still `processing` (async settlement) — `PENDING` (HTTP 202) after writing `Authorization/Pending`. |
| Subscription | `subscription` | `createSubscription()` → `confirmStripePayment()` → `confirmSubscriptionPayment()` |
| Setup intent | `setup` | `createSetupIntent()` → `confirmStripeSetupIntent()` → `createSubscriptionFromSetupIntent()` → `confirmSubscriptionPayment()` |

### Initialization sequence

```text
getConfigData(paymentElementType)        # fetches appearance, layout, publishableKey from processor
getCustomerOptions()                     # fetches stripeCustomerId, ephemeralKey, sessionId
loadStripe(publishableKey)               # loads Stripe.js
elements({ customer, appearance, ... })  # creates Stripe Elements instance
elements.create('payment' | 'expressCheckout', elementOptions)
element.mount('#target')
```

### Express Checkout event flow (additions)

| Stripe event | Processor call | Effect |
| --- | --- | --- |
| `shippingaddresschange` | `POST /shipping-methods` | Fetch CT shipping methods for address |
| `shippingratechange` | `POST /shipping-methods/update` | Update selected shipping rate on CT cart |
| `cancel` | `GET /shipping-methods/remove` | Remove shipping selection |

---

## Stripe Tax Integration

This connector reads Stripe Tax calculation references from the CT cart when `ct-stripe-tax` is deployed in the same CT project.

| Constant | CT field | Direction |
| --- | --- | --- |
| `CT_CUSTOM_FIELD_TAX_CALCULATIONS` | `connectorStripeTax_calculationReferences` | Read-only (written by `ct-stripe-tax`) |

The field is a `String[]` of Stripe Tax calculation IDs. If absent or empty, the connector proceeds without tax. See `business-rules/tax-integration.md`.

---

## Launchpad B2B Integration

The `payment-launchpad-purchase-order` custom type must be **pre-created by the merchant** in CT before deploy — the connector checks for its existence on deploy but does not create it.

| Field | Type | Purpose |
| --- | --- | --- |
| `launchpadPurchaseOrderNumber` | String | Purchase order number from the buyer |
| `launchpadPurchaseOrderInvoiceMemo` | String | Memo line for the generated invoice |

Fields are optional — B2C payments carry no Launchpad data. See `business-rules/launchpad-integration.md`.

---

## Additional Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED` | `false` | When `true`, syncs CT product price changes to Stripe on `invoice.upcoming`. High-risk: misconfiguration silently changes prices on active subscriptions. |
| `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING` | `createOrder` | `createOrder`: new CT order per recurring event. `addPaymentToOrder`: adds payment to existing order. |
| `CT_CUSTOM_TYPE_SUBSCRIPTION_LINE_ITEM_KEY` | `payment-connector-subscription-line-item-type` | Custom type key for subscription line items. |
| `CT_PRODUCT_TYPE_SUBSCRIPTION_KEY` | `payment-connector-subscription-information` | Product type key identifying subscription products. |
| `STRIPE_ENABLE_MULTI_OPERATIONS` | `false` | When `true`, enables multicapture and multirefund. Requires multicapture enabled in Stripe account. |
| `STRIPE_CAPTURE_METHOD` | `automatic` | `automatic` or `manual`. Note `manual` excludes `customer_balance`, `us_bank_account` and `crypto` from the resolved payment method list (measured). |
| `STRIPE_PAYMENT_FLOW` | `deferred` | Stripe Elements initialization strategy — `deferred` or `pi_first`, case-sensitive. See "Elements initialization strategies" below. An invalid value **aborts startup** (and the post-deploy step, which imports the same config); blank or whitespace reads as unset. Change requires redeployment. **Processor side only today — do not set `pi_first`**, see the caveat below. |
| `STRIPE_PAYMENT_BEHAVIOR_RULES` | _(empty)_ | Optional JSON map from cart country or CT store key to per-cart overrides of `flowType`, `captureMethod`, `setupFutureUsage` and `bankTransfer`. Exceptions only — the flat variables are always the default and there is no wildcard key. Malformed JSON, an unknown field or an invalid value **aborts startup**. A matching rule's field wins over the flat variable; a rule that omits a field falls back to it. Two discriminators by trust level: policy fields (`captureMethod`, `setupFutureUsage`) resolve through `cart.country` → `cart.billingAddress.country` → `cart.store.key`; fields that change PaymentIntent parameters (`flowType` today, `bankTransfer` when it arrives) resolve through `cart.country` → `cart.store.key` only, because billing country is shopper-supplied (KI-046). A rule may not set both `flowType: 'pi_first'` and an `off_session`/`on_session` `setupFutureUsage` — that aborts startup (KI-045). |
| `STRIPE_API_VERSION` | `2025-12-15.clover` | Stripe API version sent on all requests. |
| `STRIPE_LAYOUT` | `{"type":"tabs","defaultCollapsed":false}` | Payment Element layout config (JSON string). |
| `STRIPE_APPEARANCE_PAYMENT_ELEMENT` | _(empty)_ | Custom CSS appearance config for the Payment Element (JSON string). |
| `STRIPE_APPEARANCE_EXPRESS_CHECKOUT` | _(empty)_ | Custom CSS appearance config for Express Checkout (JSON string). |
| `STRIPE_COLLECT_BILLING_ADDRESS` | `auto` | `auto`, `never`, or `required`. |
| `STRIPE_SAVED_PAYMENT_METHODS_CONFIG` | _(empty)_ | JSON config for saved payment method visibility. Parse errors are silently swallowed — see `known-issues.md` KI-017. Its `payment_method_save_usage` key is the value `pi_first` suppresses at the Elements level; it is **not** set in the in-repo environment, but `connect.yaml`'s own example includes it. |

---

## Elements Initialization Strategies

`STRIPE_PAYMENT_FLOW` (or a rule's `flowType`) selects how the enabler initializes Stripe Elements.

| | `deferred` — default | `pi_first` — implemented end to end |
| --- | --- | --- |
| `elements()` receives | `{ mode, amount, currency, appearance, captureMethod, … }`, no `clientSecret` | `{ clientSecret }` from a PaymentIntent created **before** mount |
| PaymentIntent created | at submit, via `GET`/`POST /payments` | eagerly, before the Element renders |
| Compatible with | every payment method currently in scope | required by methods that must bind to a PaymentIntent before rendering — bank transfers (`customer_balance`) and BLIK |

**Why `pi_first` exists.** Stripe's bank transfer documentation requires Elements initialized with a
`clientSecret` and states the deferred flow is unsupported. Measured on a developer account: a
PaymentIntent created with `automatic_payment_methods` **and** a customer does include
`customer_balance`, yet the deferred Element shows no bank-transfer tab even with an authenticated
cart, a resolved Stripe Customer, `capture_method: automatic` and `setup_future_usage` unset. The
initialization flow is the cause, not the PaymentIntent configuration.

### `pi_first` is implemented end to end — and ships disabled

Both sides exist: the processor resolves `flowType` and creates the PaymentIntent before mount
(`139b685`), and the enabler reads it from `/config-element` and initialises Elements with the
`clientSecret` (`3120046`). Verified live on 2026-08-06 — a German EUR cart rendered the bank transfer
tab and Stripe returned a German IBAN for a connector-supplied
`eu_bank_transfer: {country: "DE"}`.

**It is still off by default**, and enabling it should be a deliberate decision rather than a side
effect of deploying. `STRIPE_PAYMENT_FLOW` is unset in `connect.yaml` and an unset value means
`deferred`.

**Two consequences of moving PaymentIntent creation to mount**, both since resolved, are worth knowing
because they explain code that would otherwise look arbitrary:

- **The cart is no longer frozen at PaymentIntent creation.** Under `deferred` the PaymentIntent was
  created at submit, so freezing there was harmless. Under `pi_first` it is created at mount, which
  froze the cart before the shopper chose anything and left no way back — KI-044, resolved. Each rail
  now freezes at its own commitment point: instant rails in `updatePaymentIntentStripeSuccessful`, bank
  transfer in the `payment_intent.requires_action` handler. The split is forced rather than chosen —
  a bank transfer confirm returns `requires_action`, which the confirm gate's status allowlist rejects,
  and the enabler does not call that endpoint on this path.
- **Confirmation validates the cart's live total**, not the amount snapshot taken at creation. Under
  `deferred` the snapshot was milliseconds old; under `pi_first` it can be as old as the page, and the
  shipping-methods endpoints can move the total inside that window — KI-047, resolved. This is what
  makes the freeze change safe, and the two must not be reverted separately.

**Still open:** the PaymentIntent and commercetools Payment created at mount are orphaned when a
shopper abandons the page. Carts are no longer affected; the Stripe-side litter needs a deterministic
idempotency key at creation.

### Response shape

`GET /config-element/:payment` returns `flowType` unconditionally. The field is declared on
`ConfigElementResponseSchema`, which is the Fastify 200 response schema for that route — Fastify strips
properties a response schema does not declare, so without the declaration the service would return the
field and the wire would silently drop it. The TypeScript type alone is not sufficient; both come from
the same object, and only the schema registration puts the field on the wire.

The subscription path cannot reach the suppression on the PaymentIntent: `StripeSubscriptionService`
never calls `resolvePaymentBehavior` and does not touch `setup_future_usage` at all (verified by grep).
It runs its own SetupIntent flow with `usage: off_session | on_session`, a distinct parameter on a
distinct object. `initializeCartPayment` **does** serve subscription carts, but what it suppresses there
is the widget's save-for-future-use hint, not the mandate that establishes the recurring charge.

---

## Out of Scope (Composable-Specific)

| Feature | Status |
| --- | --- |
| Subscription pause | Not implemented |
| Free trial without collecting a payment method | Payment method required at subscription creation |
| `customer.subscription.deleted` webhook | Declared in code, not registered, no handler — TODO |
| Subscription quantity changes | Not documented or implemented |
| `charge.updated` event for subscriptions | Route handler exists but not registered — requires manual addition to `actions.ts` |

For the full list of unsupported Stripe features shared with the checkout connector, see `../../ct-connect-stripe-checkout/context/ARCHITECTURE.md → Out of Scope`.
