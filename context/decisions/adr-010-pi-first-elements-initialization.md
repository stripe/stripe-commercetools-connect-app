# ADR-010: `pi_first` Elements initialization, and why it ships disabled

**Status:** Accepted — implemented, deliberately not enabled
**Date:** 2026-08-05

## Context

Bank transfers (`customer_balance`) do not render in the Payment Element under this connector's
default flow. Stripe's documentation for bank transfers with Elements requires initializing Elements
with a `clientSecret` from a server-created PaymentIntent, and states that the deferred intent flow —
`elements({ mode, amount, currency })`, with the PaymentIntent created at submit — is **not
supported** for this payment method. The same constraint already applied to BLIK, which is why
`ct-connect-stripe-checkout` has a `pi_first` flow (its `adr-006-pi-first-blik-toctou.md`).

An earlier analysis of this work concluded that bank transfers did **not** need `pi_first`, reading
Stripe's line "if you create the deferred intent from the client-side you can't use
`customer_balance` — create the PaymentIntent server-side" as meaning that server-side creation was
sufficient. It is not: the requirement is `clientSecret`-based Elements. That conclusion is retracted,
and the retraction is recorded in `payment-behavior-resolver.ts` where it had been used to justify
omitting `flowType` from the ported rule schema.

Measured on a developer Stripe account before deciding, because several cheaper explanations had to be
ruled out first:

| Measurement | Result |
| --- | --- |
| PaymentIntent with `automatic_payment_methods` **and** a customer | **does** include `customer_balance` |
| Same, without a customer | does not — a guest cart has no Stripe Customer |
| Same, with `capture_method: 'manual'` | does not — also drops `us_bank_account` and `crypto` |
| **Deferred** Element: authenticated cart, saved Stripe Customer, `capture_method: automatic`, `setup_future_usage` unset | **no bank transfer tab** |

So the account, the currency, the amount and the customer were all correct. The initialization flow
was the cause.

## Decision

Port `pi_first` from `ct-connect-stripe-checkout` as a **per-cart, opt-in** Elements initialization
strategy, selected by `STRIPE_PAYMENT_FLOW` or by a `flowType` entry in
`STRIPE_PAYMENT_BEHAVIOR_RULES`, defaulting to `deferred`. **Ship it disabled**, with the two open
defects below recorded in `connect.yaml` where a merchant reads them.

Implemented in two halves: the processor side (commit `139b685`) resolves `flowType`, suppresses
`setup_future_usage` under `pi_first`, and returns the field in the `/config-element` response; the
enabler side (commit `3120046`) fetches the PaymentIntent eagerly at mount, initializes
`elements({ clientSecret })`, and reads the cached response at submit.

Verified end to end: with `STRIPE_PAYMENT_BEHAVIOR_RULES={"US":{"flowType":"pi_first"}}` the Payment
Element renders a **Bank transfer** tab, and the processor log shows the PaymentIntent created during
mount rather than at submit.

### Three design choices worth recording

**Guards are allow-lists, not negations.** The eager fetch runs only when `paymentElementType` is
exactly `'paymentElement'` and `paymentMode` is exactly `'payment'`. Express Checkout calls
`elements.update({ amount })` on shipping changes, which Stripe rejects on a `clientSecret`-based
instance; a subscription or setup cart never calls `getPayment()`, so an eager fetch would create a
one-time PaymentIntent and a commercetools Payment that nothing ever confirms. Written as allow-lists
so an unset or unrecognized value stays on `deferred`, which is the safe side.

**Submit branches on the cached response, not on `flowType`.** Keying on `flowType` was a real defect
caught in review: a cart can resolve to `pi_first` and still be opted out by a guard, and such a cart
carried `flowType` with no cached response, so submit threw instead of paying — Express Checkout could
never complete a payment on any cart matching a `pi_first` rule. Two conditions deciding one thing
drift apart the moment a third guard is added. Branching on the cache makes that state
unrepresentable.

**`flowType` resolves through `cart.country` only, never a billing country.** `flowType` drives the
`setup_future_usage` suppression, so it changes PaymentIntent parameters — see
`adr-009` and KI-046. `captureMethod` and `setupFutureUsage` keep the wider discriminator because they
select policy rather than PaymentIntent parameters. The asymmetry is intentional.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Keep `deferred` and add `payment_method_types: ['customer_balance']` to the PaymentIntent | The PaymentIntent is created at submit, so it cannot affect which tabs the Element renders at mount. Measured: `automatic_payment_methods` already resolves `customer_balance` when a customer is present, and the tab still does not appear |
| Suppress `setup_future_usage` and expect the tab to appear | Was the original plan. Measured false: `payment_method_save_usage` is unset in every current environment, so there is nothing to suppress, and the tab does not appear regardless. It is a **guard** for when a merchant configures it, not the enabler |
| A global `STRIPE_ENABLE_BANK_TRANSFERS` flag | A fourth global env var doing worse what the per-cart resolver already does. Eligibility **is** the rule entry: no entry means the feature is absent, which is also the conservative answer to the open commercial question about losing saved payment methods on those carts |
| Make `pi_first` the default | Would ship both defects below to every cart. `deferred` is correct for every method except the two that cannot use it |
| Wait for the cart-freeze decision before implementing | Would have left the central question — does `pi_first` make the tab appear — unanswered while a product decision was debated about an approach that might not work. Implementing first, disabled, answered it for the cost of one session |

## Consequences

**Positive**

- Bank transfers can render. Confirmed, not projected.
- BLIK and any future PaymentIntent-bound method get the same mechanism.
- Convergence with `ct-connect-stripe-checkout`: same rule schema, same field names, so one
  `STRIPE_PAYMENT_BEHAVIOR_RULES` map serves both connectors.
- Opt-in and off by default, so the defects below reach nobody until someone adds a rule entry.

**Negative**

- **A PaymentIntent and a commercetools Payment are orphaned per mount.** `GET /payments` uses
  `crypto.randomUUID()` as its idempotency key and `handleCtPaymentCreation` always creates a new CT
  Payment rather than reusing the cart's. Checkout's ADR-006 accepts orphan PaymentIntents and notes
  they cannot be avoided without a deterministic key; here it is two objects, not one. Mitigated only
  by calling once — and `_Setup` runs per enabler construction, not per mount, so a remount that
  reinstantiates (React StrictMode) fetches again. Closing this needs a deterministic idempotency key
  on the processor (Issue 5).
- **The cart is frozen at mount instead of at submit** (KI-044). `freezeCart` lives inside
  `createPaymentIntent`, so merely opening the payment page freezes the cart — and the sample site
  calls `clearCart()` on a non-`Active` cart, so a shopper who opens checkout, leaves, and returns
  finds an **empty cart**. With bank transfers the funding window is days, so this is the normal path.
- Under `pi_first`, `customerOptions` and `customerSessionClientSecret` are omitted, so those carts do
  not display saved payment methods. This is a **choice**, matching checkout, not a Stripe constraint —
  the SDK permits both on the `clientSecret` variant. `setup_future_usage` genuinely is prohibited
  there, so saving a *new* method cannot work under `pi_first` regardless.

**Risks**

- **The confirm gate validates the amount against a snapshot** (KI-047). It compares the PaymentIntent
  amount against `ctPayment.amountPlanned`, captured at PaymentIntent creation, never against the
  cart's current total. Under `deferred` that snapshot is milliseconds old; under `pi_first` it can be
  as old as the page, and `/shipping-methods/update` can change the total in between — producing an
  `Authorization/Success` for less than the cart is worth, with nothing flagging it. Excluding Express
  does not close it: those are HTTP endpoints with session auth, reachable from a Payment Element page.
- KI-044 and KI-047 are the **two open reasons** `connect.yaml` gives for not enabling `pi_first`. The
  first is a UX and data-hygiene problem; the second is financial correctness. Both must be resolved
  before any merchant enablement, and KI-047 in particular means this is not a decision that can be
  made on UX grounds alone.
