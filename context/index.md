# Knowledge Base Index — ct-connect-stripe-composable

**What this connector covers:** Stripe Payment Element + subscriptions + mixed carts for commercetools. Extends ct-connect-stripe-checkout with recurring billing, coupon sync, price sync, and Launchpad B2B integration.

**What this connector does NOT cover:** Subscription pause, free trials without a payment method, ACH micro-deposit verification on a subscription cart, bank transfer on subscriptions. See `feature-scope.md → Out of Scope` for the full list.

For questions about the Integration as a whole (failure modes, connector selection, shared payment rules), see `../../context/index.md`.

---

## Route by Question Type

### "Can I / Is it possible to...?"

| Question | Document |
| --- | --- |
| Does this connector support feature X? | `feature-scope.md` |
| Can I do subscriptions? | `feature-scope.md` — yes, see `business-rules/subscription-lifecycle.md` |
| Can I mix subscription and one-time items in one cart? | `feature-scope.md` + `business-rules/mixed-carts.md` |
| Can I sync CT prices to Stripe? | `feature-scope.md` + `business-rules/price-sync.md` |
| Can I sync CT coupons/discounts to Stripe? | `business-rules/coupon-sync.md` |
| Can I pause a subscription? | `feature-scope.md → Out of Scope` — answer is no |
| Can a shopper pay a subscription by ACH? | Yes — `decisions/adr-013-async-ach-charge-pending.md`. Micro-deposit verification on a subscription cart is **not** supported |
| Can a shopper pay by bank transfer? | `adopter-guide.md → Bank transfers` — yes, but it ships disabled behind `STRIPE_PAYMENT_FLOW=pi_first`, and not on subscriptions |
| Does this connector handle Launchpad B2B purchase orders? | `business-rules/launchpad-integration.md` |

### "How does X work?"

| Question | Document |
| --- | --- |
| How does the payment flow work end to end? | `ARCHITECTURE.md` |
| How does subscription creation work? | `business-rules/subscription-lifecycle.md` |
| How are recurring invoice events handled? | `business-rules/recurring-billing.md` |
| How do mixed carts work? | `business-rules/mixed-carts.md` |
| How does coupon sync work? | `business-rules/coupon-sync.md` |
| How does price sync work? | `business-rules/price-sync.md` |
| How does Stripe Tax integrate? | `business-rules/tax-integration.md` |
| How does multi-capture / multi-refund work? | `business-rules/multi-operations.md` |
| How does Launchpad B2B integration work? | `business-rules/launchpad-integration.md` |
| How does the payment lifecycle map to CT transactions? | `ARCHITECTURE.md` + `../../context/business-rules/payment-lifecycle.md` |
| How is a caller-supplied payment reference authorized before use? | `business-rules/payment-ownership-binding.md` |

### "What happens when X fails?"

| Question | Document |
| --- | --- |
| What happens when Stripe is down? | `../../context/failure-modes.md` |
| What happens when CT is down? | `../../context/failure-modes.md` |
| What are the known technical gotchas? | `known-issues.md` |
| What happens when a subscription invoice fails? | `business-rules/recurring-billing.md` |
| What happens when an ACH debit is reversed after it settled? | `failure-modes.md → Stripe ACH — Late return` + `decisions/adr-014-ach-late-return-flag.md` |
| What happens when a commercetools write fails inside a subscription webhook? | `decisions/adr-015-redeliver-transient-ct-errors.md` — transient errors redeliver, permanent ones are swallowed |
| What happens when the cart is edited while an async payment settles? | `known-issues.md` KI-050 + `business-rules/payment-confirmation.md` |

### "What are the rules for X?"

| Question | Document |
| --- | --- |
| Rules for subscription lifecycle | `business-rules/subscription-lifecycle.md` |
| Rules for mixed carts | `business-rules/mixed-carts.md` |
| Rules for price sync | `business-rules/price-sync.md` |
| Rules for coupon sync | `business-rules/coupon-sync.md` |
| Universal Stripe + CT rules | `../../context/business-rules/stripe-ct-shared.md` |
| Universal refund rules | `../../context/business-rules/refunds.md` |
| Refund vs chargeback vs ACH revocation — who initiates what | `business-rules/refunds-and-disputes.md` |
| Rules for authorizing caller-supplied payment references | `business-rules/payment-ownership-binding.md` |
| Rules for confirming a payment and creating the order (amount gates, cart freeze) | `business-rules/payment-confirmation.md` |
| Why was architectural decision X made? | `decisions/` |

### "How do the asynchronous rails work?"

Bank transfer, ACH and crypto share one problem: the money arrives days after the shopper leaves. Start
here rather than in the card-shaped documents.

| Question | Document |
| --- | --- |
| The full bank transfer funding flow, step by step | `workflows/process-bank-transfer-payment.md` |
| Why the Element needs a `clientSecret`, and why `pi_first` ships disabled | `decisions/adr-010-pi-first-elements-initialization.md` |
| What still blocks enabling bank transfers | `known-issues.md` KI-049, plus the orphaned-PaymentIntent gap in `CHANGELOG.md → Known gaps`. KI-044 and KI-047 are resolved and no longer block it |
| Why an ACH subscription payment is `Charge/Pending`, not `Success` | `decisions/adr-013-async-ach-charge-pending.md` + `business-rules/subscription-lifecycle.md` |
| What happens when a settled ACH debit is reversed weeks later | `decisions/adr-014-ach-late-return-flag.md` + `failure-modes.md → Stripe ACH — Late return` |
| Why an order can be refused after the money was captured | `decisions/adr-016-ach-microdeposit-underpayment-backstop.md` + `business-rules/payment-confirmation.md` |
| Why a cart whose total moves on address write mints no order | `business-rules/payment-confirmation.md` Rule 5b + `decisions/adr-019-post-address-guard-and-unconditional-version-pin.md` |
| Why a subscription order checks the cart against a sealed total | `business-rules/payment-confirmation.md` Rule 7 + `decisions/adr-017-subscription-invoice-paid-underpayment-guard.md` addendum |
| Which rails freeze the cart, and when | `business-rules/payment-confirmation.md` + `known-issues.md` KI-050 |
| Why a subscription order can be refused after the invoice was paid | `decisions/adr-017-subscription-invoice-paid-underpayment-guard.md` + `business-rules/payment-confirmation.md` Rule 6 |
| Why the subscription guard compares `totalPrice` while the one-time guard compares `totalGross` | `business-rules/payment-confirmation.md` Rule 6 + `known-issues.md` KI-056 (subscription invoices carry no tax) |
| Why `/shipping-methods/remove` leaving the cart unfrozen is not treated as the bug | `workflows/process-shipping.md` + `known-issues.md` KI-054, KI-008 |
| Why a discount code on the cart may never reach the Stripe subscription | `business-rules/coupon-sync.md` Rule 3 + `decisions/adr-018-ct-state-authority-coupon-price-vehicle.md` |
| Why a discount code's usage cap is not visible on the Stripe Dashboard | `business-rules/coupon-sync.md` Rule 5 + `decisions/adr-018-ct-state-authority-coupon-price-vehicle.md` + `known-issues.md` KI-055 |
| Why an exhausted Stripe coupon is never deleted and recreated | `business-rules/coupon-sync.md` Rule 4 + `known-issues.md` KI-055 |
| How crypto/stablecoin settlement is modelled | `workflows/process-crypto-payment.md` |

---

## Reading Order by Role

### Adopting this connector (installing for the first time)

1. `adopter-guide.md` — prerequisites, deploy steps, subscription product setup, enabler integration, known gaps

### New to this connector (developer onboarding)

1. `ARCHITECTURE.md` — system overview including what's different from checkout
2. `feature-scope.md` — what's supported and what's not
3. `business-rules/subscription-lifecycle.md` — the core domain of this connector
4. `known-issues.md` — gotchas specific to this connector

### Implementing a subscription feature
1. Read hub `CLAUDE.md` + `../../context/known-issues.md` first
2. Read `business-rules/subscription-lifecycle.md`
3. Read `ARCHITECTURE.md → Additional API Endpoints` for the relevant endpoint
4. Check `feature-scope.md` to confirm the specific subscription behavior is in scope

### Debugging a subscription issue
1. `known-issues.md` — connector-specific gotchas
2. `business-rules/subscription-lifecycle.md` — expected subscription states
3. `business-rules/recurring-billing.md` — expected invoice handling
4. `../../context/failure-modes.md` — if the issue looks like an infrastructure failure
