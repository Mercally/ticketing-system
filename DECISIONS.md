# DECISIONS.md — Implementation decisions log

This is the document requested separately from the architecture: every place the governing prompt (`global-ticketing-platform-agent-prompt.md`) left a choice open, or where scope had to be bounded for a PoC++ demo, is logged here with the reasoning. Formal architecture trade-offs that the prompt explicitly asks for as ADRs live in `docs/adr/` instead — this file is the informal "why did you build it this way" log.

Entries are appended in build order, newest last.

---

## D1 — Added a Gateway service (not in the prompt's monorepo skeleton)

The prompt's `/services` list doesn't include a gateway, but the "Massive Traffic" section explicitly requires a `Waiting Room / Admission Control` stage and an `API Gateway` stage between WAF and the services. Locally there is no CloudFront/WAF/AWS API Gateway to stand in for those boxes, so `services/gateway` (.NET 10 + YARP) plays that role: rate limiting, load shedding, and waiting-room admission, then reverse-proxies to the real services. This is additive to the skeleton, not a deviation from it — the prompt says "Estructura base" (a base/starting structure), not an exhaustive list.

## D2 — Added a standalone Fake Payment Gateway process

The prompt asks for `IPaymentGateway` + `FakePaymentGateway` and lists failure modes to simulate (success/decline/timeout/duplicate callback/delayed response). Rather than implementing `FakePaymentGateway` as an in-process class inside Payment Service, it's a separate minimal-API process (`services/payments/FakePaymentGateway`) that Payment Service calls over real HTTP. Reasoning: an in-process fake can't meaningfully exercise the resilience requirements (timeout, retry, circuit breaker) the prompt also asks for — there's no network hop to time out or break a circuit over. A separate process makes "integración segura con una pasarela de pagos externa" and "Resilience" sections both actually testable, not just structurally present. `IPaymentGateway` is still the abstraction inside Payment Service; `HttpPaymentGatewayClient` is the real implementation that happens to point at the fake process in dev and would point at a real processor's endpoint in prod.

## D3 — No shared Contracts/SharedKernel assembly for integration events

The prompt is explicit: "No compartir entidades de dominio entre microservicios" and "No crear un SharedKernel que acople los dominios." Taken literally and applied to integration events too (not just domain entities): each consuming service hand-writes its own local copy of the subset of an event's shape it actually needs, rather than referencing a shared `Contracts` project. This costs a small amount of duplication (the same `OrderSubmittedV1` shape exists once in Orders as the producer and once in each consumer that needs it) in exchange for genuine deploy/compile independence between services — a shared contracts package is a coupling point by another name. Event type full-name + version suffix (`V1`, `V2`, ...) is the wire contract; changes are additive (new version, new topic) rather than breaking the existing one in place. `building-blocks/messaging` only holds naming/topology conventions and MassTransit configuration helpers — zero types shared across service boundaries.

## D4 — LocalStack for SQS/SNS locally, real AWS wiring left to Terraform

The prompt targets real AWS SQS/SNS. For a fully local, no-AWS-account-required PoC, `aspire/AppHost` runs a LocalStack container and MassTransit's AWS transport points at it in Development. This keeps the actual `MassTransit.AmazonSQS` code path identical between local and AWS — only the endpoint/credentials config differs — so there's no "fake messaging library" divergence between demo and target architecture. Terraform (`infrastructure/terraform`) defines the real SQS/SNS/IAM for AWS; it is not applied or tested as part of this build (no AWS credentials available in this environment) — it's reviewed for structural correctness only. This is the one area of the prompt treated as "representative skeleton" rather than "fully exercised," and it's called out explicitly here rather than silently under-built.

## D5 — Local Kubernetes runs one Postgres instance with five databases, not five instances

The prompt requires "una base de datos independiente por microservicio," which this system honors at the *logical* level everywhere: five separate databases, five separate EF Core/Prisma schemas, five separate migration histories, five separate credentials — no service ever queries another's tables. In `aspire/AppHost` (the primary local dev target) each service genuinely gets its own Postgres **container**. In `infrastructure/k8s` (the secondary, resource-constrained local-cluster target, whose whole point is validating multi-service behavior under Kubernetes on a laptop) a single Postgres `StatefulSet` hosts five databases created by an init script, to avoid five separate PVCs/pods on a local `kind`/`minikube` cluster. `infrastructure/terraform` provisions five independent RDS instances for the real target architecture. Database-per-service is a data-ownership boundary, not necessarily a hosting-cardinality requirement, and the prompt's own "Aspire para desarrollo/orquestación local" framing already treats local topology as separately tunable from the AWS target.

## D6 — Saga hosted inside Order Service, not a standalone orchestrator service

The prompt says "Implementar Saga mediante MassTransit Saga State Machine" but doesn't mandate where it lives. Order Service is the natural home: it already owns the Order aggregate whose lifecycle *is* the saga (Submitted → AwaitingPayment → Confirming → Completed/Cancelled), and MassTransit saga state is just another EF Core-mapped table in `orders-db`. A standalone orchestrator service would own no data of its own and would just be Order Service with extra network hops.

## D7 — Reservation happens synchronously outside the saga; the saga starts at "Create Order"

The prompt's flow is `Reserve Seat → Create Order → Process Payment → Confirm Seat/Ticket`. "Reserve Seat" needs an immediate yes/no answer for the buyer (it's a direct atomic CAS `UPDATE` against Ticketing's Postgres, per ADR-0002) — that's inherently synchronous and shouldn't be modeled as an async saga step. The saga is created by `OrderSubmitted` (i.e., once a reservation already exists and the buyer clicks "buy") and orchestrates everything from there: `ProcessPayment` → `ConfirmSeat` → `OrderConfirmed`. This matches the prompt's flow exactly; it just makes explicit that "Reserve Seat" is a precondition input to `Create Order`, not a saga step itself.

## D8 — Added a `Confirming → Cancelling` compensation edge not explicitly in the prompt

The prompt's compensation path is `Payment Failed → Cancel Order → Release Reservation`. There's a second failure mode the prompt doesn't mention: payment succeeds, but seat confirmation then fails (e.g., the reservation TTL lapsed in the small window between payment completing and the confirm command arriving). Silently ignoring this would mean charging a buyer for a seat they don't get. The saga handles it by also releasing the reservation and issuing a refund command to Payment Service in that case. Called out here because it's additive behavior beyond the literal spec, added for correctness (`Correctness` is priority #1 per the prompt's own ordering).

## D9 — CorrelationId is distinct from OTel TraceId, and equals OrderId once one exists

The prompt asks to propagate both `traceparent`/`TraceId`/`SpanId` (OTel) and `CorrelationId` through the whole chain. These aren't redundant: a new OTel trace legitimately starts at most async boundaries (that's normal/expected for message-based systems), but the *business* correlation (all activity belonging to one purchase) must survive across those trace boundaries. `CorrelationId` is minted client-side on first request (a GUID) and, once an order exists, becomes the OrderId — carried as an explicit header/message property and log-scope value everywhere, independent of whatever the current OTel trace happens to be.

## D10 — Idempotency-Key storage is per-service, not centralized

Each service that accepts an `Idempotency-Key` (Ticketing's reserve endpoint, Order Service's create endpoint, Payment Service's process endpoint) stores keys in its own Postgres table (`idempotency_keys`), not a shared cache/service. This follows directly from database-per-service — a shared idempotency store would be a cross-service dependency on someone else's data, exactly what the architecture is designed to avoid. `building-blocks/idempotency` provides the reusable ASP.NET Core middleware/filter and EF Core table shape; each service owns its own table and migration.

## D11 — Redis is used, scoped strictly to gateway traffic-shaping

The prompt says "NO utilices Redis como autoridad para garantizar exclusividad del asiento" — it does not forbid Redis outright. Redis is used exactly once, in the Gateway, to hold waiting-room admission counters shared across gateway replicas (in-memory state wouldn't work once the gateway itself scales horizontally under load, which is the whole point of the waiting room existing). No seat, reservation, or payment state is ever read from or written to Redis.

## D12 — Vertical-slice-first build order

Per the prompt's explicit instruction, implementation proceeds critical-path-first: Login → Browse Event → View Seats → Reserve Seat → Create Order → Payment → Confirm Ticket → Notification, fully working and tested end-to-end, before secondary breadth (admin CRUD surfaces, exhaustive Terraform, full k8s autoscaling policy tuning, etc.). Status of each area as of a given point in the build is tracked at the bottom of this file rather than duplicated in commit messages.

---

## D13 — Catalog and Ticketing seed independently, keyed by shared event id convention

Catalog owns event/venue reference data; Ticketing owns seat inventory. They are never allowed to call each other synchronously on the read path (that would make Ticketing's availability reads depend on Catalog's uptime, and vice versa). For the PoC's seed data, both services' startup seeders create records for the *same* well-known demo event ids (fixed GUIDs, not generated at random per service), so the vertical slice has matching data to demo against without one service reaching into the other's database or API at seed time. In a real system, Ticketing would learn about a new event via an `EventPublished`-style integration event from Catalog rather than a shared seed convention — noted here as a deliberate PoC shortcut, not the production design.

## D14 — NestJS services use Vitest, not Jest

`ARCHITECTURE.md` and the prompt's mention of testing assume Jest, the traditional NestJS default. The NestJS CLI version available in this environment (`@nestjs/cli` 12.x) scaffolds new projects with **Vitest** by default. Vitest is used as generated rather than fighting the toolchain to force Jest back in — it satisfies the same requirement (unit + e2e tests for Notification Service covering duplicate consumption, idempotency, SNS publish, trace propagation, retry behavior) with no meaningful difference in capability for this codebase's needs.

## D15 — This build environment has no Docker daemon; what that did and didn't limit

The sandbox this was built in has the `docker` CLI installed but no running daemon (`docker info` fails, no Docker Desktop app present) and no `kubectl`/`kind`/`minikube`. This mattered in two places, handled differently:

- **The concurrent-same-seat-reservation test** (`tests/Ticketing.ConcurrencyTests`, ADR-0002's core proof) needs a *real* PostgreSQL — an in-memory provider wouldn't exercise the row-level MVCC behavior the guarantee depends on, so a fake wasn't an option. Testcontainers (the natural choice) requires Docker. Instead, a PostgreSQL 16 instance was installed via Homebrew and run natively for the test, connecting via the local `~/.pgpass` credentials (never embedded in source — parsed at runtime, and `TICKETING_TEST_CONNECTION_STRING` overrides it entirely for a CI/other environment). The test creates and fully drops its own database (`ticketing_concurrency_test`) each run — no residue on the host. This is a full, honest substitution: the actual mechanism under test (EF Core's `ExecuteUpdateAsync` → one atomic conditional `UPDATE ... WHERE ...`) runs identically against any real Postgres instance; the test's value doesn't depend on that instance being containerized.
- **`aspire/AppHost` (local Aspire orchestration), `infrastructure/k8s` (Kustomize manifests), and `infrastructure/terraform`** could not be exercised end-to-end in this environment — Aspire's Postgres/Redis/LocalStack resources are container-backed, and there's no cluster to `kubectl apply` against. Each was instead verified as thoroughly as the environment allows: AppHost by `dotnet build aspire/AppHost` (confirms every Aspire hosting API call used resolves correctly against the real SDK); Terraform by `terraform validate` (passed — see the infrastructure commit); k8s manifests by parsing all 49 YAML files and confirming every path referenced in `base/kustomization.yaml` exists on disk. None of the three have been run against live infrastructure by this build. Running `dotnet run` in `aspire/AppHost` (with Docker available) is the natural next verification step for whoever picks this up locally.

## Build status snapshot

This section is updated as work proceeds; treat it as the current source of truth for "what's actually done" vs. "what's scaffolded."

**Fully implemented, built, and tested:**
- Architecture docs: `ARCHITECTURE.md`, this file, all 9 required ADRs, 7 Mermaid diagrams, `docs/CONTRACTS.md`.
- Catalog Service (.NET): events read API, EF Core + Postgres, seeded demo data.
- Ticketing Service (.NET): the seat CAS mechanism (ADR-0002), SignalR hub, MassTransit consumers/outbox/inbox, Idempotency-Key. **Proven under real concurrent load against real PostgreSQL** — 50-way concurrent same-seat reservation race, exactly 1 success every run.
- Order Service (.NET): MassTransit saga state machine orchestrating the full purchase flow plus both compensation paths (including the D8 addition), EF outbox/inbox, Idempotency-Key. 4/4 saga tests passing against MassTransit's in-memory test harness.
- Gateway (.NET + YARP): routing, rate limiting/load shedding, Redis-backed waiting room. Smoke-tested standalone (health check, proxy-to-unreachable-downstream behavior).
- Auth Service (NestJS): registration, login, JWT + refresh-token rotation with reuse-detection, Prisma + Postgres. 14 tests passing (unit + e2e against an in-memory Prisma fake).
- Notification Service (NestJS): idempotent SQS consumption, SNS republish, CorrelationId propagation, retry-on-transient-failure. 21 tests passing.
- Frontend (React + Vite): full buyer flow (login → browse → seat map with live SignalR updates → reserve → checkout with simulation-mode selector → order status polling). Builds clean; not exercised against a live backend (see D15-adjacent note below — no full stack was ever running simultaneously in this environment).
- Building blocks (messaging/observability/idempotency), infra (Dockerfiles, k8s manifests, Terraform skeleton — `terraform validate` passing).

**Implemented, builds clean, smoke-tested standalone, not covered by an automated test suite:**
- Payment Service + Fake Payment Gateway (.NET): `IPaymentGateway` abstraction, resilient HTTP client (timeout→retry→circuit breaker), 5 simulation modes, webhook idempotency, EF outbox/inbox. FakePaymentGateway's `/authorize` smoke-tested directly (Success → 200+authCode, Decline → 402); Payment Service's consumer/resilience logic itself has no dedicated test project yet.
- `aspire/AppHost` full-stack wiring: compiles cleanly (`dotnet build`, confirming every Aspire hosting API call used resolves against the real SDK); never run end-to-end (D15).

**Known gaps, honestly, rather than silently absent:**
- No live end-to-end run of the full purchase flow (Login → Browse → Reserve → Order → Payment → Confirm → Notification) through a running stack — this environment never had all the pieces (Docker, LocalStack, 5 live Postgres instances, all 8 services, the frontend) running simultaneously to attempt one. Every individual piece is tested in isolation instead.
- `tests/Ticketing.ConcurrencyTests` also proves `EfIdempotencyStore`'s UNIQUE-constraint race handling directly against real Postgres (concurrent `TryInsertPendingAsync` calls for the same key — exactly one winner), which is the correctness-critical logic `[Idempotent]` relies on and is shared verbatim by Orders/Payments. No dedicated `Orders.IntegrationTests`/`Payments.IntegrationTests` project exercises the full `Idempotency-Key` HTTP behavior end-to-end via `WebApplicationFactory` though — lower marginal value given the above, and real risk of the test hanging on MassTransit's AWS transport trying to reach LocalStack, which isn't available either (D15).
- SignalR Redis backplane (ADR-0007) is documented but not wired — Ticketing runs single-replica by design in both Aspire and k8s, which is consistent, not silently broken, but scaling it out would need that backplane added first.
