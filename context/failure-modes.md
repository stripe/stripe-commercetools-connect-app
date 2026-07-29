# Failure Modes — ct-connect-stripe-composable

Operational failure scenarios specific to this connector. Scenarios shared identically with `ct-connect-stripe-checkout` (Payment Intent operations, webhook processing, webhook endpoint update at post-deploy, Stripe/CT unavailability, webhook signature verification) live in `../../context/failure-modes.md` — not duplicated here.

---

## CT Platform API — Post-deploy product type update (delete-then-create)

**Trigger:** `updateProductType()` called during connector post-deploy; the delete succeeds but the create fails. Note: post-deploy (`actions.ts:136-141`) only reaches this call when zero existing products currently reference the type (`getProductsByProductTypeId()` guard) — if any product already uses it, the update is skipped entirely and this failure mode cannot occur.
**Current behavior on failure:** The product type is permanently deleted from the CT project. The connector starts but subscription product lookups fail at runtime (no product type to match against).
**Blast radius:** No product currently uses the type at the moment this fires (by the guard above), so no *existing* subscription product is affected immediately. All *future* subscription product creation against this type fails until it is manually re-created (with all 15 attributes).
**File:** `processor/src/services/commerce-tools/product-type-client.ts:33`
**Recommendation:** Use an update-in-place strategy (check existing fields, add missing, remove stale) rather than delete-then-create.
