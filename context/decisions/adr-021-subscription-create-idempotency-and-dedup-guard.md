# ADR-021: Derived idempotency key + pre-create dedup guard for subscription creation

**Status:** Accepted
**Date:** 2026-10-05
**Ticket:** SB3-226 (Stripe bug bounty · SAT-30740)

## Context

Both subscription-create paths in `processor/src/services/stripe-subscription.service.ts` passed a
fresh `randomUUID()` as the Stripe idempotency key on every invocation, and persisted to commercetools
only **after** `stripe.subscriptions.create()` committed:

- `createSubscription()` — route `/subscription` (`payment_behavior: 'default_incomplete'`)
- `createSubscriptionFromSetupIntent()` — route `/subscription/withSetupIntent` (`default_payment_method`). `getPaymentMode` routes charge_automatically-no-trial subscriptions to `/subscription` (`default_incomplete`); `withSetupIntent` ('setup' mode) is only used for trial / free-anchor-days / send_invoice subscriptions, which do **not** charge the first invoice immediately. The immediate-charge concern is therefore theoretical for this route in the current drop-in flow.

A fresh UUID per call gives Stripe no cross-call operation identity, so a retry after an indeterminate
response, a proxy/gateway replay, or a concurrent double-submit created a **second independent Stripe
Subscription** on the same cart. The second create also overwrote the first subscription id on the line
item, orphaning the first subscription. Reproduced live: one checkout + one retry → two subscriptions
(`sub_1UNJ6N…` / `sub_1UNJ7F…` on cart `43acf34e`).

This violated **hub Global Coding Rule 4** ("Idempotency keys are derived from platform entity identity").
The in-repo precedent for the correct pattern is the refund key at `stripe-payment.service.ts:399`
(`refund-${payment.id}-${amount}-${refundSequence}`).

## Decision

Two complementary mechanisms, because they cover different retry windows:

1. **Derived idempotency key** on both `subscriptions.create` calls:
   `subscription-${cart.id}-${cart.version}` (+ `-${setupIntentId}` on the SetupIntent path).
   Deterministic — no timestamps/random. Covers **concurrent double-submit** and **retry-before-persist**
   (same cart version → same key → Stripe dedups to one subscription). A legitimately re-versioned cart
   (new purchase) yields a new key, so genuine repeat purchases still create a new subscription.
   `priceId` is deliberately **not** part of the key: it is not stable across a retry — when the Stripe
   Price is brand-new (first purchase at that amount, or after a price change), `getStripePriceByMetadata`
   (prices.search) is not read-after-write, so a retry inside the ~1-min window mints a *second* Price
   (`prices.create` uses `randomUUID()`) → a different priceId → a different key → a second subscription.
   Only now that priceId is out of the key is **retry-before-persist for a newly-created Stripe Price**
   actually covered. Within one `cart.version` the subscription price is already fixed by the line item,
   so priceId added no identity; and if a divergent resolved price ever reused the same key, Stripe returns
   an `idempotency_error` (fail-safe, no second subscription).

2. **Pre-create dedup guard** (`findExistingSubscriptionForCart`): before creating, if the subscription
   line item already carries `stripeConnector_stripeSubscriptionId`, retrieve that subscription and
   **reconcile** (return it) instead of creating. Covers **retry-after-persist**, where the cart was
   re-versioned/frozen and the derived key would differ. The guard is bound to the cart's **server-derived
   Stripe customer** (`existing.customer === stripeCustomerId`) to prevent a client-planted foreign
   subscription id from being reused (IDOR/CWE-639), **and** to **this specific cart**
   (`existing.metadata.cart_id === cart.id`) so a reorder/`replicateCart` — which copies the
   `stripeConnector_stripeSubscriptionId` line-item field and keeps the customer — reconciles onto a fresh
   subscription for the new cart rather than the old one. Transient `retrieve` errors are rethrown (fail
   safe); only `resource_missing`/404 falls through to a fresh create.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Derived key only | Misses retry-after-persist: the cart version bumps on persist, so the retry's key differs and Stripe does not dedup. |
| Guard only | Misses concurrent double-submit: both requests read the cart before either persists the line-item id, so neither guard fires. |
| New `checkoutAttemptId` persistence store (as the reporter suggested) | Over-engineering — the connector already persists the subscription id on the line item; the guard reuses it. No new store. |

## Consequences

**Positive:** for a single cart, same-cart retry and concurrent double-submit are covered on **both**
routes — at most one Stripe Subscription across retry, concurrency, and replay for that checkout attempt.
No duplicate CT payment on reconcile (`resolveReconciledPaymentReference` reuses the existing payment via
`metadata.ct_payment_id` / `cart.paymentInfo`). The SetupIntent send_invoice path's pre-persist window is
narrowed by persisting the subscription id **before** the fragile `sendInvoice` call, so a retry after a
`sendInvoice` throw hits the guard instead of minting a second subscription. Validated live: post-fix, one
checkout + one retry → one subscription (`sub_1UNJal…`), retry reconciled, same PI + same CT payment.
Remediating subscriptions that were **already** duplicated before this fix is out of scope (a separate
merchant-remediation follow-up).

**Negative / known limitations (hardening backlog):**
- *Narrow orphan-payment window:* if the original run crashes between `createCtPayment` and
  `addCtPayment`/metadata-write, the orphan CT payment is invisible to both reconcile lookups and a retry
  creates a second CT payment. Pre-existing, very narrow; does not reopen the subscription-dup fix.
- *Empty-string `clientSecret` sentinel:* a reconciled already-`active` subscription returns
  `clientSecret: ''` with no explicit "already settled" flag; a frontend that always calls
  `confirmPayment(clientSecret)` may surface a confusing client-side error. UX/robustness only.
- *SetupIntent-route per-submit residual (`/subscription/withSetupIntent`, i.e. trial / free-anchor /
  send_invoice):* the drop-in mints a **new SetupIntent on every submit**, so the derived key's
  `setupIntentId` suffix differs per attempt. Persisting the subscription id **before** `sendInvoice`
  (this change) closes the common send_invoice window — a `sendInvoice` throw now leaves the id on the
  line item so the guard catches the retry. But if `saveSubscriptionId` **itself** fails (the id never
  reaches the line item), a shopper retry with a fresh SetupIntent gets a new key **and** an empty guard
  → a second subscription. The normal `/subscription` route is unaffected (its retry reuses the same
  key). **Accepted residual** (narrow: SetupIntent-route only, requires the CT write itself to fail).
  **Follow-up option:** before creating, look up Stripe via `subscriptions.list({ customer })` filtered
  by `metadata.cart_id` (a `list`, not the non-read-after-write `search`) and reconcile a match.

**Follow-ups (separate tickets):**
- Merchant remediation of subscriptions **already** duplicated before this fix (SB3-226 scope item; not
  in this PR).
- Close the SetupIntent-route per-submit residual above via `subscriptions.list` by `metadata.cart_id`.

**Risks:** the derived key intentionally includes `cart.version`; if a future change bumps the cart
version between a lost create-response and its retry *before* `saveSubscriptionId`, the guard (field unset)
and the key (version changed) both miss. The transient-error rethrow narrows this, but a pre-create intent
marker persisted atomically with the create would close it fully — deferred as hardening.
