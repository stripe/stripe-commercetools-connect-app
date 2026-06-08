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
2. Branch on subscription type (`hasNoInvoice`, `isSendInvoice`, `hasTrial`) to determine payment transaction handling — no explicit status validation
3. Update CT Payment to AUTHORIZED state

> **Note:** The CT line item custom field `stripeConnector_stripeSubscriptionId` is set during `POST /subscription` (inside `createSubscription()` → `saveSubscriptionId()`), not during confirm.

---

## Decision Points

| Point | Condition | Path |
|---|---|---|
| Payment method | Card entered at checkout | Path A (direct) |
| Payment method | SetupIntent pre-confirmed | Path B (withSetupIntent) |
| Trial configured | `trial_period_days` or `trial_end_date` on variant | Subscription starts in `trialing` state |
| One-time items | Cart has non-subscription line items | Added to `add_invoice_items` |
| Shipping | Cart has `shippingInfo` | Shipping price added to recurring `items` |

---

## Error Paths

| Error | Cause | CT/Cart State |
|---|---|---|
| `subscriptions.create()` fails | Stripe API error | No CT Payment; cart unfrozen |
| `createPayment()` fails | CT API error | Stripe subscription created; cart not frozen (orphaned subscription) |
| `confirmPayment()` fails | Card declined | CT Payment stays PENDING; cart remains frozen |
| `/subscription/confirm` fails | Subscription inactive | CT Payment stays PENDING |
