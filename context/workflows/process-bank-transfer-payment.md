# Bank Transfer Payment (`customer_balance`, async funding)

**Trigger:** Buyer selects Bank transfer in the Payment Element and submits. Requires the cart to
resolve to `pi_first` (see `decisions/adr-010-pi-first-elements-initialization.md`) — **not enabled in
any environment today**, for the two reasons in that ADR's Consequences.
**Modules involved:** enabler (Payment Element initialized with a `clientSecret`), processor
(PaymentIntent creation, webhook handling → CT transactions), storefront (the funding instructions UI —
Stripe.js renders none).
**Outcome:** A CT Payment whose `Authorization` transaction reflects the funding lifecycle —
`Initial` → `Pending` (awaiting the wire) → `Success` (funds arrived) or `Failure` (cancelled) — plus a
`Charge/Success` transaction and a CT order **only** once funds arrive.

> **No CT order exists while funds are in flight.** `OrderPaymentState` has only `PAID` and `FAILED`;
> there is no intermediate order state. The in-flight state is represented solely as an
> `Authorization/Pending` transaction on a frozen cart.

## Happy Path

1. **Mount.** The cart resolves to `pi_first`, so the enabler fetches the PaymentIntent *before*
   rendering and initializes `stripe.elements({ clientSecret })`. This is what makes the Bank transfer
   tab appear at all — the deferred flow does not support `customer_balance`. The PaymentIntent and the
   CT Payment (`Authorization/Initial`) are created here, and **the cart is frozen here** (KI-044). —
   `enabler/src/payment-enabler/payment-enabler-mock.ts` (`_Setup`, `fetchPiFirstPayment`),
   `processor/src/services/stripe-payment.service.ts` (`createPaymentIntent`)
2. Buyer selects Bank transfer and submits. The enabler reuses the **cached** PaymentIntent response —
   it must not call `getPayment()` again, which would create a second PaymentIntent and a second CT
   Payment. — `enabler/src/dropin/dropin-embedded.ts` (`createPayment`)
3. `confirmPayment({ redirect: 'if_required' })` returns the PaymentIntent in `requires_action` with
   `next_action.type === 'display_bank_transfer_instructions'`. **Stripe.js renders no UI for this**
   next action, unlike 3DS — the storefront owns it. The enabler propagates it as an error via
   `onError`, which is the intended contract (checkout's `adr-006`), not a bug.
4. The storefront narrows that error on `next_action.type` and shows the funding reference, the
   outstanding amount and the financial addresses. Stripe also emails the same instructions to the
   customer, so the reference is never only on screen. — sample site `PendingPage.tsx`
5. Stripe emits `payment_intent.requires_action`. The processor routes it to this flow **only** when
   `isBankTransferNextAction()` passes, and writes one `Authorization/Pending` for the full
   `pi.amount` — never `amount_received`, which is `0` until the wire lands. It also freezes the cart
   here: this is the bank transfer's commitment point, since its confirm returns `requires_action` and
   never reaches the confirm endpoint. —
   `processor/src/utils.ts`, `processor/src/services/converters/stripeEventConverter.ts`
6. *(Days later.)* Buyer wires the funds quoting the reference. Partial payments emit
   `payment_intent.partially_funded`, which writes **no** CT transaction — only the interface
   interaction — so the single full-amount `Authorization/Pending` stays the truth.
7. Funds complete → PI → `succeeded`. `payment_intent.succeeded` writes `Charge/Success`, transitions
   the pending `Authorization` to `Success`, and **creates the CT order** — the only place an order is
   created in this flow. Order creation is gated: it requires `pi.amount` to equal the cart's current
   total, `pi.amount_received` to equal `pi.amount`, and the currency to match. On a mismatch it logs an
   error and returns, leaving a paid-without-order state for manual reconciliation. The freeze at step 5
   is what normally keeps the totals equal; this gate is the backstop for when it does not. —
   `processor/src/services/stripe-payment.service.ts`

## Error Paths

| Condition | Behavior | File |
| --- | --- | --- |
| Card 3DS or Boleto emits `requires_action` | Log-only, no CT write. The narrow `next_action.type` predicate is what separates them; a loose check would write a Pending authorization on every 3DS payment | `processor/src/routes/stripe-payment.route.ts` |
| ACH micro-deposits emit `requires_action` | **Not this flow, but not log-only either.** A second predicate, `isMicrodepositNextAction()` (`verify_with_microdeposits`), routes the event through `processStripeEvent()` **and** freezes the cart — the converter writes an `Authorization/Pending` for `pi.amount` (`stripeEventConverter.ts:164-177`, case `PAYMENT_INTENT__REQUIRED_ACTION`), the same as bank transfer (it does **not** write no transaction). It is kept separate from `isBankTransferNextAction()` on purpose, so the release-gate tests pinning the bank-transfer predicate stay green. Confirmed by the runtime baseline (scenario 5a: micro-deposit → `Authorization/Pending`, cart Frozen). See KI-050 and `decisions/adr-016-ach-microdeposit-underpayment-backstop.md` | `processor/src/routes/stripe-payment.route.ts:202-213`, `processor/src/services/converters/stripeEventConverter.ts` |
| Crypto emits `requires_action` with `redirect_to_url` | Log-only. A third method beyond 3DS and Boleto, found by testing against a real account rather than fixtures | `processor/src/routes/stripe-payment.route.ts` |
| Event originates from a subscription invoice | Log-only — subscriptions are out of scope for bank transfers (`customer_balance` supports neither SetupIntents nor `setup_future_usage`) | `processor/src/routes/stripe-payment.route.ts` |
| CT write fails on `requires_action` | Re-thrown so Stripe retries | `processor/src/services/stripe-payment.service.ts` |
| CT write fails on `partially_funded` | Swallowed, HTTP 200. Deliberate — no transaction is written, so the loss is one audit line, and re-throwing would cause a retry storm on a frequent event (KI-035) | `processor/src/services/stripe-payment.service.ts` |
| Buyer never wires the funds | **The cart stays frozen indefinitely.** Stripe emits no expiry event and `payment_intent.payment_failed` never fires for an unfunded transfer. The only lever is the merchant cancelling the PaymentIntent in the Dashboard, which emits `payment_intent.canceled` → `Authorization/Failure` + `CancelAuthorization/Success` → cart unfrozen | — |
| Funds clawed back after the order exists | `customer_cash_balance_transaction.created` with `funding_reversed` → alertable `log.error`, **no CT write**. Does not surface as a dispute; the log is the only detection (KI-041) | `processor/src/routes/stripe-payment.route.ts` |
| Guest cart | Cannot pay by bank transfer: `customer_balance` requires a Stripe Customer and a guest cart has none | `processor/src/services/stripe-customer.service.ts` |

## Notes

- **The interface interaction is redacted before persistence.** A bank transfer instructions payload
  carries the merchant's virtual account — full IBAN, sort code, routing number — plus
  `hosted_instructions_url` and, because this is the first path that persists an *open* PaymentIntent, a
  live `client_secret`. All are stripped; `reference` and `amount_remaining` are kept, which is what
  support needs. Other flows keep a byte-identical interaction.
- **Registering the events in `actions.ts` does not register them on an existing webhook endpoint.**
  `updateWebhookEndpoint` swallows its errors (KI-004). Verify after every deploy that
  `enabled_events` actually contains `payment_intent.partially_funded` and
  `customer_cash_balance_transaction.created`, or bank transfers *appear* to work at checkout and never
  complete (KI-042).
- **Currency variants.** `eu_bank_transfer` additionally requires a `country`, which accepts only DE,
  FR, IE or NL. Confirmed by the Stripe API itself, which rejected an invalid value with a 400
  enumerating the five accepted variants. The mapper for this is P3 and is not implemented yet.
- **`amount_remaining` is invisible in commercetools.** It lives only on the PaymentIntent and in
  Stripe's hosted instructions.
