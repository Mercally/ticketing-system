# ADR-0008: Waiting Room / Admission Control

## Status
Accepted

## Context
The prompt's central scaling problem: base traffic is low, but a popular on-sale event can generate millions of concurrent requests in seconds. The prompt explicitly warns that auto-scaling alone does not solve this (scaling takes time and has limits; the hot contended resource — a seat row — doesn't get faster by adding more app replicas), and requires an explicit `CloudFront → WAF → Waiting Room / Admission Control → API Gateway → Services` pipeline, plus explicit discussion of backpressure, rate limiting, load shedding, caching, queueing, and horizontal scaling.

## Decision
Locally, `services/gateway` (.NET 10 + YARP) is the single edge every request passes through and implements the pipeline's local-equivalent stages — true for Aspire dev always, and for k8s prior to DECISIONS.md D17:

1. **Rate limiting** — `Microsoft.AspNetCore.RateLimiting`'s sliding-window limiter, keyed by client IP (anonymous) or user id (authenticated), applied to all routes, tightest on seat-mutating routes.
2. **Load shedding** — each route's rate limiter is configured with a bounded queue (not unbounded): once the queue is full, new requests get an immediate `503 Retry-After` instead of piling up in memory waiting for a slot that may never come — protects the gateway process itself from falling over under the spike.
3. **Waiting Room / Admission Control** — for the specific high-contention routes (seat map, reserve), a **token-bucket admission counter in Redis**, shared across all gateway replicas: each request checks/increments a per-event concurrent-admission counter; under the threshold, it's admitted straight through; over the threshold, it receives a queue position and a short-poll/WebSocket "wait token" and is told to check back, rather than being forwarded to Ticketing at all. This is the mechanism that keeps the actual request rate hitting Ticketing/Order bounded to what Postgres can serve well, regardless of how many buyers are simultaneously trying.
4. **Routing (API Gateway role)** — after admission, YARP reverse-proxies to the appropriate downstream service by path prefix, injecting/forwarding `traceparent` and `CorrelationId` headers unchanged.

This is the one legitimate use of Redis in the system (`DECISIONS.md` D11) — it holds only traffic-shaping counters, never seat/reservation/order/payment state, so a Redis outage degrades the waiting room (fails open to "admit everyone" or fails closed to "queue everyone," a deliberate config choice) but can never cause a double-sell, because Ticketing's own Postgres CAS (ADR-0002) is what actually adjudicates every reservation regardless of what got past the gateway.

Additional mechanisms beyond the gateway itself:
- **Backpressure**: once past the gateway, the async chain (Payment/Ticketing-consumer/Notification) is entirely SQS-mediated (ADR-0004); each consumer pulls at a MassTransit-configured concurrency limit, so a slow downstream (e.g., the fake payment gateway simulating a slow processor) backs up its own queue depth rather than cascading load into upstream services.
- **Caching**: Catalog's event/venue/seat-map *layout* data (rarely changes, high read volume) is cacheable with a short TTL at the gateway/edge. Seat *availability* is explicitly never cached as authoritative (ADR-0007) — only pushed best-effort via SignalR.
- **Queueing**: everything after "order submitted" is queue-mediated by design (ADR-0003/0004), so a payment-processor slowdown doesn't block new reservations from being attempted — the systems are decoupled by the queue.
- **Horizontal scaling**: every service is stateless and horizontally replicable under Kubernetes HPA (session state lives in the JWT, seat state in Postgres, waiting-room state in the shared Redis) — scaling is a real, useful lever here, it's just explicitly *not* the whole answer, which is the prompt's point: scaling out five Ticketing replicas without the admission control above just means five replicas all hammering the same hot seat rows in Postgres, no better off.

## Alternatives considered
- **No waiting room, rely on auto-scaling + rate limiting alone.** This is precisely the approach the prompt says not to assume is sufficient — under a real flash-sale spike, unbounded admission means every request reaches Ticketing and contends for the same handful of hot rows; scaling app replicas doesn't add Postgres row-write throughput.
- **Waiting room implemented as a separate microservice rather than a gateway concern.** Considered; folded into the Gateway instead because admission control is inherently an edge/entry concern (it must run *before* a request reaches any business service, including auth), and a separate hop would add latency and another point of failure on every single request without a corresponding benefit — YARP's middleware pipeline is exactly the right place for this.
- **Global lock/semaphore in-process at Ticketing instead of gateway-level admission.** Rejected: doesn't help once Ticketing scales to multiple replicas (each replica's in-process semaphore only limits itself), and conflates "protect the database from overload" with "seat exclusivity," which ADR-0002 already solves correctly and independently — the waiting room's job is purely load-shaping, not correctness.

## Update — DECISIONS.md D17 (k8s no longer runs the waiting room)

As of D17, the k8s deployment replaced YARP with a real AWS API Gateway (LocalStack), which has
no equivalent to this Redis-backed admission counter. This was an accepted cut, not an oversight:
this mechanism already fails open by design (a Redis outage admits everyone rather than blocking
buyers) and is explicitly load-shaping, never correctness-bearing — the actual guarantee this ADR
depends on (no double-sell) is entirely Ticketing's own Postgres CAS (ADR-0002), which is
unaffected either way. Aspire dev is unchanged — it still runs this exactly as described above. A
real implementation of admission control on top of a real API Gateway would most likely move this
logic into the Lambda authorizer (already on the request path for JWT validation) with ElastiCache
Redis instead of the in-cluster one — a reasonable phase-2 addition, not attempted here.

## Trade-offs
- **Cost:** buyers above the admission threshold experience an explicit queue/wait — a deliberately visible trade-off (a "you're in line" UI state) rather than a silent slowdown, because the prompt prioritizes correctness/reliability over convenience.
- **Cost:** Redis becomes a dependency for the waiting room's cross-replica correctness (not for seat correctness) — sized and monitored as the traffic-shaping component it is.
- **Benefit:** Ticketing's Postgres never sees more concurrent reservation attempts than it and the admission threshold were tuned to handle, regardless of how many buyers are simultaneously trying — the spike is absorbed at the edge, not at the database.
