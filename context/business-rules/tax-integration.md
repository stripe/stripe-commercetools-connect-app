# Business Rule: Stripe Tax Integration

This connector reads Stripe Tax calculation references from the CT cart when they are present. Tax calculations are produced by the `ct-stripe-tax` connector and consumed here during payment intent creation.

---

## Rule 1: Tax calculation references flow from ct-stripe-tax to this connector via CT cart

**What:** When `ct-stripe-tax` is active in the same CT project, it writes tax calculation IDs to the cart's custom field `connectorStripeTax_calculationReferences` (type: `String[]`). This connector reads that field during payment processing.

**Why:** Stripe Tax requires a calculation ID to be passed when confirming a PaymentIntent so that Stripe can record the tax liability. The two connectors share state via CT's cart custom fields — neither calls the other directly.

**Invariant:** This connector never writes to `connectorStripeTax_calculationReferences`. It only reads. Writes are the exclusive responsibility of `ct-stripe-tax`.

**Implementation:** `processor/src/services/stripe-payment.service.ts` line 389 — reads `cart.custom?.fields?.[CT_CUSTOM_FIELD_TAX_CALCULATIONS]`. Constant defined in `processor/src/constants.ts` → `CT_CUSTOM_FIELD_TAX_CALCULATIONS = 'connectorStripeTax_calculationReferences'`.

---

## Rule 2: Tax integration is opt-in via ct-stripe-tax deployment

**What:** If `ct-stripe-tax` is not deployed in the CT project, the `connectorStripeTax_calculationReferences` field will not exist on the cart. This connector treats a missing or empty field as "no tax calculation" and proceeds normally without it.

**Why:** The tax integration must be backward-compatible — merchants without Stripe Tax should not be affected.

**Invariant:** Never throw or error on a missing `connectorStripeTax_calculationReferences` field. Treat `undefined` and empty array as equivalent.

---

## Rule 3: Tax calculation references are per-cart, not per-payment

**What:** A single cart may have multiple tax calculation references if the cart was recalculated (e.g., address changed). The connector passes all references to Stripe when confirming the PaymentIntent.

**Why:** Stripe Tax requires all calculation references to reconcile tax liability correctly across recalculations.

---

## Related

- `ct-stripe-tax` connector — responsible for writing `connectorStripeTax_calculationReferences` to CT carts
- Hub `context/ARCHITECTURE.md` — describes the relationship between connectors in this hub
