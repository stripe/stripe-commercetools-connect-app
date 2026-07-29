# ADR-007 — Standalone Invoicing Origination Model

**Status:** Proposed
**Date:** 2026-07-16

## Context

Ticket SB3-204 asks the Composable connector to support **standalone invoicing and payments**:
generate a Stripe invoice from the connector *without* going through the standard checkout flow,
reflect it in the Stripe dashboard, and update commercetools when the invoice is paid.

The connector already touches Stripe Invoicing, but **only inside the subscription flow**
(`stripe.invoices.sendInvoice` at `stripe-subscription.service.ts:267`, `stripe.invoices.retrieve`
at `ct-payment-creation.service.ts:197`). There is no `invoices.create` / `invoiceItems.create` /
`finalizeInvoice` / `pay` anywhere, and every CT payment/order write assumes an originating CT cart
(`getCartByPaymentId`, `order-client.ts` `createOrderFromCart`). A standalone invoice has no cart,
so today there is no write path for it.

Two origination models were evaluated. (A fuller local analysis existed as ephemeral `workspace/`
research during drafting; it was never committed and is not present in this checkout — this ADR is
the durable record of that evaluation.) This ADR records the recommended model; it is **Proposed**
pending product/Vishnu confirmation of what "standalone" must mean, and pending the implementation
gate (example site published + Pooch & Mutt near resolution).

## Decision

Adopt **Model B — truly standalone**: the connector creates a Stripe invoice from arbitrary line
items with **no originating CT cart**. On `invoice.paid`, a CT **Payment** (with
`interfaceId = invoice id`, `in_…`) is created/updated to reflect status (AC3); CT **Order**
creation is deferred (handled out of band via CT Order Import if needed), not synthesized from a
cartless invoice.

Supporting decisions:
- **Webhook discriminator:** `invoice.paid` / `invoice.payment_failed` currently route
  *unconditionally* to `processSubscriptionEventPaid`, which hard-requires
  `invoice.parent.subscription_details` (`stripe-payment.route.ts:173-184`,
  `stripe-subscription.service.ts:1200`). Add a discriminator branching on
  `invoice.parent?.subscription_details` plus a connector-set metadata marker, so standalone
  invoices are handled by a new path and subscription invoices keep their current one.
  `isFromSubscriptionInvoice` (`utils.ts:31`) does not cover `invoice.*` events and must not be
  overloaded for this.
- **Idempotency:** mirror the subscription contract — key by `invoice.id`, dedup via
  `findPaymentsByInterfaceId`. On clover API versions `Invoice.payment_intent`/`charge` are not
  populated, so the invoice id is the canonical reference (as already handled at
  `subscriptionEventConverter.ts:22-34`).
- **Entry point:** a new OAuth2-authed processor route mirroring
  `POST /subscription-api/advanced/:customerId` (`stripe-subscription.route.ts`), registered in
  `stripe-payment.plugin.ts`.

## Consequences

**Positive:** satisfies "generate an invoice without checkout" literally; supports arbitrary line
items; reuses `stripeApi()`, `retrieveOrCreateStripeCustomerId`, and the invoice-id idempotency
contract already proven for subscriptions.

**Negative / cost:** requires the new cart-less CT write path (the largest lift) and a webhook
discriminator refactor of a currently subscription-only branch.

**Risks:** inherits the invoicing-adjacent known issues — KI-019 (`send_invoice` first-invoice
limbo applies directly), KI-002/KI-003 (handlers must return 5xx, not swallow errors and 200),
KI-004 (silent webhook-update failure), KI-006 (setTimeout race). The design must not reproduce
them.

## Alternatives Considered

| Alternative | Why discarded (for now) |
|---|---|
| **Model A — invoice tied to a CT cart/order** | Re-skins the existing cart→checkout flow and cannot express arbitrary line items. Kept as the cheaper fallback **iff** product clarifies that "standalone" really means "invoice for an existing cart" — in which case this ADR is revisited. |
| Create a CT Order directly from the paid invoice (Payment + Order) | Adds a synthetic cartless order path with no clear CT cart lineage; deferred to CT Order Import to keep the MVP scoped to the Payment entity. |
| Session-authed entry point | Requires a storefront cart/session — contradicts the standalone premise. |
