# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Two work streams ship here. **SB3-206** adds ACH Direct Debit on subscriptions and the async-rail
safety work around it; it needs no configuration — ACH is a Stripe Dashboard toggle. **SB3-207** adds
bank transfers and ships **disabled** behind `STRIPE_PAYMENT_FLOW=pi_first`. Entries below are tagged
with the stream they belong to where it is not obvious from the text.

### Added

- **ACH Direct Debit on subscriptions (`us_bank_account`)** — SB3-206. `POST /subscription/confirm` now
  retrieves the real PaymentIntent status instead of assuming a synchronous card:
  `succeeded`/`requires_capture` → `Charge/Success`; `processing` (the ACH debit is in flight, ~2–4
  business days) → `Charge/Pending`, resolved later by `invoice.paid` (→ `Success`) or
  `invoice.payment_failed` (→ `Failure`). Any other status throws as out of scope. Previously the confirm
  wrote `Charge/Success` unconditionally, marking a subscription order paid before any money had moved —
  reproduced live. A subscription can now sit in `Charge/Pending` for days with no order yet; consumers
  must handle that state. (ADR-013)
- **ACH late-return flagging** — SB3-206. A subscription-invoice `payment_intent.payment_failed` arriving
  *after* the invoice was already paid is a post-settlement bank reversal, possible for ~60 days. Stripe
  does **not** re-fire `invoice.payment_failed`, so the invoice-driven subscription handlers never saw it
  and the commercetools order stayed paid while the funds were clawed back.
  `processSubscriptionEventLateReturn` now sets the native `paymentStatus.interfaceCode='ach_late_return'`
  (plus a human-readable `interfaceText`) — but only when an existing `Charge/Success` proves the money
  had settled; a still-`Pending` charge is an ordinary failure owned by `invoice.payment_failed`. No
  transaction, order-state or custom-field change: resolution stays in the Stripe Dashboard, like a
  dispute. The handler is best-effort and never throws, so **the flag is the only in-connector signal and
  should be wired to an alerting channel.** (ADR-014)
- **`customer.subscription.deleted` is now registered and handled** — SB3-206. It was declared in the
  event enum but never subscribed, so a subscription cart stayed `Frozen` forever once a cancellation
  exhausted its retries and the shopper could neither edit it nor retry with another method.
  `processSubscriptionEventDeleted` resolves the cart from the subscription's `ct_payment_id` metadata and
  unfreezes it — idempotent, skips a cart that is not frozen, and touches no payment or order state. The
  cart still stays frozen through the Smart Retry window; only terminal cancellation releases it. (KI-009)
- **Bank transfers (`customer_balance`)** — SB3-207. Ships **disabled**: nothing changes for an existing
  deployment unless `STRIPE_PAYMENT_FLOW=pi_first` is set. For a merchant on default settings that
  variable is the entire configuration, alongside the Bank transfers toggle they already control in the
  Stripe Dashboard.
- **`STRIPE_PAYMENT_FLOW`** — `deferred` (default) or `pi_first`. Selects how Stripe Elements is
  initialised. Bank transfers and BLIK cannot render in the deferred flow at all; `pi_first` creates the
  PaymentIntent before the Element mounts and initialises Elements with its `clientSecret`. An invalid
  value is reported to the deploy log and falls back to `deferred` rather than aborting startup.
- **`STRIPE_PAYMENT_BEHAVIOR_RULES`** — JSON map of cart country or commercetools store key to per-market
  overrides, ported from `ct-connect-stripe-checkout` so one map can serve both connectors. Supports
  `flowType`, `captureMethod`, `setupFutureUsage` and `euBankTransferCountry`.
- **`euBankTransferCountry`** — the only new rule field, and optional. Chooses which of the merchant's
  IBANs a EUR shopper is instructed to wire funds to. Omit it and Stripe shows an Irish IBAN; the payment
  works either way. Accepts `DE`, `FR`, `IE`, `NL` — Stripe's IBAN-localisation list, which is not the
  list of markets that can pay: EUR bank transfers are accepted for accounts in 34 countries, so a
  Spanish merchant takes them and still shows one of those four IBANs.
- **Webhook events** `payment_intent.partially_funded`, `customer_cash_balance_transaction.created`,
  `refund.updated` and `refund.failed` are now registered and routed.
- **`/pending` support** — `payment_intent.requires_action` carrying
  `display_bank_transfer_instructions` writes an `Authorization/Pending` for the full amount, and the
  order is created only when funds arrive.

### Changed

- **A transient commercetools write failure in a subscription handler now makes Stripe redeliver** —
  SB3-206. `processSubscriptionEventPaid` / `processSubscriptionEventFailed` caught every error and
  returned 200, so a version conflict, a timeout or a 5xx silently left Stripe updated and commercetools
  not, with nothing to bring them back into sync. Errors matching a transient pattern
  (`ConcurrentModification | 409 | 429 | 502 | 503 | ETIMEDOUT | ECONNRESET`) are now rethrown, which
  responds non-2xx and lets Stripe's own redelivery recover. Permanent errors — bad credentials, a missing
  customer — keep the previous logged-and-swallowed behaviour, deliberately: rethrowing everything was
  tried first and turned a permanent failure into a days-long redelivery storm. The split is a regex on
  error text, so an unrecognised transient error is still swallowed. (ADR-015, KI-003)
- **The cart is no longer frozen when the PaymentIntent is created.** Harmless under `deferred`, where
  the PaymentIntent was created at submit; under `pi_first` it is created at mount, so the cart was
  locked before the shopper picked anything with no unfreeze path. Each rail now freezes at its own
  commitment point — instant rails at confirmation, bank transfer when Stripe issues funding
  instructions. The split is forced by the rails: a bank transfer confirm returns `requires_action`,
  which the confirm gate rejects, and the enabler does not call that endpoint on this path. (KI-044)
- **Confirmation validates the cart's current total** instead of the amount snapshot taken at
  PaymentIntent creation. Under `pi_first` that snapshot can be as old as the page, and the
  shipping-methods endpoints can change the total inside that window. Ships with the freeze change and
  must not be reverted separately — the freeze was what previously prevented the divergence. (KI-047)
- `confirmPayments` now logs why it rejected a confirmation. It previously swallowed the error, so a 400
  reached the browser with nothing on the server explaining it.
- `refunds.create` now carries an idempotency key and stamps the commercetools payment id onto the
  refund's metadata. It was the only Stripe write in the service without a key, so a retried request
  issued a second real refund; and a `Refund` object does not inherit the PaymentIntent's metadata, so
  without the stamp a later refund event cannot be routed back to its payment.
- `customer_balance` payment method options supplied by the client are discarded rather than rejected.
  The protection that matters — a browser must not choose which bank account funds are wired to — is
  unchanged, but dropping the key changes no outcome a shopper can see, so refusing the sale was the
  wrong trade.

### Fixed

- **An ACH micro-deposit payment created the order at the cart's *mutated* total, not the amount
  collected.** SB3-206. Micro-deposit verification confirms to `requires_action`
  (`next_action.type = verify_with_microdeposits`) and settles days later, and three separate protections
  all missed that rail: the confirm gate's amount validation only runs for
  `succeeded`/`requires_capture`/`processing`; the `requires_action` freeze covered only bank transfer, so
  the cart stayed editable; and `handlePaymentIntentSucceededFlow` logged an `amountMismatch` warning and
  created the order anyway. Reproduced live on 2026-08-21: pay $6.99, return and add $4000 of items, and
  on settlement the order was created `Ordered` at $4000 against $6.99 collected. Fixed in two layers —
  a **universal backstop** (order creation now requires `pi.amount === currentCartTotal`,
  `pi.amount_received === pi.amount` and a currency match, comparing integer minor units so JPY is
  correct; on mismatch it logs an error and returns, plus an idempotency guard that skips an already
  `Ordered` cart) and a **freeze on the micro-deposit rail** (new `isMicrodepositNextAction`, kept
  separate from `isBankTransferNextAction` so the 3DS/Boleto release gates stay green). (KI-050, ADR-016)
- **The subscription-invoice guard is now keyed on the connector's own metadata, not a removed Stripe
  field.** SB3-206, extending the KI-043 fix below. `isFromSubscriptionInvoice` read
  `paymentIntent.invoice` / `charge.invoice`, absent on Clover as it was on Basil, so subscription
  `payment_intent.*` and `charge.*` events leaked into the one-time `processStripeEvent` — writing a
  duplicate `Charge` and, on failure, wrongly unfreezing the cart. Now keyed on
  `METADATA_SUBSCRIPTION_ID_FIELD`, with the invoice reads kept as a fallback for accounts pinned to a
  pre-Basil version. This also closes the double-handling on `payment_intent.processing` and
  `payment_intent.payment_failed`, not just the `succeeded` cases. (KI-041, KI-043)
- **`isFromSubscriptionInvoice` had been dead since the Basil API version.** It tested
  `paymentIntent.invoice`, removed by Stripe in `2025-03-31.basil` and absent from `Charge` on current
  versions too, so it returned `false` on every event without throwing or logging. Observed live: one
  359.15 USD mixed-cart charge produced **three** commercetools transactions — Authorization and Charge
  from the invoice, plus a duplicate Charge that this guard should have suppressed. Now keyed on the
  connector's own `subscription_id` metadata. Every existing test fabricated the removed field, which is
  why the suite stayed green throughout. (KI-043)
- **A refund that Stripe later rejected stayed recorded as successful forever.** `charge.refunded` fires
  when the Refund object is *created* — which on a delayed rail is not the same as succeeded, since a
  bank-transfer refund is created `pending`. `refund.updated` and `refund.failed` are now handled and
  write a correcting `Refund/Failure`.
- The `capture_method` override on bank-transfer carts no longer rewrites `automatic_async`, which is
  compatible with `customer_balance`. The previous unconditional force to `automatic` would have
  downgraded that merchant's setting for **every** payment method on the cart, since `capture_method` is
  PaymentIntent-level.

### Documentation

- `context/business-rules/refunds-and-disputes.md` — separates refunds, card chargebacks and ACH
  revocations, with sources. Records that disputes stay in the Stripe Dashboard for every connector, and
  that a bank transfer has no dispute object at all: reversal is possible only in USD and CAD, within
  five days, and surfaces as a `customer_cash_balance_transaction` of type `funding_reversed`.
- `context/workflows/process-bank-transfer-payment.md`, `context/decisions/adr-010-pi-first-elements-initialization.md`.
- KI-035 through KI-050 added; KI-009, KI-043, KI-044, KI-045, KI-046, KI-047 and KI-050 resolved.
- SB3-206 records four decisions: `adr-013-async-ach-charge-pending.md`, `adr-014-ach-late-return-flag.md`,
  `adr-015-redeliver-transient-ct-errors.md` and `adr-016-ach-microdeposit-underpayment-backstop.md`.
  `context/failure-modes.md` gains the ACH late-return scenario, `context/business-rules/payment-confirmation.md`
  the underpayment backstop rule, and `context/business-rules/subscription-lifecycle.md` the async
  `Charge/Pending` states. The ACH ADRs were renumbered 010–012 → 013–015 when the SB3-207 branch merged
  first and claimed those numbers; no document still cites the old numbering.
- Two previously recorded justifications were found to be false during review and were retracted in
  place rather than deleted. KI-046 claimed `captureMethod` and `setupFutureUsage` "select policy, not
  PaymentIntent parameters" — both *are* PaymentIntent parameters; the decision to leave them on the
  wider discriminator stands, but on bounded-choice grounds now recorded in KI-048. KI-042 claimed a
  failed webhook registration meant bank transfers "never complete" — `payment_intent.requires_action`
  and `payment_intent.succeeded` were already registered before this work, so what a failed update
  actually costs is refund correctness and observability, not checkout.

### Known gaps

- A commercetools `Chargeback` transaction is still written on every refund. Pre-existing, wrong in both
  platforms' models, and now contradicted by the disputes decision. Removing it changes card and
  subscription behaviour, so it needs an owner's decision — as does the companion change of moving
  `Refund` ownership to `refund.updated`.
- PaymentIntents and commercetools Payments created at mount are orphaned when a shopper abandons the
  page. Carts are no longer collateral damage; this needs a deterministic idempotency key at creation.
- An unfunded bank transfer makes the cart read as paid in full: the connect-payments-sdk counts an
  `Authorization` in `Pending` as an approved payment for the full `amountPlanned`, so `getPaymentAmount`
  throws once funding instructions are issued. No money is lost and the order is correct when funds
  arrive, but a shopper reloading the payment page gets an error instead of a designed "awaiting your
  transfer" state. Shared with the crypto settlement path already in production. (KI-049)
- The root `README.md` embeds a verbatim copy of `connect.yaml`'s `deployAs` block. Both were updated
  together here, but nothing keeps them in sync — the next variable added to `connect.yaml` will silently
  diverge from the README again.
- Refund idempotency is implemented but unverified end to end — Stripe blocks retrying a refund against a
  card whose refund already failed.
- An abandoned ACH micro-deposit cart stays `Frozen` with no unfreeze-on-abandonment. The freeze added for
  that rail inherits the residual the KI-044 fix left behind, which the bank-transfer rail shares.
- The micro-deposit freeze covers only ACH. Boleto, OXXO, konbini and multibanco share the same
  mutated-cart exposure and rely on the universal order-creation backstop alone; generalising the freeze
  is a follow-up.
- A blocked underpayment leaves a **paid-without-order** state: the `Charge/Success` has already persisted
  upstream, and by hub rule the divergence is surfaced for manual reconciliation, never auto-corrected.
  There is no auto-refund.
- The `ach_late_return` flag is best-effort. If the commercetools write fails, the error is logged, the
  webhook still returns 200, Stripe does not redeliver, and the flag is simply absent — with no other
  signal that a settled subscription payment was reversed.

### Out of scope, by decision

- **Bank transfer on subscriptions.** Declined by Stripe on 2026-08-06: a renewal debits a cash balance
  the shopper must keep pre-funded, which needs a top-up flow, handling for an empty balance at renewal,
  and cash-balance reconciliation. Both guards enforcing this record that reason.
- **Refund destination.** Stripe's default is used; a per-market toggle is a backlog item.
- **Guest bank transfers.** Not a decision but a Stripe constraint — `customer_balance` requires a
  Customer object, so the method never renders for an unauthenticated cart.
- **ACH micro-deposit verification on subscriptions.** `confirmSubscriptionPayment` throws on
  `requires_action`, so the rail is not offered for a subscription cart. The one-time path handles
  micro-deposits and is protected by the underpayment backstop; extending it to subscriptions is separate
  work. (ADR-013)
- **Modelling an ACH late return as a commercetools reversal.** Auto-reconciling a PSP reversal would make
  the connector the source of truth for order state, which it is not. Reversals stay with Stripe, in line
  with the same decision already taken for disputes and chargebacks. (ADR-014)
