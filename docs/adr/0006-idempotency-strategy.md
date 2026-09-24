# ADR-0006: Idempotency Strategy

## Status
Accepted

## Context
Two distinct sources of duplication exist in this system and need two distinct defenses: (1) a buyer's client (browser, mobile network, a proxy) retries an HTTP write because it didn't see a response in time, potentially after the original request already succeeded server-side; (2) SQS's at-least-once delivery redelivers a message a consumer already processed. The prompt calls out both explicitly — `Idempotency-Key` for critical operations (Create Reservation, Create Order, Process Payment), and idempotent message consumers — plus requires `UNIQUE` constraints as a last line of defense.

## Decision
Two independent, complementary mechanisms:

**1. HTTP-level `Idempotency-Key` (client-supplied), for `POST /reservations`, `POST /orders`, `POST /payments`:**
`building-blocks/idempotency` provides a reusable ASP.NET Core filter. On a request carrying an `Idempotency-Key` header, the filter looks up `(endpoint, idempotency_key)` in that service's own `idempotency_keys` table:
- Not found → proceed, and on successful completion store the key with a hash of the response (status code + body) before returning it.
- Found, same request hash → return the stored response verbatim, without re-running the business logic (true idempotent replay).
- Found, different request body under the same key → `409 Conflict` (the client is misusing the key, not legitimately retrying).
A `UNIQUE` constraint on `(endpoint, idempotency_key)` is the last line of defense: if two concurrent requests with the same fresh key both pass the "not found" check (a genuine race, not just a slow retry), only one insert succeeds and the other fails the constraint and is treated as a duplicate-in-flight, retried by the filter to read the now-committed original response.

**2. Message-level Inbox (system-generated `MessageId`), for all SQS consumers:**
Handled by MassTransit's EF Core Outbox `InboxState` table (ADR-0005) — redelivery of a `MessageId` already recorded there is a no-op. This is the correct mechanism for *system* retries (SQS redelivery, MassTransit's own retry middleware), as opposed to *client* retries, which the HTTP-level key handles.

These two mechanisms guard different hops of the same logical operation and are both necessary: a client-level `Idempotency-Key` on `POST /orders` doesn't help if the resulting `OrderSubmitted` message gets redelivered by SQS and reprocessed by the saga — that's the Inbox's job, not the HTTP filter's.

## Alternatives considered
- **Rely only on the Inbox/message-level idempotency, skip the HTTP-level key.** Rejected: synchronous endpoints (`POST /reservations` in particular, which must answer synchronously per ADR-0002) aren't behind a message queue at all on the request path — there's no Inbox to catch a duplicate HTTP POST. The HTTP-level key is the only mechanism available for that hop.
- **Rely only on the HTTP-level key, skip message Inbox.** Rejected: the client-supplied key only covers requests that actually came from a client; internal service-to-service commands and saga-driven events have no client-supplied key and still need dedupe against SQS's at-least-once redelivery.
- **Idempotency store shared across services (e.g., one Redis/Postgres instance all services check).** Rejected per `DECISIONS.md` D10 — would reintroduce a cross-service dependency the database-per-service boundary (ADR-0001) is designed to avoid.

## Trade-offs
- **Cost:** every service accepting a critical write needs its own `idempotency_keys` table and migration — some duplication of a small, well-defined piece of schema, not shared logic (the filter itself is shared).
- **Cost:** stored idempotent responses need a retention/expiry policy (implemented as a TTL column + sweep, mirroring the reservation TTL sweep) so the table doesn't grow unbounded — sized generously (24h) since it only needs to outlive plausible client retry windows, not the business record itself.
- **Benefit:** a buyer double-clicking "Buy" or a flaky mobile connection retrying a POST can never create two orders, two payments, or two reservations for the same intent — verified directly by `tests/*.IdempotencyTests`.
