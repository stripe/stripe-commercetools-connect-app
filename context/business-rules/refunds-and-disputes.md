# Refunds and Disputes

How money flows back out of a completed payment, which of those the connector models, and why the two
must never be conflated.

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

---

## Rule 2: disputes are not modelled in this connector, by decision

**What:** No `charge.dispute.*` event is registered or handled, and none should be added. Disputes and
chargebacks are handled in the Stripe Dashboard.

**Why:** No chargeback or dispute workflow exists in the connector, and disputes stay with the PSP —
commercetools carries ecommerce and payment statuses, Stripe carries the dispute. Responding to a
dispute means submitting evidence and tracking deadlines.

**Invariant:** `enabled_events` in `connectors/actions.ts` contains no `charge.dispute.*` entry.

**Implementation:** `processor/src/connectors/actions.ts` — the `enabled_events` array.

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

---

## Rule 4: a failed refund means the money never left

**What:** A refund that ends `status: failed` returns the charge to its unrefunded state. This is not a
new payment and not a reversal of a reversal — it means the return never happened.

**Why:** A failed refund leaves the charge reading `amount_refunded: 0`, `refunded: false`,
`status: succeeded`, while the refund object itself carries `status: failed` — the shopper paid and was
not refunded.

**Behaviour:** The `refund.updated` / `refund.failed` handler writes a matching `Refund/Failure`, with
the refund's own id as `interactionId`, for a refund that later failed. commercetools transactions are
append-only; the pair is the record, and a consumer summing refunds must net them.

**Implementation:** `processor/src/services/stripe-payment.service.ts` —
`processStripeEventRefundFailed`, reached from the `refund.updated` / `refund.failed` route branch.

> **A refund that failed cannot simply be retried.** Stripe rejects a second attempt to refund the same
> charge.
