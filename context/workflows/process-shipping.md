# Workflow: Express Checkout Shipping

**Trigger:** Customer interacts with Apple Pay, Google Pay, or Link Express Checkout Element — selecting or changing a shipping address or method within the payment sheet.
**Actors:** Browser (Enabler), Processor, CT API, Stripe.
**Outcome:** CT cart updated with current address and shipping rate; Stripe payment sheet receives updated options and line items.

These three endpoints support the Express Checkout flow only. They are not used in standard Payment Element checkout.

---

## POST /shipping-methods — Address change

Called when the customer selects or changes their shipping address in the Express Checkout payment sheet.

```
Stripe ECE               Processor (StripeShippingService)               CT
     |                            |                                        |
     | POST /shipping-methods     |                                        |
     | { address }                |                                        |
     |--------------------------->|                                        |
     |                            | getCart()                              |
     |                            |--------------------------------------->|
     |                            | if cart is frozen:                     |
     |                            |   unfreezeCart()  [best-effort]        |
     |                            |--------------------------------------->|
     |                            | updateShippingAddress(address)         |
     |                            |--------------------------------------->|
     |                            | getShippingMethodsFromCart()           |
     |                            |--------------------------------------->|
     |                            | if 0 methods → throw (no delivery)    |
     |                            |                                        |
     |                            | if cart has no shippingInfo:           |
     |                            |   updateShippingRate(first method)     |
     |                            |--------------------------------------->|
     |                            | else:                                  |
     |                            |   promote current method to index 0    |
     |                            |                                        |
     |                            | if was frozen:                         |
     |                            |   freezeCart()  [best-effort]          |
     |                            |--------------------------------------->|
     |  { shippingRates,          |                                        |
     |    lineItems }             |                                        |
     |<---------------------------|                                        |
```

### Steps detail

1. Load CT cart from context
2. Check `isCartFrozen(cart)` — store the frozen state
3. If frozen: `unfreezeCart()` (best-effort — if this fails, the request throws)
4. `updateShippingAddress(cart, address)` — sets the new address on the CT cart
5. `getShippingMethodsFromCart()` — fetches CT shipping methods valid for that address
6. If no methods found → throw `'No shipping methods found for the given address.'` (Stripe shows error in payment sheet)
7. If cart has no current `shippingInfo`: apply `updateShippingRate(firstMethod)` to set a default
8. If cart already has a shipping method: move it to index 0 in the returned list (Stripe pre-selects index 0)
9. If was frozen: `freezeCart()` (best-effort — failure is logged but does not block the response)
10. Build `lineItems` from cart line items + `shippingInfo.price` (if present)
11. Return `{ shippingRates, lineItems }` to Stripe

### Response shape

```json
{
  "shippingRates": [
    { "id": "<CT shipping method ID>", "displayName": "<method name>", "amount": 500 }
  ],
  "lineItems": [
    { "name": "Product Name", "amount": 2999 },
    { "name": "Shipping", "amount": 500 }
  ]
}
```

---

## POST /shipping-methods/update — Method selection

Called when the customer selects a specific shipping method in the Express Checkout payment sheet.

```
Stripe ECE                    Processor                                  CT
     |                            |                                        |
     | POST /shipping-methods/update                                       |
     | { id: shippingMethodId }   |                                        |
     |--------------------------->|                                        |
     |                            | getCart()                              |
     |                            |--------------------------------------->|
     |                            | if frozen: unfreezeCart() [best-effort]|
     |                            |--------------------------------------->|
     |                            | updateShippingRate(id)                 |
     |                            |--------------------------------------->|
     |                            | if was frozen: freezeCart()            |
     |                            |--------------------------------------->|
     |  { lineItems }             |                                        |
     |<---------------------------|                                        |
```

Returns `{ lineItems }` only (no `shippingRates` — the list does not change, only the selection).

---

## GET /shipping-methods/remove — Checkout cancelled

Called when the customer dismisses the Express Checkout payment sheet without completing payment.

```
Stripe ECE                    Processor                                  CT
     |                            |                                        |
     | GET /shipping-methods/remove                                        |
     |--------------------------->|                                        |
     |                            | getCart()                              |
     |                            |--------------------------------------->|
     |                            | if frozen: unfreezeCart()              |
     |                            |--------------------------------------->|
     |                            | removeShippingRate()                   |
     |                            |--------------------------------------->|
     |  { lineItems }             |                                        |
     |<---------------------------|                                        |
```

**Important:** Cart is NOT re-frozen after remove. The checkout was abandoned — the cart returns to an unfrozen, editable state so the customer can modify it or try a different payment flow.

---

## Freeze/unfreeze contract

| Scenario | Cart before | Cart after |
|---|---|---|
| Address change | Frozen (subscription) | Frozen (re-frozen after update) |
| Address change | Unfrozen (normal cart) | Unfrozen (no change) |
| Method selection | Frozen | Frozen (re-frozen after update) |
| Method selection | Unfrozen | Unfrozen |
| Checkout cancelled | Frozen | **Unfrozen** (intentional — payment abandoned) |
| Checkout cancelled | Unfrozen | Unfrozen |

The unfreeze/refreeze sequence is best-effort — there is no transaction wrapping it. A failure between `unfreezeCart()` and `freezeCart()` may leave the cart unfrozen. See `context/business-rules/subscription-lifecycle.md` Rule 6.
