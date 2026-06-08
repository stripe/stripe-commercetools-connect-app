# Business Rule: Launchpad Purchase Order Integration

Launchpad is a B2B purchasing layer that enriches CT payments with purchase order metadata at checkout time. This connector creates the required custom type on deploy and stores PO data on CT payment objects.

---

## Rule 1: Launchpad custom type must be pre-created by the merchant

**What:** The `payment-launchpad-purchase-order` custom type (key configurable via `CT_CUSTOM_TYPE_LAUNCHPAD_PURCHASE_ORDER_KEY`) is **not created by the connector** on deploy. The `post-deploy.ts` script calls `createLaunchpadPurchaseOrderNumberCustomType()`, which only checks for the type's existence via `getTypeByKey()` and logs whether it is present — it does not create or update it. The pre-undeploy script also does not remove it.

The type must be created manually in CT before the connector is deployed, with these fields:
- `launchpadPurchaseOrderNumber` (String) — the purchase order number
- `launchpadPurchaseOrderInvoiceMemo` (String) — memo line for the invoice

**Why:** The deploy script validates preconditions but delegates custom type setup to the merchant's CT admin process.

**Invariant:** If the type does not exist in CT, deploy does not fail — the connector starts but cannot store Launchpad fields. The check is informational only.

**Implementation:** `processor/src/connectors/actions.ts` → `createLaunchpadPurchaseOrderNumberCustomType()` (lines 42-47). `launchpadPurchaseOrderCustomType` in `custom-types/custom-types.ts` is a constants-only object (key + field name strings) — it is NOT a `TypeDraft` and cannot be used to create the CT type directly.

---

## Rule 2: Launchpad fields are optional on CT payment objects

**What:** The `launchpadPurchaseOrderNumber` and `launchpadPurchaseOrderInvoiceMemo` fields are optional. Not all payments carry Launchpad data — only B2B flows where the buyer submits a PO at checkout.

**Why:** The connector supports both B2C (no PO) and B2B (with PO) flows from the same codebase. Absence of Launchpad fields on a payment is normal and expected.

**Invariant:** Never treat a missing Launchpad custom field as an error. Only validate presence if the merchant's flow explicitly requires it.

---

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `CT_CUSTOM_TYPE_LAUNCHPAD_PURCHASE_ORDER_KEY` | `payment-launchpad-purchase-order` | Key for the Launchpad purchase order custom type in CT |
