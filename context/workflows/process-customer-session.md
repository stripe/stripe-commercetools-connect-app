# Workflow: Customer Session

**Trigger:** Frontend requests a Stripe customer session to enable saved payment methods in the Payment Element.
**Actors:** Browser (Enabler), Processor, Stripe API, CT API.
**Outcome:** Frontend receives `stripeCustomerId`, `ephemeralKey`, and `sessionId` (client secret) to initialize the Payment Element with saved payment method support.

---

## GET /customer/session?stripeCustomerId=cus_xxx

```
Browser                   Processor (StripeCustomerService)         Stripe           CT
  |                               |                                    |               |
  | GET /customer/session         |                                    |               |
  | ?stripeCustomerId=cus_xxx     |                                    |               |
  |------------------------------>|                                    |               |
  |                               | getCart()                          |               |
  |                               |-------------------------------------------------->|
  |                               | if no cart.customerId → return (skip)             |
  |                               |                                    |               |
  |                               | getCtCustomer(customerId)          |               |
  |                               |-------------------------------------------------->|
  |                               | if customer not found → return (skip)             |
  |                               |                                    |               |
  |                               | retrieveOrCreateStripeCustomerId() |               |
  |                               | (see below)                        |               |
  |                               |                                    |               |
  |                               | createEphemeralKey(stripeCustomerId)               |
  |                               |------------------------------------>|               |
  |                               | createSession(stripeCustomerId)    |               |
  |                               |------------------------------------>|               |
  |  { stripeCustomerId,          |                                    |               |
  |    ephemeralKey,              |                                    |               |
  |    sessionId }                |                                    |               |
  |<------------------------------|                                    |               |
```

---

## Customer ID resolution — retrieveOrCreateStripeCustomerId()

This method implements a priority chain to find or create the Stripe customer. Each step validates against CT's `ct_customer_id` metadata on the Stripe customer to prevent ID reuse across projects.

```
1. stripeCustomerId param provided?
   → validate via stripe.customers.retrieve()
      → metadata[ct_customer_id] == ctCustomerId AND not deleted?
         YES → use it
         NO  → continue

2. CT customer has saved stripeConnector_stripeCustomerId field?
   → validate same way
      YES → use saved ID
      NO  → continue

3. Search Stripe: metadata[ct_customer_id]:'<ctCustomerId>'
   → found?
      YES → saveStripeCustomerId() to CT, use it
      NO  → continue

4. Create new Stripe customer:
   → email: cart.customerEmail || customer.email || shippingAddress.email
   → name: firstName + lastName (or shipping address name)
   → phone: address phone or mobile
   → address: streetNumber + streetName, city, postalCode, state, country
   → metadata: { ct_customer_id: customer.id }
   → saveStripeCustomerId() to CT customer custom field
```

### saveStripeCustomerId()

Writes `stripeConnector_stripeCustomerId` to the CT customer via `updateCustomerById()`. Uses `getCustomFieldUpdateActions()` to handle both "set type + field" (first time) and "update field" (type already set) scenarios.

---

## Session and ephemeral key

| Object | Stripe call | Returned as |
|---|---|---|
| Ephemeral key | `stripe.ephemeralKeys.create({ customer })` | `ephemeralKey` (secret string) |
| Customer session | `stripe.customerSessions.create({ customer, components: { payment_element: { enabled: true, features: {...} } } })` | `sessionId` (client_secret) |

The `features` object in the session comes from `STRIPE_SAVED_PAYMENT_METHODS_CONFIG`. Default: `{}` (all defaults). Set `{"payment_method_save":"disabled"}` to hide the "save card" toggle.

---

## Edge cases

| Condition | Behavior |
|---|---|
| Cart has no `customerId` (guest checkout) | Returns `undefined` — Payment Element initializes without saved methods |
| CT customer not found | Returns `undefined` — same as guest |
| `stripeCustomerId` param invalid or deleted | Falls through to next resolution step |
| Stripe search returns no results | New customer created and saved |
| `saveStripeCustomerId()` fails | Error thrown — no partial state (customer exists in Stripe but ID not persisted in CT) |
