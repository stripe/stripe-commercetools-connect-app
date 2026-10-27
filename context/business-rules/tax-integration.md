# Business Rule: Stripe Tax Integration

This connector reads Stripe Tax calculation references from the CT cart when they are present. Tax calculations are produced by the Stripe Tax connector and consumed here during payment intent creation.

---

## Rule 1: Tax calculation references flow from the Stripe Tax connector to this connector via CT cart

**What:** When the Stripe Tax connector is active in the same CT project, it writes tax calculation IDs to the cart's custom field `connectorStripeTax_calculationReferences` (type: `String[]`). This connector reads that field during payment processing.

**Why:** Stripe Tax requires a calculation ID to be passed when the PaymentIntent is **created** (`buildPaymentIntentCreateParams` → `paymentIntents.create`, `stripe-payment.service.ts:588`, `calculation` attached at `:833-841`) so that Stripe records the tax liability — the sync confirm endpoint does not touch tax. The two connectors share state via CT's cart custom fields — neither calls the other directly.

**Invariant:** This connector never writes to `connectorStripeTax_calculationReferences`. It only reads. Writes are the exclusive responsibility of the Stripe Tax connector.

**Implementation:** `processor/src/services/stripe-payment.service.ts:544` — reads `cart.custom?.fields?.[CT_CUSTOM_FIELD_TAX_CALCULATIONS]`. Constant defined in `processor/src/constants.ts` → `CT_CUSTOM_FIELD_TAX_CALCULATIONS = 'connectorStripeTax_calculationReferences'`.

---

## Rule 2: Tax integration is opt-in via the Stripe Tax connector deployment

**What:** If the Stripe Tax connector is not deployed in the CT project, the `connectorStripeTax_calculationReferences` field will not exist on the cart. This connector treats a missing or empty field as "no tax calculation" and proceeds normally without it.

**Why:** The tax integration must be backward-compatible — merchants without Stripe Tax should not be affected.

**Invariant:** Never throw or error on a missing `connectorStripeTax_calculationReferences` field. Treat `undefined` and empty array as equivalent.

---

## Rule 3: At most one tax calculation reference is passed to Stripe

**What:** The connector passes a calculation to Stripe **only when the cart carries exactly one reference** (`hasSingleTaxCalculation = taxCalculationReferences.length === 1`, `stripe-payment.service.ts:545-546`): it sends `taxCalculationReferences[0]`, so the `calculation` param is attached to the PaymentIntent only when a single reference exists (`:833-841`).

**Invariant:** At most one tax calculation reference is ever sent to Stripe, and only when exactly one exists on the cart.

---

## Related

- The Stripe Tax connector — responsible for writing `connectorStripeTax_calculationReferences` to CT carts.
