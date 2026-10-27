# Feature Scope

## At a glance

| # | Area | One line |
| --- | --- | --- |
| 1 | [Payment models](#1-payment-models) | one-time, subscription, mixed cart, SetupIntent; guest only for one-time |
| 2 | [Payment methods and rails](#2-payment-methods-and-rails) | instant, Express wallets, async (ACH, bank transfer, crypto) |
| 3 | [Subscription features](#3-subscription-features) | create, confirm, list, update, cancel; product-attribute driven |
| 4 | [Merchant operations](#4-merchant-operations) | capture, cancel, refund; multirefund opt-in |
| 5 | [Price and coupon sync](#5-price-and-coupon-sync) | coupons gated on commercetools' verdict; price sync opt-in |
| 6 | [Configuration-driven behaviour](#6-configuration-driven-behaviour) | the switches that change what the connector does |
| 7 | [Out of Scope](#7-out-of-scope) | answer "not supported" from here, not from general Stripe knowledge |

An LLM consulting this document should answer "not in scope for this connector" when a feature is not
listed, rather than inferring from what Stripe supports.

---

## 1. Payment models

| Feature | Status | Entry point and what it calls |
| --- | --- | --- |
| One-time payment | ✅ | `GET/POST /payments` → `stripe.paymentIntents.create` (`processor/src/services/stripe-payment.service.ts:588`); `POST /confirmPayments/:id` → `paymentIntents.retrieve` and the confirm gate (`:942`) |
| Subscription | ✅ | `POST /subscription` → `stripe.subscriptions.create` with `payment_behavior: 'default_incomplete'` (`processor/src/services/stripe-subscription.service.ts:180-190`); `POST /subscription/confirm` |
| Save a method, subscribe later | ✅ | `POST /setupIntent` → `setupIntents.create` (`:962`); `POST /subscription/withSetupIntent` → `subscriptions.create` (`:285`) |
| Mixed cart (one subscription item + one-time items) | ✅ | one-time items go on the first invoice as `add_invoice_items`; trial and shipping consequences in `business-rules/mixed-carts.md` Rules 1–2 |
| More than one subscription item per cart | ❌ | — |
| Guest cart | ⚠️ **one-time only** | subscriptions and bank transfer need a commercetools customer on the cart (`host-integration.md` §2) |
| Saved payment methods | ✅ | driven by `STRIPE_SAVED_PAYMENT_METHODS_CONFIG` and the CustomerSession from `GET /customer/session` |

---

## 2. Payment methods and rails

| Rail | Status | How it settles |
| --- | --- | --- |
| Cards (incl. 3DS) | ✅ | confirm gate writes the transaction synchronously; `payment_intent.succeeded` creates the order |
| Express Checkout — Apple Pay, Google Pay, Link | ✅ | Express Checkout Element; shipping via `/shipping-methods*` |
| ACH Direct Debit (`us_bank_account`) | ✅ one-time and subscription | one-time: `processing` → `Authorization/Pending`; micro-deposit verification freezes the cart and writes `Authorization/Pending` at `requires_action`. Subscription: `Charge/Pending` until `invoice.paid`; micro-deposits **not** supported on the subscription path |
| Bank transfer (`customer_balance`) | ⚠️ ships disabled | needs `STRIPE_PAYMENT_FLOW=pi_first`; `requires_action` writes `Authorization/Pending` and freezes; `payment_intent.succeeded` settles. Not on subscriptions |
| Crypto / stablecoin | ✅ | `payment_intent.processing` → `Authorization/Pending`; resolved by `succeeded` or `payment_failed`/`canceled` (`workflows/process-crypto-payment.md`) |
| Boleto and other voucher methods | ⚠️ | the enabler returns the PaymentIntent, the confirm gate rejects `requires_action`; the order relies on `payment_intent.succeeded` and its amount guard |

**Order creation on `payment_intent.succeeded`** is refused unless the PaymentIntent was collected in full
and matches the cart's current total and currency (`stripe-payment.service.ts:1526-1543`), and again
after the address write and at a pinned cart version (`business-rules/payment-confirmation.md` Rules 5
and 5b).

---

## 3. Subscription features

| Feature | Status | Notes |
| --- | --- | --- |
| Create from cart, freeze the cart | ✅ | — |
| First-invoice amount guard at `invoice.paid` | ✅ | first cycle, `charge_automatically`, no trial, money collected, no invoice discount; plus the sealed-total drift check (`business-rules/payment-confirmation.md` Rules 6–7) |
| Recurring orders | ✅ | `createOrder` (default): a new order per `invoice.paid`; `addPaymentToOrder`: a payment added to the first order |
| List a customer's subscriptions | ✅ | `GET /subscription-api/:customerId` — one Stripe page, ten non-canceled at most (`host-integration.md` §3a) |
| Change variant or price | ✅ | `POST /subscription-api/:customerId` |
| Advanced update (raw Stripe params) | ✅ | `POST /subscription-api/advanced/:customerId` |
| Cancel through the API | ⚠️ | Stripe only; commercetools is not updated by the call |
| Cancel in Stripe (Dashboard, dunning) → unfreeze the cart | ✅ | `customer.subscription.deleted` |
| ACH late return after settlement | ⚠️ flag only | `paymentStatus.interfaceCode = 'ach_late_return'`; reversal handled in Stripe |
| `send_invoice` collection | ⚠️ | first invoice is emailed and stays open; no order until paid |
| Trials | ✅ | `stripeConnector_trial_period_days` or `stripeConnector_trial_end_date` |
| Billing cycle anchor, cancel at period end, cancel at date, proration, behaviour when a trial ends without a method | ✅ | product-type attributes (`ARCHITECTURE.md` section 7) |
| Tax on subscription invoices | ❌ | — |

---

## 4. Merchant operations

| Feature | Status | Notes |
| --- | --- | --- |
| Capture, cancel, refund | ✅ | `POST /operations/payment-intents/:id` |
| Refunds reflected from Stripe | ⚠️ | a refund that later fails is corrected by `refund.failed`/`refund.updated` (`business-rules/multi-operations.md` Rule 4) |
| Multirefund | ⚠️ | — |
| Disputes | ❌ | manual, by decision (`business-rules/refunds-and-disputes.md` Rule 2) |

---

## 5. Price and coupon sync

| Feature | Status | Notes |
| --- | --- | --- |
| Discount code → Stripe coupon | ✅ | only when commercetools reports the code `MatchesCart`; checkout is refused before money moves when commercetools would not order with the code (`business-rules/coupon-sync.md` Rules 3, 3b) |
| Usage cap | ✅ enforced by commercetools | not mirrored into Stripe |
| Coupon duration | fixed `once` | `processor/src/services/stripe-coupon.service.ts:192`; commercetools has no duration to map from |
| Price sync on `invoice.upcoming` | ⚠️ opt-in | `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED=true` |

---

## 6. Configuration-driven behaviour

| Setting | What it switches |
| --- | --- |
| `STRIPE_PAYMENT_FLOW` / a rule's `flowType` | `deferred` or `pi_first`; bank transfer and BLIK need `pi_first` |
| `STRIPE_PAYMENT_BEHAVIOR_RULES` | per-country or per-store overrides of flow, capture method, save mandate, EU bank-transfer country |
| `STRIPE_CAPTURE_METHOD` | automatic vs manual capture; manual removes `customer_balance`, `us_bank_account`, `crypto` |
| `STRIPE_SUBSCRIPTION_PAYMENT_HANDLING` | a new order per renewal, or payments added to the first order |
| `STRIPE_SUBSCRIPTION_PRICE_SYNC_ENABLED` | price sync on `invoice.upcoming` |
| `STRIPE_ENABLE_MULTI_OPERATIONS` | multirefund routing |
| `STRIPE_SAVED_PAYMENT_METHODS_CONFIG` | saved-method display and save |
| `STRIPE_COLLECT_BILLING_ADDRESS` | `auto`, `never`, `if_required` |

Full table with defaults and invalid-value behaviour: `ARCHITECTURE.md` section 9.

---

## 7. Out of Scope

| Feature | Why |
| --- | --- |
| Subscription pause | no pause operation exists |
| Free trial without a payment method | both create paths require a payment method |
| Subscription quantity changes | updates keep the current quantity |
| Several subscription products in one cart | — |
| Bank transfer, and ACH micro-deposits, on subscriptions | — |
| Subscriptions or bank transfer for a guest cart | a customer is required |
| commercetools update after an API cancel | — |
| Correcting commercetools after an ACH late return or a cash-balance clawback | flag or log only |
| Dispute and chargeback automation | no `charge.dispute.*` handling |
| Tax on subscription invoices | — |
| A distinct "awaiting funds" state in commercetools | — |
| Stripe Terminal (in-person) | no Terminal call in the code |
| Stripe Connect (marketplaces, split payments) | no Connect account, transfer or application-fee parameter in the code |
| Automatic expiry or unfreeze of an abandoned async payment | nothing in the connector expires a frozen cart or an open PaymentIntent |
