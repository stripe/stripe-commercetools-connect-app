# Crypto / Stablecoin Payment (async settlement)

**Trigger:** Buyer selects the Crypto (USDC / stablecoin) option in the Payment Element and submits.
**Modules involved:** enabler (Payment Element + redirect to Stripe's hosted crypto page), processor (webhook handling → CT transactions).
**Outcome:** A CT Payment whose `Authorization` transaction reflects the async settlement lifecycle — `Initial` → `Pending` (settling) → `Success` (settled) or `Failure` (failed/expired) — plus a `Charge/Success` transaction and a CT order on success.

## Happy Path

1. Buyer selects Crypto → enabler triggers PaymentIntent creation; the connector creates the CT Payment with an `Authorization/Initial` transaction. — `processor/src/services/stripe-payment.service.ts` (`createPaymentIntent`)
2. `automatic_payment_methods` surfaces Crypto (enabled in the Stripe Dashboard). The buyer is **redirected** to `crypto.stripe.com` to connect a wallet and pay USDC on-chain. PI → `requires_action`.
3. On-chain funds submitted → PI → `processing`; Stripe emits `payment_intent.processing`.
4. Processor handles `payment_intent.processing` → converter maps it to an `Authorization/Pending` transaction (amount taken from the PI `amount`, **not** `amount_received`), guarded so it is skipped if a `Charge/Success` or `Authorization/Pending` already exists for the Payment. — `processor/src/routes/stripe-payment.route.ts`, `processor/src/services/converters/stripeEventConverter.ts`, `processor/src/services/stripe-payment.service.ts`
5. Settlement confirmed → PI → `succeeded`. `payment_intent.succeeded` writes `Charge/Success` and transitions the pending `Authorization` to `Success`; the order is created. `charge.succeeded` (captured) adds no extra transaction.

## Error Paths

| Condition | Behavior | File |
| --- | --- | --- |
| Deposit validation fails / wrong network / under- or over-payment | `payment_intent.payment_failed` → `Authorization/Failure` (transitions the pending auth) | `stripeEventConverter.ts` (`PAYMENT_INTENT__PAYMENT_FAILED`) |
| Buyer never deposits; PI expires | `payment_intent.canceled` → `Authorization/Failure` + `CancelAuthorization/Success` | `stripeEventConverter.ts` (`PAYMENT_INTENT__CANCELED`) |
| Wallet has insufficient funds | Stripe's hosted page blocks submission (Pay button disabled); no payment attempt reaches the connector | (Stripe-hosted UI) |
| CT write fails while handling `processing` | Handler re-throws → webhook responds non-2xx → Stripe retries (no silent divergence) | `stripe-payment.service.ts` |

## Notes

- **Not Bitcoin** — this is Stripe stablecoin payments (USDC and others) via the Payment Element. Enabling it is a Stripe Dashboard action (triggers a manual review); no `payment_method_types` change in code (`automatic_payment_methods`).
- Crypto only supports **automatic capture** and **cannot be saved** for future use. Stripe automatically excludes it from flows that set `capture_method: manual` or `setup_future_usage` (subscriptions / SetupIntent) — so crypto never appears there. No connector-side guard is needed.
- Testnet settles in seconds; **mainnet can take minutes** — the `Pending` window is the visible "payment in progress" state in commercetools.
- Concurrent webhook writes can raise a `ConcurrentModification` (409), recovered by retry — see `known-issues.md` KI-033.
- The synchronous `/confirmPayments` gate (`updatePaymentIntentStripeSuccessful`) now validates the real PI status and writes `Authorization/Pending` for a `processing` PI. **For crypto this gate typically does not run**: `confirmStripePayment()` redirects the buyer to `crypto.stripe.com` before `confirmPaymentIntent()` is reached, so the webhook path above drives the flow. The sync gate matters for **non-redirect** async settlement (e.g. SEPA/ACH inline). See `known-issues.md` KI-034.
- Scope: **one-time payments only**. Recurring crypto (Stripe "Billing with stablecoins") is out of scope.
