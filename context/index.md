# Knowledge Base Index — ct-connect-stripe-composable

**What this connector covers:** Stripe Payment Element + subscriptions + mixed carts for commercetools. Extends ct-connect-stripe-checkout with recurring billing, coupon sync, price sync, and Launchpad B2B integration.

**What this connector does NOT cover:** Subscription pause, free trials without a payment method, `customer.subscription.deleted` webhook handling. See `feature-scope.md → Out of Scope` for the full list.

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

### "What happens when X fails?"

| Question | Document |
| --- | --- |
| What happens when Stripe is down? | `../../context/failure-modes.md` |
| What happens when CT is down? | `../../context/failure-modes.md` |
| What are the known technical gotchas? | `known-issues.md` |
| What happens when a subscription invoice fails? | `business-rules/recurring-billing.md` |

### "What are the rules for X?"

| Question | Document |
| --- | --- |
| Rules for subscription lifecycle | `business-rules/subscription-lifecycle.md` |
| Rules for mixed carts | `business-rules/mixed-carts.md` |
| Rules for price sync | `business-rules/price-sync.md` |
| Rules for coupon sync | `business-rules/coupon-sync.md` |
| Universal Stripe + CT rules | `../../context/business-rules/stripe-ct-shared.md` |
| Universal refund rules | `../../context/business-rules/refunds.md` |
| Why was architectural decision X made? | `decisions/` |

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
