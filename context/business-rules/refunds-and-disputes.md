# Refunds and Disputes

How money flows back out of a completed payment, which of those the connector models, and why the two
must never be conflated.

Written 2026-08-07 to settle a concrete defect: the connector writes a commercetools `Chargeback`
transaction on every refund. Every claim below is from Stripe's documentation, the Stripe SDK's own
event catalogue, or the commercetools platform SDK — not inference.

---

## Rule 1: a refund and a chargeback are different events with different initiators

**What:** Three distinct mechanisms return money after a successful payment. They differ in who starts
them, what Stripe object represents them, and which events Stripe emits.

| Mechanism | Who initiates | Stripe object and events | Applies to |
| --- | --- | --- | --- |
| **Refund** | the merchant | `Refund` — `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded` | every rail |
| **Dispute / chargeback** | the **cardholder**, through the card issuer | `Dispute` — `charge.dispute.created`, `.updated`, `.closed`, `.funds_withdrawn`, `.funds_reinstated` | cards |
| **ACH revocation** | the **shopper's bank** | no dispute object; surfaces as `customer_cash_balance_transaction` of type `funding_reversed` | bank transfer, USD and CAD only |

**Why:** Stripe defines a dispute as occurring *"when the cardholder contests the payment with the card
issuer"*, which then *"creates a formal dispute in the card network, which reverses the payment
immediately"*. That is a different actor, a different network and a different object from a refund the
merchant chose to issue. commercetools agrees: `Chargeback` and `Refund` are separate members of its
`TransactionType` enum.

**Invariant:** A `charge.refunded` event must never produce a commercetools `Chargeback` transaction. A
`Chargeback` transaction may only originate from a `charge.dispute.*` event.

**Implementation:** `processor/src/services/converters/stripeEventConverter.ts` — the
`CHARGE__REFUNDED` case, which currently emits both `Refund` and `Chargeback`.
`subscriptionEventConverter.ts` does the same.

**Closure criterion:**
`grep -n "CHARGE_BACK" processor/src/services/converters/*.ts` returns nothing, **or** returns only
matches inside a `charge.dispute.*` branch.

**What breaks if violated:** The payment record claims a dispute that never happened. Anything summing
transactions double-counts the returned amount. Observed 2026-08-07: a 300 EUR payment whose refund
FAILED still carried `Chargeback/Success 30000` in commercetools, asserting a chargeback that exists
nowhere in Stripe.

---

## Rule 2: disputes are not modelled in this connector, by decision

**What:** No `charge.dispute.*` event is registered or handled, and none should be added. Disputes and
chargebacks are handled in the Stripe Dashboard.

**Why:** Client decision (Stripe, product), 2026-08-06: no chargeback or dispute workflow exists in any
of their connectors, and disputes should stay with the PSP — commercetools carries ecommerce and payment
statuses, Stripe carries the dispute. The reasoning is that responding to a dispute means submitting evidence and tracking
deadlines; surfacing the status in commercetools without those controls invites a merchant to try to act
on it there.

**Invariant:** `enabled_events` in `connectors/actions.ts` contains no `charge.dispute.*` entry.

**Implementation:** `processor/src/connectors/actions.ts` — the `enabled_events` array.

**Closure criterion:** `grep -c "dispute" processor/src/` returns 0 outside comments and this document.

**What breaks if violated:** A half-modelled dispute is worse than none — the merchant sees a status in
commercetools but must still act in Stripe, and the two can disagree while money is at stake.

---

## Rule 3: for bank transfers, a reversal is a cash-balance event, not a dispute

**What:** Bank transfer payments cannot be reversed at all except in **USD and CAD**. When one is
reversed, Stripe does not raise a dispute — the money is withdrawn from the customer's cash balance and
reported as a `customer_cash_balance_transaction` with type `funding_reversed`.

**Why:** Stripe's bank transfer documentation: *"Bank transfer payments cannot be reversed, except for
USD and CAD transactions."* For USD, an ACH transfer can be revoked at the sending bank's request within
**five days** of the payment; for CAD, revocations are always initiated by the sending bank and the
receiving bank must comply. Neither path involves a card network, so no `Dispute` object exists.

**Invariant:** The only reversal signal available for a bank transfer is a
`customer_cash_balance_transaction` of type `funding_reversed` or `adjusted_for_overdraft`. Nothing else
will fire.

**Implementation:** `processor/src/routes/stripe-payment.route.ts` —
`logCustomerCashBalanceTransaction`, which raises both types at `error` level.

**Closure criterion:** `funding_reversed` and `adjusted_for_overdraft` are logged at `error` level and
that log is wired to an alert channel.

**What breaks if violated:** A completed bank transfer order can lose its funds up to five days later
with no commercetools record and no alert. This is KI-041, still open — the event is customer-scoped and
carries no `ct_payment_id`, so modelling it in commercetools is a design of its own.

> **Consequence worth stating plainly:** the bank-transfer equivalent of a chargeback already reaches
> this connector, and it is not the `Chargeback` transaction the refund path writes. It is a log line.
> Removing the spurious `Chargeback` on refunds does not remove chargeback handling, because there is
> none to remove.

---

## Rule 4: a failed refund means the money never left

**What:** A refund that ends `status: failed` returns the charge to its unrefunded state. This is not a
new payment and not a reversal of a reversal — it means the return never happened.

**Why:** Measured 2026-08-07 on a real failed refund: the charge reported `amount_refunded: 0`,
`refunded: false`, `status: succeeded`, while the refund object itself carried `status: failed` and
`failure_reason: expired_or_canceled_card`. Stripe's view is correct and complete — the shopper paid and
was not refunded.

**Invariant:** For every `Refund/Success` written from a refund that later failed, there must be a
matching `Refund/Failure` with the refund's own id as `interactionId`. commercetools transactions are
append-only; the pair is the record, and a consumer summing refunds must net them.

**Implementation:** `processor/src/services/stripe-payment.service.ts` —
`processStripeEventRefundFailed`, reached from the `refund.updated` / `refund.failed` route branch.

**Closure criterion:** A payment whose refund failed carries both a `Refund/Success` and a
`Refund/Failure` for the same amount.

**What breaks if violated:** commercetools claims money was returned that never left. Reconciliation
against Stripe silently disagrees, and a merchant may refund a second time believing the first
succeeded.

> **A refund that failed cannot simply be retried.** Measured 2026-08-07: Stripe rejects the second
> attempt with *"A previous attempt to refund charge … failed."* Recovery has to go through another
> route, which is a product question rather than a code path.

---

## What this leaves open

Removing the `Chargeback` emission changes card and subscription behaviour, not only bank transfer, so
it is a decision for the connector owner rather than a mechanical fix. The natural companion change is
moving ownership of the `Refund` transaction from `charge.refunded` to `refund.updated`, which fires
with the terminal status on both rails and can distinguish `pending` from `succeeded` — something
`charge.refunded` cannot do, because its payload omits the refunds sublist entirely.
