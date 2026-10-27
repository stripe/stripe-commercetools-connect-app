# Bank Transfer Payment (`customer_balance`, async funding)

**Trigger:** Buyer selects Bank transfer in the Payment Element and submits. Requires the cart to
resolve to `pi_first`.
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
   CT Payment (`Authorization/Initial`) are created here. —
   `enabler/src/payment-enabler/payment-enabler-mock.ts` (`_Setup`, `fetchPiFirstPayment`),
   `processor/src/services/stripe-payment.service.ts` (`createPaymentIntent`)
2. Buyer selects Bank transfer and submits. The enabler reuses the **cached** PaymentIntent response. —
   `enabler/src/dropin/dropin-embedded.ts` (`createPayment`)
3. `confirmPayment({ redirect: 'if_required' })` returns the PaymentIntent in `requires_action` with
   `next_action.type === 'display_bank_transfer_instructions'`. **Stripe.js renders no UI for this**
   next action, unlike 3DS — the storefront owns it. The enabler propagates it as an error via
   `onError`.
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
   error and returns. — `processor/src/services/stripe-payment.service.ts`

## Error Paths

| Condition | Behavior | File |
| --- | --- | --- |
| Card 3DS or Boleto emits `requires_action` | Log-only, no CT write. The narrow `next_action.type` predicate is what separates them | `processor/src/routes/stripe-payment.route.ts` |
| ACH micro-deposits emit `requires_action` | A second predicate, `isMicrodepositNextAction()` (`verify_with_microdeposits`), routes the event through `processStripeEvent()` and freezes the cart; the converter writes an `Authorization/Pending` for `pi.amount`, the same as bank transfer | `processor/src/routes/stripe-payment.route.ts:202-213`, `processor/src/services/converters/stripeEventConverter.ts` |
| Crypto emits `requires_action` with `redirect_to_url` | Log-only. A third method beyond 3DS and Boleto | `processor/src/routes/stripe-payment.route.ts` |
| Event originates from a subscription invoice | Log-only — subscriptions are out of scope for bank transfers (`customer_balance` supports neither SetupIntents nor `setup_future_usage`) | `processor/src/routes/stripe-payment.route.ts` |
| CT write fails on `requires_action` | Re-thrown so Stripe retries | `processor/src/services/stripe-payment.service.ts` |
| CT write fails on `partially_funded` | Swallowed, HTTP 200. Deliberate — no transaction is written | `processor/src/services/stripe-payment.service.ts` |
| Buyer never wires the funds | The merchant cancelling the PaymentIntent in the Dashboard emits `payment_intent.canceled` → `Authorization/Failure` + `CancelAuthorization/Success` → cart unfrozen | — |
| Funds clawed back after the order exists | `customer_cash_balance_transaction.created` with `funding_reversed` → alertable `log.error`, **no CT write** | `processor/src/routes/stripe-payment.route.ts` |
| Guest cart | Cannot pay by bank transfer: `customer_balance` requires a Stripe Customer and a guest cart has none | `processor/src/services/stripe-customer.service.ts` |

## Notes

- **The interface interaction is redacted before persistence.** A bank transfer instructions payload
  carries the merchant's virtual account — full IBAN, sort code, routing number — plus
  `hosted_instructions_url` and a live `client_secret`. All are stripped; `reference` and
  `amount_remaining` are kept, which is what support needs. Other flows keep a byte-identical
  interaction.
- **Currency variants.** `eu_bank_transfer` additionally requires a `country`, which accepts only DE,
  FR, IE or NL. The mapper (`processor/src/mappers/bank-transfer-mapper.ts`) runs on EUR carts only,
  fed from the merchant's trusted rule (`euBankTransferCountry`, `stripe-payment.service.ts:567`). A
  `customer_balance` option sent by the browser on `POST /payments` is discarded, never merged
  (`stripe-payment.service.ts:918-934`), so a shopper cannot choose the account the funds are wired to.
- **`amount_remaining` is invisible in commercetools.** It lives only on the PaymentIntent and in
  Stripe's hosted instructions.
