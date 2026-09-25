# Business Rule: Stripe Tax Integration

This connector reads Stripe Tax calculation references from the CT cart when they are present. Tax calculations are produced by the `ct-stripe-tax` connector and consumed here during payment intent creation.

---

## Rule 1: Tax calculation references flow from ct-stripe-tax to this connector via CT cart

**What:** When `ct-stripe-tax` is active in the same CT project, it writes tax calculation IDs to the cart's custom field `connectorStripeTax_calculationReferences` (type: `String[]`). This connector reads that field during payment processing.

**Why:** Stripe Tax requires a calculation ID to be passed when the PaymentIntent is **created** (`buildPaymentIntentCreateParams` → `paymentIntents.create`, `stripe-payment.service.ts:806-810`) so that Stripe records the tax liability — the sync confirm endpoint does not touch tax. The two connectors share state via CT's cart custom fields — neither calls the other directly.

**Invariant:** This connector never writes to `connectorStripeTax_calculationReferences`. It only reads. Writes are the exclusive responsibility of `ct-stripe-tax`.

**Implementation:** `processor/src/services/stripe-payment.service.ts` (~line 517) — reads `cart.custom?.fields?.[CT_CUSTOM_FIELD_TAX_CALCULATIONS]`. Constant defined in `processor/src/constants.ts` → `CT_CUSTOM_FIELD_TAX_CALCULATIONS = 'connectorStripeTax_calculationReferences'`.

---

## Rule 2: Tax integration is opt-in via ct-stripe-tax deployment

**What:** If `ct-stripe-tax` is not deployed in the CT project, the `connectorStripeTax_calculationReferences` field will not exist on the cart. This connector treats a missing or empty field as "no tax calculation" and proceeds normally without it.

**Why:** The tax integration must be backward-compatible — merchants without Stripe Tax should not be affected.

**Invariant:** Never throw or error on a missing `connectorStripeTax_calculationReferences` field. Treat `undefined` and empty array as equivalent.

---

## Rule 3: Only a single tax calculation reference is passed to Stripe — zero or multiple are dropped

**What:** A cart may accumulate multiple tax calculation references if it was recalculated (e.g., address changed). The connector passes a calculation to Stripe **only when the cart carries exactly one reference** (`hasSingleTaxCalculation = taxCalculationReferences.length === 1`, `stripe-payment.service.ts:518-519`): it sends `taxCalculationReferences[0]` in that case and `undefined` otherwise (`:569`), so the `calculation` param is attached to the PaymentIntent only when a single reference exists (`:806-810`). With **zero or more than one** reference, no `calculation` is sent and Stripe records **no tax** for that PaymentIntent.

**Why:** The connector cannot reconcile which of several references is authoritative, so it declines to pass any rather than risk an inconsistent liability. The docstring at `:765` states this explicitly ("Set only when the cart carries exactly one tax calculation reference. Zero or multiple must arrive here as undefined").

**Invariant:** At most one tax calculation reference is ever sent to Stripe, and only when exactly one exists on the cart.

**Known consequence:** A cart that was recalculated (>1 reference) silently loses its Stripe Tax calculation — the PaymentIntent is created without tax. This is the actual behavior; the previous version of this rule ("passes all references") described the opposite of what the code does.

---

## Related

- `ct-stripe-tax` connector — responsible for writing `connectorStripeTax_calculationReferences` to CT carts
- Hub `context/ARCHITECTURE.md` — describes the relationship between connectors in this hub
