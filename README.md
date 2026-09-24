# Global Ticketing Platform

A PoC++ demo of a global concert-ticketing platform, built to validate how a microservices system — atomic seat inventory, a payment saga, async messaging, and full observability — actually behaves under Kubernetes locally. Polyglot monorepo: .NET 10 (Catalog, Ticketing, Orders, Payments, Gateway) + NestJS (Auth, Notification) + React.

Start here:

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — the proposed architecture, written before any code: microservices, responsibilities, consistency model, Mermaid diagrams.
- **[DECISIONS.md](DECISIONS.md)** — every place this build made a call the prompt left open (or scoped down for a PoC), with the reasoning.
- **[docs/adr/](docs/adr/)** — the 9 required Architecture Decision Records (database-per-service, seat consistency, saga vs. 2PC, messaging, outbox, idempotency, real-time, waiting room, notification architecture).
- **[docs/CONTRACTS.md](docs/CONTRACTS.md)** — the concrete reference: ports, HTTP surface, exact message shapes. What every service actually implements against.

## The core correctness claim, proven

The single hardest requirement — two buyers can never both reserve the same seat — is proven under real concurrent load against a real PostgreSQL instance in [`tests/Ticketing.ConcurrencyTests`](tests/Ticketing.ConcurrencyTests): 50 concurrent reservation attempts on the same seat, every run, exactly 1 succeeds and 49 fail. See [ADR-0002](docs/adr/0002-seat-consistency-strategy.md) for the mechanism (a single atomic conditional `UPDATE`, no locks).

## Repository layout

```text
/apps/frontend              React + TypeScript + Vite
/services
  /gateway                  .NET 10 + YARP — routing, rate limiting, waiting room
  /auth-service             NestJS + Prisma + Passport + JWT
  /notification-service     NestJS + AWS SDK — idempotent SNS fan-out
  /catalog                  .NET 10 — events (Clean Architecture)
  /ticketing                .NET 10 — seat inventory, the authority (Clean Architecture)
  /orders                   .NET 10 — MassTransit saga orchestrator (Clean Architecture)
  /payments                 .NET 10 — payment processing + Fake Payment Gateway (Clean Architecture)
/building-blocks             messaging / observability / idempotency conventions (no domain code)
/aspire                      AppHost (local orchestration) + ServiceDefaults
/infrastructure
  /docker                    one Dockerfile per service
  /k8s                       Kustomize manifests for local kind/minikube
  /terraform                 AWS target architecture (skeleton — see DECISIONS.md D4)
/tests                       concurrency, saga, and idempotency tests (root-level, cross-service)
/docs                        ADRs and standalone Mermaid diagram files
```

## Running it locally

**Primary path — .NET Aspire:**

```bash
cd aspire/AppHost
dotnet run
```

Brings up all 5 Postgres instances, LocalStack (SQS/SNS), Redis, every .NET service, both NestJS services, and the frontend, wired together, with the Aspire dashboard as the local observability UI. Requires Docker (every non-.NET-project resource is container-backed). **Not verified by an actual run in this build's environment** — see [DECISIONS.md D15](DECISIONS.md#d15--this-build-environment-has-no-docker-daemon-what-that-did-and-didnt-limit) for why, and what was verified instead.

**Secondary path — Kubernetes (the stated purpose of this PoC):**

```bash
./infrastructure/k8s/build-all.sh
# load images into your kind/minikube cluster (see infrastructure/k8s/README.md), then:
kubectl apply -k infrastructure/k8s/overlays/local
```

Full instructions, including how to reach the frontend/gateway and what to check once it's up, in [infrastructure/k8s/README.md](infrastructure/k8s/README.md).

## Running the tests

```bash
# Everything that doesn't need a live Postgres (saga logic, Node services):
dotnet test tests/Orders.SagaTests
cd services/auth-service && npm test && npm run test:e2e
cd services/notification-service && npm test

# The concurrency/idempotency proofs — need a local PostgreSQL reachable on
# localhost:5432 (see tests/Ticketing.ConcurrencyTests for the connection
# resolution — it reads ~/.pgpass, or set TICKETING_TEST_CONNECTION_STRING):
dotnet test tests/Ticketing.ConcurrencyTests
```

## Priorities

Per the governing prompt: **Correctness > Reliability > Observability > Scalability > Convenience.** Every trade-off in `ARCHITECTURE.md` and the ADRs was made in that order.
