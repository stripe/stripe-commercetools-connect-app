# Knowledge Base Index — stripe-commercetools-connect-app

**What this connector covers:** Stripe Payment Element and Express Checkout for commercetools, plus
recurring Stripe subscriptions from a cart, mixed carts, SetupIntents, coupon sync, opt-in price sync,
asynchronous rails (ACH, bank transfer, crypto) and merchant operations.

**What it does NOT cover:** subscription pause, free trials without a payment method, quantity changes, more
than one subscription product per cart, bank transfer or ACH micro-deposits on subscriptions, subscriptions
or bank transfer for a guest cart, disputes, tax on subscription invoices. Full list:
`feature-scope.md` → Out of Scope.

Routes questions to documents; the documents are listed in [All documents](#all-documents).

---

## Route by question

### "Can I / is it possible to …?"

| Question | Document |
| --- | --- |
| Does this connector support feature X? | `feature-scope.md` |
| Can I do subscriptions? | `feature-scope.md` — yes; then `business-rules/subscription-lifecycle.md` |
| Can I mix subscription and one-time items in one cart? | `feature-scope.md` + `business-rules/mixed-carts.md` |
| Can I sync commercetools prices to Stripe? | `feature-scope.md` + `business-rules/price-sync.md` |
| Can I sync discount codes to Stripe? | `business-rules/coupon-sync.md` |
| Can I pause a subscription? | `feature-scope.md` → Out of Scope — no |
| Can a shopper pay by bank transfer? | `adopter-guide.md` → Bank transfers — yes, but it ships disabled behind `STRIPE_PAYMENT_FLOW=pi_first`, and not on subscriptions |
| Can a guest check out? | one-time payments only — `host-integration.md` §2 |

### "How do I integrate or deploy it?"

| Question | Document |
| --- | --- |
| How do I install and configure it? | `adopter-guide.md` |
| How does my storefront or backend call this connector? | `host-integration.md` |
| Environment variable defaults and invalid-value behaviour | `ARCHITECTURE.md` section 9 |

### "How does X work?"

| Question | Document |
| --- | --- |
| How does the payment flow work end to end? | `ARCHITECTURE.md` sections 3–5 |
| How does subscription creation work? | `workflows/process-subscription-creation.md` + `business-rules/subscription-lifecycle.md` |
| How are subscriptions updated and canceled? | `workflows/process-subscription-management.md` |
| How are recurring invoice events handled? | `workflows/process-recurring-payment.md` + `business-rules/recurring-billing.md` |
| How does the customer session work? | `workflows/process-customer-session.md` |
| How does Express Checkout shipping work? | `workflows/process-shipping.md` |
| How do mixed carts work? | `business-rules/mixed-carts.md` |
| How does coupon sync work? | `business-rules/coupon-sync.md` |
| How does price sync work? | `workflows/process-price-sync.md` + `business-rules/price-sync.md` |
| How does Stripe Tax integrate? | `business-rules/tax-integration.md` |
| How does multi-capture / multi-refund work? | `business-rules/multi-operations.md` |
| How do Stripe events map to commercetools transactions? | `ARCHITECTURE.md` section 4 + `business-rules/payment-confirmation.md` |
| How is a caller-supplied payment reference authorized before use? | `business-rules/payment-ownership-binding.md` |
| How does the connect-payments-sdk or the Stripe API behave here? | `reference/ct-connect-payments-sdk.md`, `reference/stripe-v20-payment-intents.md` |

### "How do the asynchronous rails work?"

Bank transfer, ACH and crypto share one problem: the money arrives days after the shopper leaves. Start here
rather than in the card-shaped documents.

| Question | Document |
| --- | --- |
| The full bank transfer funding flow, step by step | `workflows/process-bank-transfer-payment.md` |
| Why an ACH subscription payment is `Charge/Pending`, not `Success` | `business-rules/subscription-lifecycle.md` Rule 7 |
| Why a cart whose total changes on address write creates no order | `business-rules/payment-confirmation.md` Rule 5b |
| Why a subscription order checks the cart against a sealed total | `business-rules/payment-confirmation.md` Rule 7 |
| Which rails freeze the cart, and when | `workflows/process-shipping.md` |
| How crypto/stablecoin settlement is modelled | `workflows/process-crypto-payment.md` |

### "What happens when X fails?"

| Question | Document |
| --- | --- |
| What happens when a subscription invoice fails? | `business-rules/recurring-billing.md` + `workflows/process-recurring-payment.md` → Payment Failure Flow |

### "What are the rules for X?"

| Question | Document |
| --- | --- |
| Rules for the subscription lifecycle | `business-rules/subscription-lifecycle.md` |
| Rules for recurring billing | `business-rules/recurring-billing.md` |
| Rules for mixed carts | `business-rules/mixed-carts.md` |
| Rules for price sync | `business-rules/price-sync.md` |
| Rules for coupon sync | `business-rules/coupon-sync.md` |
| Rules for confirming a payment and creating the order (amount gates, cart freeze) | `business-rules/payment-confirmation.md` |
| Rules for authorizing caller-supplied payment references | `business-rules/payment-ownership-binding.md` |
| Refund vs chargeback vs ACH revocation — who initiates what | `business-rules/refunds-and-disputes.md` |
| Rules for multi-capture and multi-refund | `business-rules/multi-operations.md` |
| Rules for Stripe Tax | `business-rules/tax-integration.md` |

---

## Reading order by role

### Adopting this connector (installing for the first time)

1. `adopter-guide.md` — prerequisites, deploy steps, subscription product setup
2. `host-integration.md` — how your storefront and backend call it

### New to this connector (developer onboarding)

1. `ARCHITECTURE.md` — modules, routes, events, configuration
2. `feature-scope.md` — what's supported and what's not
3. `business-rules/subscription-lifecycle.md` — the core domain

### Implementing a subscription feature

1. `business-rules/subscription-lifecycle.md` and `business-rules/recurring-billing.md`
2. `ARCHITECTURE.md` section 3 for the relevant endpoint, section 4 for the events it touches
3. `feature-scope.md` — confirm the behaviour is in scope

### Debugging a subscription issue

1. `business-rules/subscription-lifecycle.md` — expected subscription states
2. `business-rules/recurring-billing.md` — expected invoice handling

---

## All documents

| File | What it is |
| --- | --- |
| `ARCHITECTURE.md` | Modules, routes and their callers, webhook events, contracts, data model, configuration, out of scope |
| `feature-scope.md` | What is supported, partially supported and out of scope |
| `index.md` | This router |
| `adopter-guide.md` | Installing, configuring and verifying the connector |
| `host-integration.md` | How a storefront or merchant backend calls or embeds the connector |
| `business-rules/coupon-sync.md` | Discount code → Stripe coupon rules |
| `business-rules/mixed-carts.md` | Subscription + one-time items in one cart |
| `business-rules/multi-operations.md` | Multicapture and multirefund |
| `business-rules/payment-confirmation.md` | Confirm gate, amount guards, cart freeze, order creation |
| `business-rules/payment-ownership-binding.md` | Authorizing caller-supplied payment references |
| `business-rules/price-sync.md` | commercetools → Stripe price sync |
| `business-rules/recurring-billing.md` | Recurring invoice handling and order creation |
| `business-rules/refunds-and-disputes.md` | Refunds, chargebacks, cash-balance reversals |
| `business-rules/subscription-lifecycle.md` | Subscription creation, freeze, ACH, late return |
| `business-rules/tax-integration.md` | Stripe Tax calculation references from the cart |
| `workflows/process-bank-transfer-payment.md` | Bank transfer (`customer_balance`) funding flow |
| `workflows/process-crypto-payment.md` | Crypto / stablecoin settlement |
| `workflows/process-customer-session.md` | `GET /customer/session` and Stripe customer resolution |
| `workflows/process-price-sync.md` | Price sync on `invoice.upcoming` |
| `workflows/process-recurring-payment.md` | Subsequent billing cycles |
| `workflows/process-shipping.md` | Express Checkout shipping and the freeze contract |
| `workflows/process-subscription-creation.md` | Direct and SetupIntent subscription creation |
| `workflows/process-subscription-management.md` | Update, cancel, deletion webhook, ACH late return |
| `reference/ct-connect-payments-sdk.md` | connect-payments-sdk usage in this connector |
| `reference/stripe-v20-payment-intents.md` | Stripe API v20 PaymentIntents, SetupIntents and subscriptions |
