# Business Rule: Multicapture and Multirefund

Opt-in feature that enables partial captures on a single PaymentIntent and enhanced refund tracking for multiple refunds on a single charge. Controlled by `STRIPE_ENABLE_MULTI_OPERATIONS=true`.

Requires multicapture to be enabled in the Stripe account (Dashboard → Settings → Payment capturing).

---

## Rule 1: Multicapture is gated by STRIPE_ENABLE_MULTI_OPERATIONS

**What:** When `STRIPE_ENABLE_MULTI_OPERATIONS=false` (default), `charge.updated` events are logged and dropped — no CT update occurs. When `true`, `processStripeEventMultipleCaptured()` is called.

**Why:** Multicapture changes the payment settlement model. Merchants must explicitly opt in because it requires Stripe account configuration and changes the capture flow.

**Invariant:** Never process `charge.updated` for CT state changes without the flag enabled. A partial capture without the flag active results in no CT transaction update.

**Implementation:** `stripe-payment.route.ts:156-163` — `charge.updated` case.

---

## Rule 2: Multicapture tracks incremental amounts, not totals

**What:** `processStripeEventMultipleCaptured()` computes the incremental captured amount:
```
incrementalAmount = charge.amount_captured - event.data.previous_attributes.amount_captured
```
This incremental amount is added as a new `CHARGE` transaction on the CT Payment, not a modification of the existing one.

**Why:** CT's payment model is transaction-based — each capture event becomes a discrete transaction. Using incremental amounts avoids double-counting across multiple partial captures.

**Invariant:** If `charge.captured == true` when the event arrives, the event is skipped (the charge is already fully captured). If `amount_captured` did not increase from the previous value, the event is also skipped.

**Implementation:** `stripe-payment.service.ts:871-930` → `processStripeEventMultipleCaptured()`.

---

## Rule 3: Multirefund uses Stripe refund API for accurate amounts

**What:** When `STRIPE_ENABLE_MULTI_OPERATIONS=true` and `charge.refunded` arrives, `processStripeEventRefunded()` calls `stripe.refunds.list({ charge })` to fetch the actual refund ID and amount instead of using the charge-level `amount_refunded`.

When `STRIPE_ENABLE_MULTI_OPERATIONS=false`, `charge.refunded` is processed via the standard `processStripeEvent()` path (uses charge-level data only).

**Why:** The standard path uses `charge.amount_refunded` which is cumulative — on a second refund it includes the first refund amount. Fetching the individual refund object gives the exact amount for that specific refund operation.

**Invariant:** Each `charge.refunded` event maps to the most recent refund on the charge (`refunds.data[0]`). The refund's `id` is used as `pspReference` and `interactionId` on the CT transaction.

**Implementation:** `stripe-payment.service.ts:812-862` → `processStripeEventRefunded()`.

---

## Rule 4: A refund is not final when it is created — `refund.updated` and `refund.failed` own the correction

**What:** `charge.refunded` fires when the Refund object is **created**, which on a delayed rail is not the same as succeeded — a bank-transfer refund is created `pending` and resolves minutes to days later. `refund.updated` and `refund.failed` are registered unconditionally and write a correcting `Refund/Failure` when Stripe rejects a refund that was already recorded as successful.

Two writes support this. `refunds.create` carries an **idempotency key**, so a retried request no longer issues a second real refund — it was the only Stripe write in the service without one. It also stamps the commercetools payment id onto the refund's `metadata`, because a `Refund` object does not inherit the PaymentIntent's metadata; without the stamp a later `refund.updated` cannot be routed back to its payment.

**Why:** A refund Stripe later rejected stayed recorded as successful forever. The merchant's books said the money went back to the shopper and it never did.

**Invariant:** No refund is recorded as terminally successful on the strength of `charge.refunded` alone when the rail can create it `pending`. Every `refunds.create` carries an idempotency key and a `ct_payment_id` in its metadata.

**Implementation:** `stripe-payment.route.ts` → `refund.updated` / `refund.failed` routing; `stripe-payment.service.ts` → `refunds.create` idempotency key and metadata stamp.

**What breaks if violated:** Dropping the metadata stamp orphans the correcting event — it arrives and cannot be matched to a CT payment. Dropping the idempotency key means a retried refund request issues a second real refund against the shopper's card.

> **Open, needs an owner's decision:** a CT `Chargeback` transaction is still written on every refund. It is wrong in both platforms' models and contradicts the disputes decision in `refunds-and-disputes.md`, but removing it changes card and subscription behavior. The companion change is moving `Refund` ownership from `charge.refunded` to `refund.updated`.

---

## Webhook routing summary

| Event | `STRIPE_ENABLE_MULTI_OPERATIONS=false` | `STRIPE_ENABLE_MULTI_OPERATIONS=true` |
|---|---|---|
| `charge.updated` | Logged, skipped | → `processStripeEventMultipleCaptured()` — incremental CHARGE transaction |
| `charge.refunded` | → `processStripeEvent()` — standard refund using charge-level data | → `processStripeEventRefunded()` — refund fetched from Stripe API, per-refund REFUND transaction |
| `refund.updated` | → correcting `Refund/Failure` when Stripe rejects the refund | Same — registered unconditionally, not gated by the flag |
| `refund.failed` | → correcting `Refund/Failure` | Same — registered unconditionally, not gated by the flag |

> `charge.updated` is the one row here that does not fire today: the route handler exists but the event is **not** in `enabled_events` (`connectors/actions.ts`), so Stripe never delivers it. A merchant enabling multicapture must add it to the webhook endpoint by hand until that is fixed. See `../known-issues.md` KI-051 — including why the fix is not simply adding one line to the array.

---

## Partial capture flow (multicapture enabled)

```
Merchant                Processor                          Stripe              CT
   |                       |                                  |                  |
   | capture partial amount|                                  |                  |
   |---------------------->| stripe.paymentIntents.capture(   |                  |
   |                       |   amount_to_capture: partialAmt) |                  |
   |                       |--------------------------------->|                  |
   |                       |                                  | charge.updated   |
   |                       |<---------------------------------|                  |
   |                       | processStripeEventMultipleCaptured()                |
   |                       | compute incrementalAmount        |                  |
   |                       | add CHARGE transaction           |                  |
   |                       |-------------------------------------------------->|
```

---

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `STRIPE_ENABLE_MULTI_OPERATIONS` | `false` | Enables multicapture (`charge.updated`) and multirefund (`charge.refunded` enhanced tracking) |
