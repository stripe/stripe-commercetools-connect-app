# Business Rule: Multirefund

Enhanced refund tracking for multiple refunds on a single charge. Controlled by `STRIPE_ENABLE_MULTI_OPERATIONS=true`.

---

## Rule 1: Multirefund uses the Stripe refund API for accurate amounts

**What:** When `STRIPE_ENABLE_MULTI_OPERATIONS=true` and `charge.refunded` arrives, `processStripeEventRefunded()` calls `stripe.refunds.list({ charge })` to fetch the actual refund ID and amount instead of using the charge-level `amount_refunded`.

When `STRIPE_ENABLE_MULTI_OPERATIONS=false`, `charge.refunded` is processed via the standard `processStripeEvent()` path (uses charge-level data only).

**Why:** Stripe's charge-level `amount_refunded` is cumulative; fetching the individual refund object gives the exact amount for that specific refund operation.

**Invariant:** Each `charge.refunded` event maps to the most recent refund on the charge (`refunds.data[0]`). The refund's `id` is used as `pspReference` and `interactionId` on the CT transaction.

**Implementation:** `stripe-payment.service.ts:1932-1982` → `processStripeEventRefunded()`.

---

## Rule 2: A refund is not final when it is created — `refund.updated` and `refund.failed` own the correction

**What:** `charge.refunded` fires when the Refund object is **created**, which on a delayed rail is not the same as succeeded — a bank-transfer refund is created `pending` and resolves minutes to days later. `refund.updated` and `refund.failed` are registered unconditionally and write a correcting `Refund/Failure` when Stripe later rejects a refund.

`refunds.create` carries an **idempotency key**, so a retried request does not issue a second real refund. It also stamps the commercetools payment id onto the refund's `metadata`, because a `Refund` object does not inherit the PaymentIntent's metadata.

**Invariant:** No refund is recorded as terminally successful on the strength of `charge.refunded` alone when the rail can create it `pending`. Every `refunds.create` carries an idempotency key and a `ct_payment_id` in its metadata.

**Implementation:** `stripe-payment.route.ts` → `refund.updated` / `refund.failed` routing; `stripe-payment.service.ts` → `refunds.create` idempotency key and metadata stamp.

---

## Webhook routing summary

| Event | `STRIPE_ENABLE_MULTI_OPERATIONS=false` | `STRIPE_ENABLE_MULTI_OPERATIONS=true` |
|---|---|---|
| `charge.refunded` | → `processStripeEvent()` — standard refund using charge-level data | → `processStripeEventRefunded()` — refund fetched from Stripe API, per-refund REFUND transaction |
| `refund.updated` | → correcting `Refund/Failure` when Stripe rejects the refund | Same — registered unconditionally, not gated by the flag |
| `refund.failed` | → correcting `Refund/Failure` | Same — registered unconditionally, not gated by the flag |

---

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `STRIPE_ENABLE_MULTI_OPERATIONS` | `false` | Enables multirefund enhanced tracking (`charge.refunded`) |
