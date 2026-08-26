# ADR-015: Rethrow only transient CT-write failures so Stripe redelivers

**Status:** Accepted
**Date:** 2026-08-12

## Context

The subscription event handlers (`processSubscriptionEventPaid` / `processSubscriptionEventFailed`)
caught every error from the commercetools write and returned — the webhook responded 200 and
Stripe never retried. This silently dropped **transient** failures (a version conflict / 409, a
timeout, a 5xx): the Stripe side had moved but commercetools was never updated, and nothing
brought them back into sync.

Making the handlers rethrow **all** errors was tried first and rejected: it broke handlers on
permanent errors (bad credentials, missing customer) into an infinite Stripe redelivery storm,
and surfaced pre-existing under-mocked test failures.

## Decision

Rethrow only errors that match a transient/retryable pattern
(`ConcurrentModification | 409 | 429 | 502 | 503 | ETIMEDOUT | ECONNRESET`); a rethrow makes the
webhook respond non-2xx so Stripe redelivers. All other (permanent) errors keep the existing
behavior: logged and swallowed, so a permanent failure does not poison-retry for days.

## Alternatives Considered

| Alternative | Why discarded |
| --- | --- |
| Swallow everything (previous behavior) | Transient failures silently diverge CT from Stripe — no recovery. |
| Rethrow everything | Permanent errors cause an infinite redelivery storm; broke existing tests. |
| Add an internal retry loop in the handler | The connect-payments-sdk already retries 409 internally; Stripe redelivery is the right backstop for the rest without bespoke retry state. |

## Consequences

**Positive:** Transient CT-write failures are recovered by Stripe's own redelivery; permanent
failures still fail closed without a retry storm.
**Negative:** The retryable/permanent split is a regex on error text — an unrecognized transient
error would be swallowed rather than retried.
**Risks:** If Stripe redelivers a partially-applied write, the handlers must stay idempotent
(they key on existing transaction state, so a redelivery is a no-op once applied).
