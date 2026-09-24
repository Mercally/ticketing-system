# ADR-0005: Transactional Outbox (and Inbox)

## Status
Accepted

## Context
Order Service and Payment Service both need to atomically (a) change their own database state and (b) publish an event about that change, such that either both happen or neither does. Without this guarantee, a crash between "commit the DB write" and "publish the message" either loses the event (state changed, nobody told) or a crash between "publish" and "commit" fabricates an event for a change that never actually landed. The prompt explicitly requires a Transactional Outbox where needed, plus an Inbox/idempotent-consumer mechanism to avoid duplicate processing.

## Decision
Use **MassTransit's built-in Entity Framework Core Outbox** (`AddEntityFrameworkOutbox<TDbContext>`), which provides both halves in one package, on Order Service and Payment Service — the two services that both mutate state and publish events as part of the same business operation:

- **Outbox (producer side):** `UseBusOutbox()` makes every `Publish`/`Send` call inside a unit of work write to an `OutboxMessage` table in the *same* database transaction as the business entity change, via the same `DbContext.SaveChanges()`. A separate delivery process then reads committed outbox rows and actually sends them to SQS/SNS, retrying delivery independently of the business transaction. This makes "order created in DB" and "OrderSubmitted will eventually be published" atomic, without needing a distributed transaction spanning Postgres and SQS.
- **Inbox (consumer side):** configuring `UseEntityFrameworkOutbox<TDbContext>` on a receive endpoint adds an `InboxState` table keyed by `MessageId` (+ consumer identity); a redelivered message that's already recorded there is acknowledged and dropped without re-running the consumer's business logic. This is what makes SQS's at-least-once delivery safe to consume without double-processing (e.g., Payment Service must never charge twice because SQS redelivered `ProcessPayment`).

Catalog and Ticketing services do not need the outbox: Catalog doesn't publish events on the vertical slice's critical path, and Ticketing's `TicketConfirmed`/`TicketConfirmationFailed` publish happens as the direct, synchronous result of the same atomic seat `UPDATE` — still wrapped in the same outbox pattern for consistency and because it also *consumes* commands (`ConfirmSeat`, `ReleaseReservation`) that need inbox-based idempotency.

## Alternatives considered
- **Hand-rolled outbox table + polling publisher.** This is essentially what MassTransit's EF outbox does internally, but writing and maintaining it by hand duplicates well-tested library code for no benefit — the prompt's "avoid unnecessary abstractions" principle argues for using the framework's supported mechanism rather than reinventing it.
- **Publish directly inside the same DB transaction via a 2PC-style resource manager (e.g., MSDTC-style distributed transaction across Postgres and a message broker).** Not available/supported for SQS, and would reintroduce the exact 2PC coordination the prompt forbids (ADR-0003) at the messaging layer instead of the saga layer.
- **"Best-effort" publish after commit, no outbox (publish, and if it fails, log and move on).** Rejected outright — this is precisely the failure mode (event silently lost on crash-after-commit) the prompt calls out as a problem to solve ("Fallos parciales entre servicios").

## Trade-offs
- **Cost:** an extra table per service (`OutboxMessage`/`OutboxState`, `InboxState`) and a background delivery process (MassTransit's bus outbox delivery service) that must itself be monitored — if it stalls, events queue up in the outbox table rather than being lost, but they are delayed.
- **Cost:** outbox delivery is "eventually" published, not instantly — there's a small window between commit and actual SQS publish. Acceptable given the alternative is losing events entirely on crash.
- **Benefit:** no message is ever published for a change that didn't actually commit, and no committed change ever silently fails to notify the rest of the system — both failure directions the "fallos parciales" requirement calls out are closed.
- **Benefit:** consumers get exactly-once *processing semantics* (not exactly-once *delivery*, which SQS doesn't provide — but the Inbox makes redelivery a no-op) with no per-consumer bespoke dedupe code.
