# Feature Scope — ct-connect-stripe-composable

What this connector supports, what it does not support, and what is partially supported or has known gaps. An LLM consulting this document should answer "not in scope for this connector" rather than inferring from general Stripe knowledge.

This connector extends `ct-connect-stripe-checkout`. Everything supported there is also supported here unless explicitly overridden. This document focuses on additions and differences.

For the base feature set (one-time payments, Payment Element, Express Checkout, refunds, Stripe Tax integration), see `../../ct-connect-stripe-checkout/context/feature-scope.md`.

---

## Payment Models

| Feature | Status | Notes |
| --- | --- | --- |
| One-time payments | ✅ Supported | Inherited from checkout connector |
| Subscriptions (recurring billing) | ✅ Supported | Core addition of this connector |
| Mixed carts (subscription + one-time items) | ✅ Supported | One-time items billed on first subscription invoice; see `business-rules/mixed-carts.md` |
| SetupIntent (save payment method, charge later) | ✅ Supported | `POST /setupIntent` then `POST /subscription/withSetupIntent` |
| Guest checkout | ✅ Supported | Inherited |
| Saved payment methods | ✅ Supported | Inherited |

---

## Subscription Features

| Feature | Status | Notes |
| --- | --- | --- |
| Create subscription from cart | ✅ Supported | `POST /subscription`; freezes CT cart on creation |
| Cancel subscription | ✅ Supported | `DELETE /subscription-api/:customerId/:subscriptionId` — cancels in Stripe only; CT not updated (see `known-issues.md` KI-010) |
| Update subscription (new variant/price) | ✅ Supported | `POST /subscription-api/:customerId` |
| List active subscriptions for customer | ✅ Supported | `GET /subscription-api/:customerId` |
| Trial periods | ✅ Supported | Via `stripeConnector_trial_period_days` or `stripeConnector_trial_end_date` (mutually exclusive) |
| Billing cycle anchor | ✅ Supported | `stripeConnector_billing_cycle_anchor_day`, `_time`, `_date` attributes |
| Cancel at period end | ✅ Supported | `stripeConnector_cancel_at_period_end` attribute |
| Cancel at specific date | ✅ Supported | `stripeConnector_cancel_at` attribute |
| Proration on plan change | ✅ Supported | `stripeConnector_proration_behavior`: `none`, `create_prorations`, `always_invoice` |
| Invoice collection method | ✅ Supported | `charge_automatically` or `send_invoice` |
| Behavior when trial ends without payment method | ✅ Supported | `stripeConnector_missing_payment_method_at_trial_end`: `cancel`, `create_invoice`, `pause` |
| **Subscription pause** | ❌ Not supported | Not available as a management operation |
| **Free trial without payment method collection** | ❌ Not supported | Payment method required at subscription creation |
| Subscription quantity changes | ❌ Not documented | Not covered in business rules or implemented endpoints |

---

## Webhook Events

Events registered in `processor/src/connectors/actions.ts` (in addition to checkout events):

| Event | Handled | Effect |
| --- | --- | --- |
| `invoice.paid` | ✅ | Creates CT order or adds payment per `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING` |
| `invoice.payment_failed` | ✅ | Updates CT payment state |
| `invoice.upcoming` | ✅ | Triggers price sync when `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true` |
| `charge.succeeded` (recurring) | ✅ | Handled for subscription renewal charges |
| `charge.refunded` | ✅ Always registered | Registered unconditionally; multirefund behavior |
| `charge.captured` | ✅ Always registered | Registered unconditionally; multicapture behavior |
| `payment_intent.requires_action` | ⚠️ Logged only | Not fully handled; no CT update |

Events **declared in code but NOT registered** (Stripe does not deliver them):

| Event | Status | Notes |
| --- | --- | --- |
| `customer.subscription.deleted` | ❌ Not registered, no handler | Declared in `StripeSubscriptionEvent` enum; marked as TODO — frozen carts not unfrozen when Stripe cancels |
| `charge.updated` | ❌ Route handler exists, not registered | Must be manually added to `actions.ts` enabled events |

Events **not registered** (same as checkout):

| Event | Status |
| --- | --- |
| `charge.dispute.*` | ❌ Not registered — disputes are manual |

---

## Price Synchronization

| Feature | Status | Notes |
| --- | --- | --- |
| CT price → Stripe subscription price sync | ✅ Opt-in | `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true`; triggered on `invoice.upcoming` |
| Sync source of truth | CT prices | Stripe subscription prices are updated to match CT prices |
| Risk | ⚠️ High | Misconfiguration silently changes prices on active subscriptions; price IDs generated with `Date.now()` (not stable — see `known-issues.md` KI-013) |

---

## CT Coupon / Discount Sync

| Feature | Status | Notes |
| --- | --- | --- |
| CT promotions → Stripe coupons | ✅ Supported | See `business-rules/coupon-sync.md` |
| Discount applied per subscription | ✅ Supported | — |
| Discount applied per invoice | ✅ Supported | — |
| Coupon duration mapping | ⚠️ Gap | All synced coupons are hardcoded to `duration: 'once'` regardless of CT discount type — see `known-issues.md` KI-016 |

---

## Mixed Cart Limitations

When combining subscription and one-time items in a single cart:

| Behavior | Detail |
| --- | --- |
| One-time items | Billed on first subscription invoice |
| Shipping fees | Applied only to subscription items, not one-time items |
| Trial periods | One-time items cannot be part of a trial period; billed on first invoice regardless |
| Post-checkout address update | Original shipping fee continues to be charged if address is updated after checkout |

See `business-rules/mixed-carts.md` for the full rules.

---

## Order Creation Model

Configurable via `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING`:

| Value | Behavior |
| --- | --- |
| `createOrder` (default) | New CT order created per recurring invoice event (`invoice.paid`) |
| `addPaymentToOrder` | Adds new payment to the existing CT order on each renewal — CT update errors are silently swallowed (see `known-issues.md` KI-005) |

---

## Launchpad B2B Integration

| Feature | Status | Notes |
| --- | --- | --- |
| Purchase order number on payment | ✅ Supported | `launchpadPurchaseOrderNumber` field on CT payment |
| Invoice memo | ✅ Supported | `launchpadPurchaseOrderInvoiceMemo` field on CT payment |
| Pre-requisite | CT custom type `payment-launchpad-purchase-order` must be created by the merchant before deploy | Connector checks existence but does not create it |

---

## Out of Scope for This Connector

| Feature | Why |
| --- | --- |
| Subscription pause | Not implemented |
| Free trial without collecting a payment method | Payment method required at subscription creation |
| `customer.subscription.deleted` webhook handling | Not registered; marked as TODO — cancellation via Stripe Dashboard does not update CT |
| CT update after explicit subscription cancellation | `cancelSubscription()` does not update CT — see `known-issues.md` KI-010 |
| Dispute / chargeback automation | No `charge.dispute.*` webhook handler; manual process required |
| Stripe Connect (marketplace, split payments) | Handled by separate `mirakl-stripe` integration |
| Subscription quantity updates | Not documented or implemented |
| Stripe Terminal (in-person) | Not implemented |
| Stripe Link | Surfaced by Payment Element only; no dedicated flow |
