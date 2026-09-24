# CONTRACTS.md — Ports, HTTP surface, and message contracts

This is the concrete reference every service must match exactly. `ARCHITECTURE.md` and the ADRs explain *why*; this file is *what*, precisely enough that services built independently interoperate without touching each other's code.

## 1. Ports (local/Aspire defaults; overridable via env var, same names used in `infrastructure/k8s`)

| Service | Port | Notes |
|---|---|---|
| gateway | 5000 | YARP entrypoint; frontend talks only to this |
| auth-service | 5001 | NestJS |
| catalog | 5002 | .NET |
| ticketing | 5003 | .NET; SignalR hub at `/hubs/seat-availability` |
| orders | 5004 | .NET |
| payments | 5005 | .NET |
| payments-gateway-fake | 5006 | .NET minimal API |
| notification-service | 5007 | NestJS |
| frontend (vite dev) | 5173 | |
| Postgres per service | Aspire-assigned | connection string via Aspire service discovery / env `ConnectionStrings__<name>` |
| LocalStack (SQS/SNS) | 4566 | |
| Redis (gateway waiting-room/rate-limit only) | 6379 | |
| Aspire dashboard | 18888 | |

Gateway route prefixes (stripped before proxying): `/api/auth/*` → auth-service, `/api/catalog/*` → catalog, `/api/ticketing/*` → ticketing (incl. `/hubs/seat-availability` WebSocket upgrade), `/api/orders/*` → orders, `/api/payments/*` → payments (status endpoint only).

## 2. Cross-cutting HTTP headers

| Header | Meaning | Set by |
|---|---|---|
| `Authorization: Bearer <jwt>` | Access token from Auth Service | Frontend, on every authenticated request |
| `Idempotency-Key` | Client-generated UUID, required on `POST /reservations`, `POST /orders` | Frontend (one per user action, not retried with a new value) |
| `X-Correlation-Id` | Business correlation id (GUID). Frontend mints one per checkout flow (from "view seat map" through order completion); becomes the OrderId once `POST /orders` succeeds — from then on services use OrderId as CorrelationId | Frontend; propagated server-to-server on every internal call and message |
| `traceparent` | W3C trace context | Generated automatically by OTel SDKs at each hop; never hand-set |

## 3. Auth Service (NestJS) — `services/auth-service`

Base path (behind gateway): `/api/auth`

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/register` | `{ email, password, displayName }` | 201 `{ userId }` |
| POST | `/login` | `{ email, password }` | 200 `{ accessToken, refreshToken, expiresIn }` |
| POST | `/refresh` | `{ refreshToken }` | 200 `{ accessToken, refreshToken, expiresIn }` (rotates refresh token) |
| POST | `/logout` | `{ refreshToken }` | 204 |
| GET | `/me` | (Bearer) | 200 `{ userId, email, displayName }` |

JWT: HS256, shared secret from config/Secrets Manager (documented as a PoC simplification — RS256 with rotated keys is the production upgrade, noted in DECISIONS.md). Access TTL 15m. Refresh TTL 7d, stored **hashed** (SHA-256) in `auth-db`, rotated (old row invalidated) on every `/refresh` call — reuse of an already-rotated refresh token revokes the whole token family (theft detection).

## 4. Catalog Service (.NET) — `services/catalog`

Base path: `/api/catalog`

| Method | Path | Response |
|---|---|---|
| GET | `/events` | 200 `[{ id, name, venue, startsAtUtc, imageUrl }]` |
| GET | `/events/{id}` | 200 `{ id, name, venue, startsAtUtc, description, seatMapRows, seatMapCols }` |

Seeded on startup (Development only) with 2 demo events. Catalog does **not** own seat availability — only the layout dimensions, used by the frontend to render a grid before seat-level data arrives from Ticketing.

## 5. Ticketing Service (.NET) — `services/ticketing`

Base path: `/api/ticketing`

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/events/{eventId}/seats` | | 200 `[{ id, label, section, row, status }]` |
| POST | `/reservations` (`Idempotency-Key` required) | `{ eventId, seatId, buyerId }` | 201 `{ reservationId, seatId, expiresAtUtc }` · 409 `{ error: "SeatUnavailable" }` |
| POST | `/reservations/{id}/release` | | 204 |

Seeded independently with seats for the same event ids Catalog seeds (matching by convention, not by cross-service call — see `DECISIONS.md` D13). SignalR hub `/hubs/seat-availability`: client method `JoinEvent(eventId)`; server→client event `SeatStatusChanged { seatId, status }`, fired immediately after every committed CAS update.

Internal consumers (commands, sent by Orders saga): `Orders.Contracts.V1.ConfirmSeatV1`, `Orders.Contracts.V1.ReleaseReservationV1`.
Internal publishes (events): `Ticketing.Contracts.V1.TicketConfirmedV1`, `Ticketing.Contracts.V1.TicketConfirmationFailedV1`, `Ticketing.Contracts.V1.ReservationReleasedV1`.

## 6. Order Service (.NET) — `services/orders`

Base path: `/api/orders`

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/` (`Idempotency-Key` required) | `{ reservationId, eventId, seatId, buyerId, amount, currency, paymentSimulationMode? }` | 201 `{ orderId, status: "Submitted" }` |
| GET | `/{id}` | | 200 `{ orderId, status, eventId, seatId, amount, currency, createdAtUtc, updatedAtUtc }` |

`status` ∈ `Submitted, AwaitingPayment, Confirming, Completed, Cancelling, Cancelled`. `paymentSimulationMode` is an optional PoC-only field (`Success` default | `Decline` | `Timeout` | `DuplicateCallback` | `DelayedResponse`) that flows through to the Fake Payment Gateway — this is what lets the demo/tests actually exercise the resilience and compensation paths on demand.

Hosts the Saga State Machine (ADR-0003, `ARCHITECTURE.md` §7). Publishes (self-consumed to start the saga): `Orders.Contracts.V1.OrderSubmittedV1`. Sends commands: `Orders.Contracts.V1.ProcessPaymentV1`, `Orders.Contracts.V1.ConfirmSeatV1`, `Orders.Contracts.V1.ReleaseReservationV1`, `Orders.Contracts.V1.RefundPaymentV1`. Consumes: `Payments.Contracts.V1.PaymentSucceededV1`, `Payments.Contracts.V1.PaymentFailedV1`, `Ticketing.Contracts.V1.TicketConfirmedV1`, `Ticketing.Contracts.V1.TicketConfirmationFailedV1`, `Ticketing.Contracts.V1.ReservationReleasedV1`. Publishes on terminal states: `Orders.Contracts.V1.OrderConfirmedV1`, `Orders.Contracts.V1.OrderCancelledV1`.

## 7. Payment Service (.NET) — `services/payments`

Base path: `/api/payments`

| Method | Path | Response |
|---|---|---|
| GET | `/{orderId}` | 200 `{ orderId, status, paymentId?, failureReason? }` |
| POST | `/webhook` (internal, called by Fake Payment Gateway, not via gateway proxy) | 204 — idempotent by `(orderId, callbackId)` |

Consumes: `Orders.Contracts.V1.ProcessPaymentV1`, `Orders.Contracts.V1.RefundPaymentV1`. Publishes: `Payments.Contracts.V1.PaymentSucceededV1`, `Payments.Contracts.V1.PaymentFailedV1`, `Payments.Contracts.V1.PaymentRefundedV1`. `payments` table has a `UNIQUE` constraint on `order_id` — the last-line-of-defense per ADR-0006, since a payment is 1:1 with an order by construction.

`IPaymentGateway` (in `Payments.Application`) is implemented by `HttpPaymentGatewayClient` (in `Payments.Infrastructure`), calling the Fake Payment Gateway over HTTP through a Polly-resilient `HttpClient` (timeout → retry → circuit breaker, in that pipeline order).

## 8. Fake Payment Gateway (.NET minimal API) — `services/payments/src/FakePaymentGateway.Api`

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/authorize` | `{ orderId, amount, currency, simulationMode }` | 200 `{ approved: true, authCode }` · 402 `{ approved: false, reason }` · (Timeout mode: no response until the caller's own timeout fires) |
| POST | `/refund` | `{ orderId, authCode }` | 200 `{ refunded: true }` |

`simulationMode` behavior: `Success` → 200 immediately. `Decline` → 402 immediately. `Timeout` → sleeps past Payment Service's configured HTTP timeout (exercises retry+circuit breaker). `DelayedResponse` → sleeps a few seconds then 200 (exercises timeout tuning without tripping it). `DuplicateCallback` → responds 200 synchronously **and** additionally fires `POST {payments}/webhook` twice asynchronously with the same `callbackId` (exercises Payment Service's webhook idempotency).

## 9. Notification Service (NestJS) — `services/notification-service`

No public write API. `GET /health`. Consumes (via its own SQS queue subscribed to each topic): `Orders.Contracts.V1.OrderConfirmedV1`, `Payments.Contracts.V1.PaymentSucceededV1`, `Payments.Contracts.V1.PaymentFailedV1`, `Ticketing.Contracts.V1.TicketConfirmedV1`. Publishes: `notifications-outbound` SNS topic, payload `{ type, correlationId, orderId, message, occurredAtUtc }`.

## 10. Integration event/command contracts

**Namespace ownership rule (critical — see ADR-0004, `DECISIONS.md` D3):** the C# namespace of a message type is owned by whichever service is its canonical sender (for commands) or publisher (for events), *regardless* of which service's codebase a given copy physically lives in. A consumer's local copy must use the **identical namespace + type name + JSON shape** as the owner's, because MassTransit's default topology derives the SNS topic/SQS queue name from the full type name — this is what lets two independently-compiled assemblies interoperate with zero shared project reference. Getting a consumer's namespace wrong breaks routing silently (message published to a topic nobody's queue is subscribed to). All services use `x.SetKebabCaseEndpointNameFormatter()` for consistent topic/queue naming from these type names.

All messages carry `CorrelationId` (Guid) and rely on MassTransit's native `traceparent` propagation (no explicit field needed — it's a transport header).

```csharp
// Namespace: Ticketing.Contracts.V1  — owned/published by Ticketing
public record TicketConfirmedV1(Guid OrderId, Guid ReservationId, Guid SeatId, Guid EventId, DateTime ConfirmedAtUtc, Guid CorrelationId);
public record TicketConfirmationFailedV1(Guid OrderId, Guid ReservationId, Guid SeatId, string Reason, Guid CorrelationId);
public record ReservationReleasedV1(Guid OrderId, Guid ReservationId, Guid SeatId, Guid CorrelationId);

// Namespace: Orders.Contracts.V1  — owned/published/sent by Orders
public record OrderSubmittedV1(Guid OrderId, Guid ReservationId, Guid SeatId, Guid EventId, Guid BuyerId, decimal Amount, string Currency, string? PaymentSimulationMode, Guid CorrelationId);
public record OrderConfirmedV1(Guid OrderId, Guid EventId, Guid SeatId, Guid BuyerId, decimal Amount, DateTime ConfirmedAtUtc, Guid CorrelationId);
public record OrderCancelledV1(Guid OrderId, string Reason, Guid CorrelationId);
public record ProcessPaymentV1(Guid OrderId, Guid BuyerId, decimal Amount, string Currency, string IdempotencyKey, string? SimulationMode, Guid CorrelationId);
public record ConfirmSeatV1(Guid OrderId, Guid ReservationId, Guid SeatId, Guid CorrelationId);
public record ReleaseReservationV1(Guid OrderId, Guid ReservationId, Guid SeatId, Guid CorrelationId);
public record RefundPaymentV1(Guid OrderId, string Reason, Guid CorrelationId);

// Namespace: Payments.Contracts.V1  — owned/published by Payments
public record PaymentSucceededV1(Guid OrderId, Guid PaymentId, decimal Amount, DateTime ProcessedAtUtc, Guid CorrelationId);
public record PaymentFailedV1(Guid OrderId, string Reason, DateTime FailedAtUtc, Guid CorrelationId);
public record PaymentRefundedV1(Guid OrderId, Guid PaymentId, Guid CorrelationId);
```

Notification Service (TypeScript) mirrors these shapes as local interfaces (camelCase per SQS JSON body MassTransit produces — MassTransit's JSON serializer uses the C# property names as-is by default, i.e. PascalCase on the wire; the NestJS consumer deserializes those exact PascalCase field names).

## 11. Seat status values

`AVAILABLE | RESERVED | SOLD` — exactly these three, exactly this casing, everywhere (Postgres enum/check constraint, JSON responses, SignalR payloads, frontend).

## 12. Simulation modes

`Success | Decline | Timeout | DuplicateCallback | DelayedResponse` — exactly these five, exactly this casing, from frontend checkout form through `OrderSubmittedV1`/`ProcessPaymentV1` to the Fake Payment Gateway.
