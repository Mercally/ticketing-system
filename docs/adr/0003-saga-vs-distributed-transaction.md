# ADR-0003: Saga vs Distributed Transaction

## Status
Accepted

## Context
A single purchase spans four services' data (Ticketing's seat, Order Service's order, Payment Service's payment, and back to Ticketing's seat confirmation). Something must guarantee that a completed purchase leaves all four in a mutually consistent final state, and that a failure partway through leaves none of them holding inconsistent state (e.g., a captured payment with no confirmed seat). The prompt explicitly forbids 2PC and explicitly requires a Saga.

## Decision
Coordinate the purchase with an **orchestrated Saga**, implemented as a **MassTransit Saga State Machine** hosted in Order Service, persisted in `orders-db`. The saga owns the sequencing (`ProcessPayment` → on success `ConfirmSeat` → on success mark `OrderConfirmed`) and the compensation path (`PaymentFailed` → `ReleaseReservation` → `OrderCancelled`; see ADR context and `DECISIONS.md` D8 for the additional `Confirming → Cancelling` compensation edge). Ticketing and Payment services remain fully autonomous — they react to commands and publish events about their own state; they never reach into each other's or Order's database.

State machine (see `ARCHITECTURE.md` §7 for the full diagram):

```text
Submitted -> AwaitingPayment -> Confirming -> Completed
                 \-> Cancelling -> Cancelled
```

Each state transition is driven by one inbound event/command and results in the saga sending exactly one outbound command, making the sequence easy to reason about and to test with MassTransit's in-memory test harness (`tests/Orders.SagaTests`).

## Alternatives considered
- **Two-Phase Commit (2PC) / distributed transaction coordinator (e.g., XA).** Explicitly forbidden by the prompt, and a poor fit regardless: 2PC requires all participants to be reachable and to hold locks open for the duration of the coordination round, which is precisely the kind of synchronous, tightly-coupled, availability-limiting mechanism the whole architecture (async messaging, per-service autonomy, horizontal scalability under spike load) is designed to avoid. A prepared-but-uncommitted participant blocks the others' locks if the coordinator itself fails.
- **Choreography only (no central saga, each service reacts to the previous service's event and decides the next step itself).** Considered and partially rejected: pure choreography spreads the "what's the overall sequence and what are the failure paths" knowledge across every service's consumer code, making the end-to-end flow (and especially its compensation logic) hard to see in one place and hard to unit test as a whole. The chosen design is a hybrid: Order Service's saga *orchestrates* the sequence explicitly (readable, testable as one state machine), while Ticketing and Payment remain *choreographed reactors* to commands — they don't know about the saga, they just handle `ConfirmSeat`/`ProcessPayment` commands and publish outcome events, so they stay decoupled and independently deployable.
- **Saga as a standalone orchestrator service.** See `DECISIONS.md` D6 — rejected because it would own no data of its own; Order Service already owns the aggregate whose lifecycle the saga models.

## Trade-offs
- **Cost:** eventual consistency — between "payment succeeded" and "seat confirmed" there is a real, if small, window where the order is in `Confirming` and not yet `Completed`. The frontend surfaces this honestly (order status starts at a pending/processing state and moves to Confirmed/Cancelled), rather than pretending the purchase is instantaneous.
- **Cost:** compensation logic must be written and tested explicitly for every failure branch (payment decline, payment timeout, seat confirmation failure after payment) — there's no automatic rollback the way a single ACID transaction would give for free within one database.
- **Benefit:** each service stays available and independently scalable even while another is degraded — e.g., if Payment Service is slow, Ticketing and Catalog keep serving browse/reserve traffic unaffected; the saga simply has more in-flight instances waiting on payment, not a system-wide stall.
- **Benefit:** the full purchase sequence and its failure handling live in one reviewable, testable state machine rather than being implicit in a web of point-to-point service calls.
