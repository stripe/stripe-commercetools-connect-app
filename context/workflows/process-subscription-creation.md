# Workflow: Subscription Creation

**Trigger:** Customer completes checkout with a cart containing a subscription item.
**Actors:** Browser (Enabler), Processor, Stripe API, CT API.
**Outcome:** Stripe subscription active, CT cart frozen, and — once `POST /subscription/confirm` runs — a CT Payment carrying `Authorization/Success` plus a `Charge` (`processor/src/services/ct-payment-creation.service.ts:162-188`). The Charge is `Success` for a settled card PaymentIntent and for free billing-cycle anchor days (amount 0), and `Pending` for a trial, `send_invoice`, or an ACH PaymentIntent still `processing` (`confirmSubscriptionPayment`).

Two paths exist, chosen by the cart's subscription variant attributes, not by how the payment method is entered: the processor's `getPaymentMode()` returns `setup` when the variant has a trial, free billing-cycle anchor days or `collection_method: send_invoice`, and `subscription` otherwise (`getPaymentMode`); the enabler's `submit()` dispatches on that mode (`enabler/src/dropin/dropin-embedded.ts:132-144`). **Direct** (`subscription` mode) and **SetupIntent** (`setup` mode — the payment method is saved with `confirmSetup()`, then the subscription is created and confirmed in the same submit, `enabler/src/dropin/dropin-embedded.ts:190-214`).

---

## Path A: Direct Subscription (payment at checkout)

```
Browser                    Enabler                 Processor               Stripe          CT
  |                          |                         |                      |              |
  | (same as checkout init:  |                         |                      |              |
  |  config, customer session,|                        |                      |              |
  |  Payment Element mount)  |                         |                      |              |
  |                          |                         |                      |              |
  | click Subscribe          |                         |                      |              |
  |------------------------->|                         |                      |              |
  |                          | elements.submit()       |                      |              |
  |                          | POST /subscription      |                      |              |
  |                          |------------------------>|                      |              |
  |                          |                         | getCart()            |              |
  |                          |                         |------------------------------------------>|
  |                          |                         | getSubscriptionAttributes()          |    |
  |                          |                         | (from product variant)               |    |
  |                          |                         | getAllLineItemPrices()                |    |
  |                          |                         | (create Stripe prices for one-time)  |    |
  |                          |                         |---------------------->|               |    |
  |                          |                         | subscriptions.create( |               |    |
  |                          |                         |   items: [subscription price],        |    |
  |                          |                         |   add_invoice_items: [one-time prices],|   |
  |                          |                         |   payment_behavior: default_incomplete)|   |
  |                          |                         |---------------------->|               |    |
  |                          |                         | createPayment()       |               |    |
  |                          |                         |------------------------------------------>|
  |                          |                         | freezeCart()          |               |    |
  |                          |                         |------------------------------------------>|
  |                          |  {clientSecret,         |                      |              |
  |                          |   subscriptionId,       |                      |              |
  |                          |   paymentReference}     |                      |              |
  |                          |<------------------------|                      |              |
  |                          | stripe.confirmPayment() |                      |              |
  |                          |------------------------>Stripe confirms PI --->|              |
  |                          | POST /subscription/confirm                     |              |
  |                          |------------------------>|                      |              |
  |                          |                         | cart owns paymentReference?          |
  |                          |                         | interfaceId matches?  |              |
  |                          |                         | PI status settled/processing?        |
  |                          |                         | write Authorization/Success +        |
  |                          |                         |   Charge/Success (Pending if ACH     |
  |                          |                         |   processing)                        |
  |                          |                         |------------------------------------------>|
  |   onComplete()           |                         |                      |              |
  |<-------------------------|                         |                      |              |
```

---

## Path B: SetupIntent (save the payment method, then subscribe in the same submit)

```
Browser                    Enabler                 Processor               Stripe          CT
  |                          |                         |                      |              |
  | (payment method capture  |                         |                      |              |
  |  phase — often free trial)|                        |                      |              |
  |                          |                         |                      |              |
  |                          | POST /setupIntent       |                      |              |
  |                          |------------------------>|                      |              |
  |                          |                         | setupIntents.create()|              |
  |                          |                         |---------------------->|              |
  |                          |  {clientSecret}         |                      |              |
  |                          |<------------------------|                      |              |
  |                          | stripe.confirmSetup()   |                      |              |
  |                          |------------------------>Stripe saves PM ------>|              |
  |                          |  {setupIntentId}        |                      |              |
  |                          |<------------------------|                      |              |
  |                          |                         |                      |              |
  | (same submit, right after|                         |                      |              |
  |  confirmSetup() returns) |                         |                      |              |
  |                          |                         |                      |              |
  |                          | POST /subscription/withSetupIntent             |              |
  |                          | { setupIntentId }       |                      |              |
  |                          |------------------------>|                      |              |
  |                          |                         | setupIntents.retrieve(setupIntentId)  |
  |                          |                         |---------------------->|              |
  |                          |                         | get payment_method from SI            |
  |                          |                         | subscriptions.create( |              |
  |                          |                         |   default_payment_method,             |
  |                          |                         |   items, add_invoice_items)           |
  |                          |                         |---------------------->|              |
  |                          |                         | createPayment()       |              |
  |                          |                         |------------------------------------------>|
  |                          |                         | freezeCart()          |              |
  |                          |                         |------------------------------------------>|
  |                          |  {subscriptionId,       |                      |              |
  |                          |   paymentReference}     |                      |              |
  |                          |<------------------------|                      |              |
  |                          | POST /subscription/confirm                     |              |
  |                          | { subscriptionId,       |                      |              |
  |                          |   paymentReference }    |                      |              |
  |                          | (no paymentIntentId)    |                      |              |
  |                          |------------------------>|                      |              |
  |                          |                         | write Authorization/Success +        |
  |                          |                         |   Charge (Pending for trial or       |
  |                          |                         |   send_invoice; Success, amount 0,   |
  |                          |                         |   for free anchor days)              |
  |                          |                         |------------------------------------------>|
  |   onComplete()           |                         |                      |              |
  |<-------------------------|                         |                      |              |
```

---

## Steps Detail

### POST /subscription key operations
0. **Refuse what cannot be billed, before any Stripe object is created** (`prepareSubscriptionData()`): a cart with more than one subscription line item (`MultipleSubscriptionsNotSupported`), a cart with a **negative (credit)** custom line item (`NegativeCustomLineItemNotSupported`), and any subscription cart carrying a **discount that does not target the cart total** — a line-item/shipping/custom-line-item/multi-buy/pattern code, or a code-less direct discount (`UnsupportedCartDiscountForSubscription`). Each throws `Errorx` 400 and logs the `ctCartId`.
1. Read cart from CT → extract subscription line item + one-time items
2. Read subscription attributes from product variant (`subscription-mapper.ts`)
3. Create Stripe prices for each one-time item, and **bill the cart's `customLineItems`** (ad-hoc fees / service charges) via `price_data` at their `totalPrice`, `quantity: 1`, a Stripe Product reused per `slug` (`getAllLineItemPrices()`, `business-rules/mixed-carts.md` Rule 5)
4. Create shipping price if cart has shippingInfo (recurring, same interval as subscription)
5. Call `subscriptions.create()` with:
   - `items`: subscription price + shipping price (if any)
   - `add_invoice_items`: one-time prices + custom-line-item fees
   - `discounts`: the Stripe coupon per applicable discount code (`getStripeCoupons()`; coupon id = discount code id — on a fee cart only a total-price discount reaches here, step 0)
   - `payment_behavior: default_incomplete`, expanding `latest_invoice.confirmation_secret` (`createSubscription`) → the client secret is read from `latest_invoice.confirmation_secret.client_secret`, and the PaymentIntent id is derived from it (`validateSubscription`)
   - Trial settings, billing cycle anchor, cancel_at, proration behavior (from variant attributes)
6. Create CT Payment
7. **Freeze cart** → prevents further modifications
8. Return `clientSecret` for frontend confirmation

### POST /subscription/confirm key operations
1. Retrieve subscription from Stripe
2. Branch on subscription type (`hasNoInvoice`, `isSendInvoice`, `hasTrial`) to determine payment transaction handling
3. For a direct charge (not `send_invoice`, not trial), **retrieve the PaymentIntent status and validate it** (`confirmSubscriptionPayment()`, `stripe-subscription.service.ts`):
   - `succeeded` / `requires_capture` → settled synchronously (e.g. card) → charge written **Success**
   - `processing` → **async settlement (e.g. ACH `us_bank_account`)** → set `isAsyncProcessing`; the money is in flight, so the charge is written **Pending**, not Success. It flips to Success later when `invoice.paid` arrives (see `process-recurring-payment.md`)
   - any other status (e.g. `requires_action` micro-deposit verification) → **throws** — out of scope
4. Update the CT Payment: `isPending` is true when `send_invoice`, trial, **or** async processing → the Charge transaction is written **Pending**; otherwise **Success**.

> **Note:** The CT line item custom field `stripeConnector_stripeSubscriptionId` is set during `POST /subscription` (inside `createSubscription()` → `saveSubscriptionId()`), not during confirm.

---

## Order creation on `invoice.paid` — amount guard

`createSubscriptionOrderFromCart` validates before minting the order:

1. Cart already `Ordered` → skip (idempotency).
2. Cart not frozen → `log.warn`.
3. `updateCartAddress()` from the Stripe charge's billing details — keeping a complete checkout shipping address (`preserveExistingAddress`).
4. **Amount guard** — compare `invoice.total` / `invoice.currency` against the **post-address** cart's `totalPrice` (the snapshot the order is minted from), via the shared `paidAmountMatchesTotal`.
   - Guarded configuration (first cycle, `charge_automatically`, no trial, not prorated, invoice `total > 0` — all read from Stripe, never from the cart, with a one-minor-unit rounding tolerance) and a mismatch → **no order**, `log.error`.
   - Any other configuration → `log.warn` and the order **is** created: a trial, free anchor days, `send_invoice` or a recurring cycle legitimately bill a first invoice that differs from the cart total.
5. `createOrder()`, pinning `expectedVersion` to the validated cart version so a cart that moved after step 4 cannot still mint an order (commercetools returns 409).

The comparison is against the cart's `totalPrice`; the invoice is built from the line items' own price values plus the shipping price.

---

## Decision Points

| Point | Condition | Path |
|---|---|---|
| Payment mode | Variant has no trial, no free billing-cycle anchor days and is not `send_invoice` → `getPaymentMode()` returns `subscription` | Path A (direct) |
| Payment mode | Variant has a trial, free billing-cycle anchor days (`proration_behavior: none`) or `collection_method: send_invoice` → `setup` (`getPaymentMode`, deriving the flags via `getSubscriptionTypes`) | Path B (withSetupIntent), dispatched by `enabler/src/dropin/dropin-embedded.ts:132-140` |
| Trial configured | `trial_period_days` or `trial_end_date` on variant | Subscription starts in `trialing` state |
| One-time items | Cart has non-subscription line items | Added to `add_invoice_items` |
| Shipping | Cart has `shippingInfo` | Shipping price added to recurring `items` |
| Discount codes | Code's `DiscountCodeInfo.state` is `MatchesCart` | Translated to a Stripe coupon and passed as `discounts` |
| Discount codes | State `ApplicationStoppedByGroupBestDeal` | Skipped: no coupon for that code; the subscription is still created (`getStripeCoupons` skips it via `appliesToCart`) — commercetools is the authority on whether a code applies (`business-rules/coupon-sync.md` Rules 3-5) |
| Discount codes | Any other state (e.g. cap reached, predicate not met, inactive, stopped by a previous discount) | Checkout **refused**: `DiscountCodeNonApplicable`, HTTP 400, thrown while `subscriptions.create` arguments are evaluated, so no subscription, invoice or CT Payment is created (`assertOrderableWithCode`). The Stripe prices for the subscription and one-time items have already been created or reused by then (`getAllLineItemPrices`, `getCreateSubscriptionPriceId`) |

---

## Error Paths

| Error | Cause | CT/Cart State |
|---|---|---|
| `MultipleSubscriptionsNotSupported` (400) | Cart carries more than one subscription line item (`assertSingleSubscriptionLineItem`) | Refused in `prepareSubscriptionData()` before any Stripe object; no CT Payment, cart untouched |
| `NegativeCustomLineItemNotSupported` (400) | Cart carries a negative (credit) custom line item (`assertNoNegativeCustomLineItem`) | Refused in `prepareSubscriptionData()` before any Stripe object; no CT Payment, cart untouched |
| `UnsupportedCartDiscountForSubscription` (400) | A subscription cart carries a discount that does not target the cart total, or a code-less direct discount (`assertSupportedSubscriptionDiscounts`) | Refused in `prepareSubscriptionData()` before any Stripe object; no CT Payment, cart untouched |
| `subscriptions.create()` fails | Stripe API error | No CT Payment; cart unfrozen |
| `createPayment()` fails | CT API error | Stripe subscription created; cart not frozen |
| `confirmPayment()` fails | Card declined | CT Payment keeps only its creation-time `Authorization` transaction in state `Initial` (`processor/src/services/ct-payment-creation.service.ts:50-56`, `PaymentOutcome.INITIAL = 'Initial'` at `processor/src/dtos/stripe-payment.dto.ts:29`); cart remains frozen |
| `/subscription/confirm` fails | `paymentReference` not on the caller's cart (in `confirmSubscriptionPayment`), payment `interfaceId` matching none of the references (`assertPaymentInterfaceMatches`), PaymentIntent neither settled nor `processing` (in `confirmSubscriptionPayment`), or no latest invoice on the subscription (`getInvoiceFromSubscription`). These are the checks; any other error thrown on the way gets the same answer: the route answers HTTP 400 `REJECTED` (`processor/src/routes/stripe-subscription.route.ts:97-103`) | CT Payment keeps its `Authorization/Initial` transaction |
