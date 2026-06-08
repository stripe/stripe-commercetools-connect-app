# Business Rule: Multicapture and Multirefund

Opt-in feature that enables partial captures on a single PaymentIntent and enhanced refund tracking for multiple refunds on a single charge. Controlled by `STRIPE_ENABLE_MULTI_OPERATIONS=true`.

Requires multicapture to be enabled in the Stripe account (Dashboard → Settings → Payment capturing).

---

## Rule 1: Multicapture is gated by STRIPE_ENABLE_MULTI_OPERATIONS

**What:** When `STRIPE_ENABLE_MULTI_OPERATIONS=false` (default), `charge.updated` events are logged and dropped — no CT update occurs. When `true`, `processStripeEventMultipleCaptured()` is called.

**Why:** Multicapture changes the payment settlement model. Merchants must explicitly opt in because it requires Stripe account configuration and changes the capture flow.

**Invariant:** Never process `charge.updated` for CT state changes without the flag enabled. A partial capture without the flag active results in no CT transaction update.

**Implementation:** `stripe-payment.route.ts:154-160` — `charge.updated` case.

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

## Webhook routing summary

| Event | `STRIPE_ENABLE_MULTI_OPERATIONS=false` | `STRIPE_ENABLE_MULTI_OPERATIONS=true` |
|---|---|---|
| `charge.updated` | Logged, skipped | → `processStripeEventMultipleCaptured()` — incremental CHARGE transaction |
| `charge.refunded` | → `processStripeEvent()` — standard refund using charge-level data | → `processStripeEventRefunded()` — refund fetched from Stripe API, per-refund REFUND transaction |

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
