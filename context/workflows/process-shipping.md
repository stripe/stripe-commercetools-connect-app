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

> **This endpoint is not a security boundary, and the freeze it releases never was one.** Reaching it requires only session auth on the shopper's own cart, and it leaves the cart editable while an already-priced subscription invoice stays locked at its original amount. That was step 2 of the KI-054 underpayment chain: create subscription → cancel here → enlarge the cart → let `invoice.paid` mint the order. What closes that loss is the amount guard in `createSubscriptionOrderFromCart` (`business-rules/payment-confirmation.md` Rule 6, ADR-017), which validates what Stripe collected against the cart the order is minted from — **not** the freeze.
>
> Do not "fix" a future variant of this by re-freezing here or by conditioning the unfreeze on an in-flight subscription. The freeze is best-effort in at least four places (KI-008), so making it load-bearing repeats the mistake KI-054 exposed; and blocking the unfreeze strands a genuine canceller with a frozen cart, which is the KI-044 family. Hardening this endpoint is tracked as defense in depth, with its own Express Checkout regression scope — never as the control that prevents underpayment.

---

## Freeze/unfreeze contract

| Scenario | Cart before | Cart after |
|---|---|---|
| Address change | Frozen (subscription) | Frozen (re-frozen after update) |
| Address change | Unfrozen (normal cart) | Unfrozen (no change) |
| Method selection | Frozen | Frozen (re-frozen after update) |
| Method selection | Unfrozen | Unfrozen |
| Checkout cancelled | Frozen (**one-time** cart) | **Unfrozen** (intentional — payment abandoned) |
| Checkout cancelled | Frozen (**subscription** cart) | **Unfrozen** — also intentional, see below |
| Checkout cancelled | Unfrozen | Unfrozen |

### What the freeze is protecting

The table above describes *state* only. That is how the subscription row read as unremarkable for four
months: a freeze being released looks fine until you ask which freeze, and what was relying on it. So
state transitions on a control belong next to the thing the control protects.

| Freeze taken by | Protects | Released legitimately by | What holds the invariant after release |
|---|---|---|---|
| Express Checkout (`POST /shipping-methods`, `/update`) | Nothing — it is restoring a freeze it borrowed | The same request, immediately (re-freeze) | n/a |
| `POST /subscription` | Nothing load-bearing. It was *believed* to protect the cart backing an already-priced invoice | This endpoint, on abandonment — deliberately, see the note above | The amount guard in `createSubscriptionOrderFromCart` (Rule 7 + ADR-017 addendum), which compares what Stripe collected against the sealed cart total |
| Bank transfer / ACH commit point | Nothing load-bearing — the cart total must match an amount that settles days later | Settlement, or abandonment | The same amount guard, refusing the order |

Read the middle row carefully: the answer is *not* "the freeze protects it". Treating it that way is
what KI-054 cost. The freeze is best-effort in at least four places (KI-008), so anything load-bearing
placed on it inherits those four failure modes.

**Rule for anyone adding an unfreeze, or citing a freeze as protection:** name which freeze you are
releasing and what still guarantees the invariant afterwards. "The cart was frozen and my flow needs it
editable" is not an answer — it is a description of the bug. A freeze whose release has no compensating
check is not a control and must not be cited as one in a security review.

The unfreeze/refreeze sequence is best-effort — there is no transaction wrapping it. A failure between `unfreezeCart()` and `freezeCart()` may leave the cart unfrozen. See `context/business-rules/subscription-lifecycle.md` Rule 6.
