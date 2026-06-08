# Architecture — ct-connect-stripe-composable

Extends `ct-connect-stripe-checkout` with subscription billing, mixed carts (one-time + recurring items), price synchronization, coupon sync, and setup intents. Everything documented in [checkout's ARCHITECTURE.md](../../ct-connect-stripe-checkout/context/ARCHITECTURE.md) applies here unless explicitly overridden below.

## What's Different from Checkout

| Capability | Checkout | Composable |
| --- | --- | --- |
| Payment model | One-time charges | One-time + recurring subscriptions |
| Cart lifecycle | Active until order | **Frozen after subscription initiation** |
| Payment method capture | Direct via PaymentIntent | Also via SetupIntent (save now, charge later) |
| Webhooks handled | `payment_intent.*`, `charge.*` | + `invoice.paid`, `invoice.payment_failed`, `invoice.upcoming`, `charge.succeeded` (recurring), `charge.refunded` (always registered), `charge.captured` (always registered), `payment_intent.requires_action` (logged only). `customer.subscription.deleted` declared in code but NOT registered — no handler (TODO). `charge.updated` route handler exists but NOT registered in `actions.ts` enabled events. |
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
| `charge.succeeded` (recurring) | ✅ | Handled for subscription renewal charges |
| `charge.refunded` | ✅ Always registered | Multi-refund behavior |
| `charge.captured` | ✅ Always registered | Multi-capture behavior |
| `payment_intent.requires_action` | ⚠️ Logged only | No CT update |
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
| One-time | `payment` | `getPayment()` → `confirmStripePayment()` → `confirmPaymentIntent()` |
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
| `STRIPE_CAPTURE_METHOD` | `automatic` | `automatic` or `manual`. |
| `STRIPE_API_VERSION` | `2025-12-15.clover` | Stripe API version sent on all requests. |
| `STRIPE_LAYOUT` | `{"type":"tabs","defaultCollapsed":false}` | Payment Element layout config (JSON string). |
| `STRIPE_APPEARANCE_PAYMENT_ELEMENT` | _(empty)_ | Custom CSS appearance config for the Payment Element (JSON string). |
| `STRIPE_APPEARANCE_EXPRESS_CHECKOUT` | _(empty)_ | Custom CSS appearance config for Express Checkout (JSON string). |
| `STRIPE_COLLECT_BILLING_ADDRESS` | `auto` | `auto`, `never`, or `required`. |
| `STRIPE_SAVED_PAYMENT_METHODS_CONFIG` | _(empty)_ | JSON config for saved payment method visibility. Parse errors are silently swallowed — see `known-issues.md` KI-017. |

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
