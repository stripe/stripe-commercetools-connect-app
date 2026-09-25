# Workflow: Subscription Creation

**Trigger:** Customer completes checkout with a cart containing a subscription item.
**Actors:** Browser (Enabler), Processor, Stripe API, CT API.
**Outcome:** Stripe subscription active, CT cart frozen, CT Payment in AUTHORIZED state.

Two paths exist: **Direct** (card entered at checkout) and **SetupIntent** (payment method saved first, subscription created later).

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
  |                          |                         | validate subscription |              |
  |                          |                         | updatePayment(AUTHORIZED)            |
  |                          |                         |------------------------------------------>|
  |   onComplete()           |                         |                      |              |
  |<-------------------------|                         |                      |              |
```

---

## Path B: SetupIntent (save now, subscribe later)

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
  | (later — trial ends or   |                         |                      |              |
  |  merchant triggers sub)  |                         |                      |              |
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
  |   (no Stripe confirmation |                         |                      |              |
  |    needed — PM already   |                         |                      |              |
  |    confirmed)            |                         |                      |              |
```

---

## Steps Detail

### POST /subscription key operations
1. Read cart from CT → extract subscription line item + one-time items
2. Read subscription attributes from product variant (`subscription-mapper.ts`)
3. Create Stripe prices for each one-time item (`getAllLineItemPrices()`)
4. Create shipping price if cart has shippingInfo (recurring, same interval as subscription)
5. Call `subscriptions.create()` with:
   - `items`: subscription price + shipping price (if any)
   - `add_invoice_items`: one-time prices
   - `payment_behavior: default_incomplete` → returns `latest_invoice.payment_intent.client_secret`
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

Step 7 above (**freeze cart**) is a convenience, not a control: it is best-effort, and `GET /shipping-methods/remove` releases it and never restores it (`process-shipping.md`). The first invoice, however, was priced once at step 5 and does not move. So between creation and `invoice.paid` the cart can grow while the invoice stays locked — which is how KI-054 produced an order marked `Paid` at €70.00 against €20.00 collected.

`createSubscriptionOrderFromCart` therefore validates before minting the order:

1. Cart already `Ordered` → skip (idempotency, unchanged).
2. Cart not frozen → `log.warn`. Still a useful signal, no longer the only reaction.
3. `updateCartAddress()` from the Stripe charge's billing details.
4. **Amount guard** — compare `invoice.amount_paid` / `invoice.currency` against the **post-address** cart's `totalPrice` (the snapshot the order is minted from), via the shared `paidAmountMatchesTotal`.
   - Guarded configuration (first cycle, `charge_automatically`, no trial, `amount_paid > 0`, undiscounted invoice — all read from Stripe, never from the cart) and a mismatch → **no order**, `log.error`. The `Charge/Success` is already persisted, so this is a paid-without-order state for manual reconciliation; never auto-refunded.
   - Any other configuration → `log.warn` and the order **is** created: a trial, free anchor days, `send_invoice` or a recurring cycle legitimately bill a first invoice that differs from the cart total.
5. `createOrder()`, pinning `expectedVersion` to the validated cart version so a cart that moved after step 4 cannot still mint an order (commercetools returns 409, handled as the race it is).

Compared against `totalPrice` and **not** `taxedPrice.totalGross`: the invoice is built from the line items' own price values plus the shipping price, with no tax applied on the subscription path. See `business-rules/payment-confirmation.md` Rule 6, ADR-017, and KI-056 for the tax gap this exposed.

---

## Decision Points

| Point | Condition | Path |
|---|---|---|
| Payment method | Card entered at checkout | Path A (direct) |
| Payment method | SetupIntent pre-confirmed | Path B (withSetupIntent) |
| Trial configured | `trial_period_days` or `trial_end_date` on variant | Subscription starts in `trialing` state |
| One-time items | Cart has non-subscription line items | Added to `add_invoice_items` |
| Shipping | Cart has `shippingInfo` | Shipping price added to recurring `items` |
| Discount codes | Code's `DiscountCodeInfo.state` is `MatchesCart` | Translated to a Stripe coupon and passed as `discounts` |
| Discount codes | Any other state (cap reached, predicate not met, inactive, stopped by a previous discount) | Skipped before any Stripe call — commercetools is the authority on whether a code applies (`business-rules/coupon-sync.md` Rules 3-5, ADR-018) |

---

## Error Paths

| Error | Cause | CT/Cart State |
|---|---|---|
| `subscriptions.create()` fails | Stripe API error | No CT Payment; cart unfrozen |
| `createPayment()` fails | CT API error | Stripe subscription created; cart not frozen (orphaned subscription) |
| `confirmPayment()` fails | Card declined | CT Payment stays PENDING; cart remains frozen |
| `/subscription/confirm` fails | Subscription inactive | CT Payment stays PENDING |
