# ADR-006 — Express Checkout Address Changes Trigger CT Shipping Recalculation

**Status:** Accepted  
**Date:** 2024

## Context

Express Checkout (Apple Pay, Google Pay, Link) allows customers to change their shipping address within the payment sheet. Each address change must recalculate available shipping methods and their costs in CT before the payment is confirmed.

## Decision

When the customer changes their address in the Express Checkout sheet, the connector:
1. Receives the `shippingaddresschange` event from the Stripe Express Checkout Element
2. Calls CT to fetch available shipping methods for the new address
3. Returns updated shipping options to Stripe to display in the payment sheet
4. Updates the CT cart with the selected shipping address before payment confirmation

This is handled in the enabler's embedded dropin component (`enabler/src/dropin/dropin-embedded.ts`) via the `shippingaddresschange` DOM event (`.on('shippingaddresschange', ...)`). Note: Stripe's documentation refers to this as the `onShippingAddressChange` callback at the API level, but the actual event name in the SDK is the kebab-case `shippingaddresschange`.

## Consequences

- Shipping rate recalculation adds latency to the address change interaction in the payment sheet
- If CT returns no shipping methods for an address, the connector returns an error to Stripe and the customer cannot proceed with that address
- The CT cart must be updated with the final selected address before `POST /confirmPayments/:id` is called
- Apple Pay requires the domain association file to be served — see [ADR-001](./adr-001-payment-element-pci.md) and `STRIPE_APPLE_PAY_WELL_KNOWN` config

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| Fixed shipping options regardless of address | Incorrect shipping costs; not viable for merchants with zone-based pricing |
| Recalculate only on payment confirmation | Payment sheet shows wrong amounts to the user until the last step |
