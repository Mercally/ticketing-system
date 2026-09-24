# ADR-0007: Real-Time Availability

## Status
Accepted

## Context
Buyers viewing a seat map want to see other seats being taken in near-real-time (a seat going grey as someone else reserves it), but the system must never let that real-time view *be* the authority a reservation is granted against — that authority is Postgres alone (ADR-0002). The prompt explicitly requires SignalR for this and explicitly allows the UI to be eventually consistent as long as the final reserve operation is always re-validated server-side.

## Decision
Ticketing Service hosts a **SignalR hub** (`/hubs/seat-availability`). Clients viewing a specific event's seat map join a group keyed by `eventId`. Whenever a seat's status actually changes in Postgres (reserved, released, sold, confirmed) — as the direct result of a successful CAS `UPDATE` — Ticketing broadcasts a `SeatStatusChanged { seatId, status, version }` message to that event's group, immediately after the database commit (not before, and not as a substitute for it).

The frontend seat map renders from this push stream for a fast, live feel, but the **reserve action itself always goes through `POST /reservations`**, which re-runs the atomic CAS against Postgres regardless of what the client's local view currently shows. If a buyer clicks a seat the UI still shows as available but that was actually just taken, the request fails with a clear "seat no longer available" response and the client reconciles its local view from that authoritative answer (not from re-trusting the stale SignalR state). This is the literal shape of the prompt's own instruction: "La UI puede mostrar información eventualmente consistente. La operación final de reserva SIEMPRE debe ser validada por Ticketing Service contra PostgreSQL."

SignalR connections scale horizontally via a Redis backplane (`Microsoft.AspNetCore.SignalR.StackExchangeRedis`) so multiple Ticketing replicas under Kubernetes can all broadcast to clients connected to any replica — this is the same Redis instance/role as the gateway's waiting-room counters (traffic-shaping infrastructure), not a seat-authority use.

## Alternatives considered
- **Polling (`GET /seats` on an interval) instead of SignalR.** Simpler, but either polls too slowly to feel "live" or too frequently to be cheap at scale — exactly the kind of unnecessary load the "Massive Traffic" section warns against generating. Rejected in favor of push, which the prompt also asks for explicitly.
- **Let the SignalR broadcast state be authoritative (skip the second server-side check on reserve).** Rejected outright — this is exactly the double-sell risk the prompt is most concerned about. A push notification can be delayed, dropped, or reordered; only the database transaction is authoritative.
- **Broadcast via SNS/SQS instead of a direct SignalR push from Ticketing.** Rejected for this specific use case: seat status is inherently ephemeral, UI-only, best-effort data — routing it through the durable, at-least-once, DLQ-backed messaging infrastructure built for business-critical events (ADR-0004) would be the wrong tool for a "nice to have, might drop a frame" broadcast, and would couple Notification-grade durability guarantees to a purely cosmetic feed.

## Trade-offs
- **Cost:** a client that misses a SignalR message (brief disconnect, group re-join race) can show a seat as available slightly longer than it actually is — acceptable precisely because the reserve action re-validates.
- **Cost:** Redis backplane adds one more thing to run/monitor locally, though it's the same Redis instance the gateway already needs (ADR-0008), not a second piece of infrastructure.
- **Benefit:** buyers get a genuinely live seat map without Ticketing's authoritative write path ever depending on SignalR's delivery guarantees (or lack thereof).
