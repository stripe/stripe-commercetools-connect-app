# ADR-022: Migrate @commercetools/connect-payments-sdk to 1.2.2

**Status:** Accepted
**Date:** 2026-10-08

## Context

The processor pinned `@commercetools/connect-payments-sdk@0.27.2`. The checkout sibling had
already migrated to `1.2.2`, and aligning composable keeps the two connectors on one SDK line.

Verification against the official changelogs showed the SDK has **no breaking change in its own
API** across 0.27.2 → 1.2.2 (`1.0.0` is a "graduate to stable" tag; `1.2.2` is a recurring-cart
detection fix). The entire breaking surface is **transitive**, because the SDK declares its
dependencies as exact-pinned regular `dependencies` (not peers): installing `1.2.2` forces
`@commercetools/platform-sdk@9.4.0`, `@commercetools/ts-client@5.0.2`,
`@commercetools-backend/loggers@27.9.3`, and `jwks-rsa@4` → `jose@6` (ESM-only).

Two transitive facts drive the work: (1) `jose@6` is ESM-only and is only `require()`-able on
Node **≥20.19.0**; `platform-sdk@9` and `ts-client@5` additionally *declare* `engines.node >=22`.
(2) `jose@6` rejects a JWKS whose keys carry `key_ops:["sign"]` without `use:"sig"` — which is
exactly what the unmaintained `jwt-mock-server` (local dev JWT harness) publishes — returning 401
on every JWT endpoint and breaking the Payment Element locally.

Code impact was confirmed minimal by mapping every import: only `processor/` uses the three
packages (the `enabler` uses none); no removed `platform-sdk@8.23` symbols are referenced; there is
no custom `ts-client` token cache; and the checkout-specific `interfaceId`→`checkoutTransactionItemId`
rewrite does **not** apply (composable uses `findPaymentsByInterfaceId`, an unchanged SDK method).

## Decision

Bump `@commercetools/connect-payments-sdk` to **1.2.2** and the directly-imported
`@commercetools-backend/loggers` to **27.9.3** in `processor/`; let `platform-sdk@9.4.0` /
`ts-client@5.0.2` arrive transitively. Declare `engines.node >=20.19.0` (the true jose@6 floor, not
22), fix Jest to transform jose's ESM entry, and replace the dev `jwt-mock-server` with a native,
zero-dependency JWKS mock (`jwt-server/server.js`, `use:"sig"`).

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Declare `engines.node >=22` (match platform-sdk 9 / ts-client 5) | Not needed for the deployed runtime: CT Connect runs only Node **22 or 24** (Node 20 is deprecated, end of support 2026-04-30), so the deployed connector already satisfies both floors. We keep `>=20.19.0` for **parity with checkout** and because it is **jose 6's true floor** — the lowest Node that can `require()` jose 6's ESM build (`jwks-rsa@4` → `jose@6`). `>=22` would be stricter than necessary and diverge from checkout. |
| Bump the three packages independently | They are coupled through the SDK's exact pins — a 1.2.2 SDK with platform-sdk 8.x in its subtree is the broken state. Treated as one atomic migration. |
| Add `@commercetools/platform-sdk` as a direct dep at 9.4.0 | Not needed — it resolves to the SDK's pinned 9.4.0 by hoisting, and checkout keeps it transitive. Verified with `npm ls`. |
| Keep `jwt-mock-server`, pin an older `jose` | Fighting the SDK's own pin; brittle and diverges from checkout. The native mock is ~120 lines, zero-dep, and spec-compliant. |

## Consequences

**Positive:** composable and checkout share one SDK line; `ts-client@5` masks `Authorization`
headers in error logs by default (less secret-leak surface); the dev JWT harness is now
spec-compliant and maintained in-repo.

**Negative:** `platform-sdk@9` / `ts-client@5` declare `>=22`, so they emit `EBADENGINE` warnings on a
local Node 20.x dev box; they run correctly there, and the warnings do **not** appear on the CT Connect
runtime (22/24). Purely local-dev noise — no deployed-runtime impact.

**Risks:** production auth, amount handling, and transaction-state writes are all SDK-owned, and
the unit suite mocks the SDK — so green tests do not prove 1.x behavior. Mitigated by **live storefront
(`:5173`) e2e under 1.2.2**, captured in `validated-flows/`: card one-time (order Paid, amount consistent
Stripe↔CT — `card/normal-onetime/success.md`), ACH one-time (setup + `Authorization/Pending`,
cart frozen — `ach/normal-onetime/success.md`), card subscription create (Stripe subscription + first
invoice, order Paid, `stripeConnector_stripeSubscriptionId` linked — `card/normal-subscription/success.md`),
and Link express (order Paid — `express/link-onetime/success.md`). **Still deferred:** ACH
settlement→order (micro-deposit async), subscription **modify** (`/advanced`), and Apple Pay / Google Pay
(cannot render on localhost — need HTTPS + a verified domain, KI-058).
