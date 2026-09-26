# Global Ticketing Platform

A PoC++ demo of a global concert-ticketing platform, built to validate how a microservices system — atomic seat inventory, a payment saga, async messaging, and full observability — actually behaves under Kubernetes locally. Polyglot monorepo: .NET 10 (Catalog, Ticketing, Orders, Payments, Gateway) + NestJS (Auth, Notification) + React.

## Tech stack

| Layer | Technology | Where |
|---|---|---|
| Backend (5 services) | .NET 10, Clean Architecture, EF Core + PostgreSQL | Catalog, Ticketing, Orders, Payments, Gateway |
| Backend (2 services) | NestJS, Prisma + PostgreSQL, Passport/JWT | Auth Service, Notification Service |
| Edge / routing | YARP (Aspire dev + k8s NodePort fallback) or a real **AWS API Gateway** via LocalStack, + a Lambda JWT authorizer (k8s, DECISIONS.md D17) | `services/gateway`, `infrastructure/aws-local` |
| Frontend | React + TypeScript + Vite | `apps/frontend`, served by nginx (k8s) or S3 (aws-local path) |
| Messaging | MassTransit over AWS SQS/SNS (LocalStack locally, real SQS/SNS on AWS) | saga orchestration between Orders/Payments/Ticketing |
| Cache / coordination | Redis | waiting-room + rate-limit counters only, never seat/order state |
| Local orchestration | **.NET Aspire** (dev loop) or **Kubernetes** (`kind`/`minikube` + Kustomize) | `aspire/AppHost`, `infrastructure/k8s` |
| IaC | Terraform (real-AWS skeleton + the applied `aws-local` API Gateway module) | `infrastructure/terraform` |
| Local AWS emulation | LocalStack (SQS/SNS always; API Gateway/Lambda/S3 for the `aws-local` path) | `infrastructure/k8s/base/localstack`, `infrastructure/aws-local` |
| Containers | Docker (one Dockerfile per service) | `infrastructure/docker` |

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

## Prerequisites

**Both paths need:**

- [.NET 10 SDK](https://dotnet.microsoft.com/download) (tested against `10.0.401`)
- [Node.js 22](https://nodejs.org/) (tested against `v22.18.0`)
- Docker Desktop (or another OCI builder), **running** — every non-.NET-project resource (Postgres, Redis, LocalStack) is container-backed in both Aspire and k8s
- A **free LocalStack account token** — sign up at <https://app.localstack.cloud>, copy the token from your account page. LocalStack refuses to start at all without one, even for the free-tier services this platform actually uses (SQS/SNS) — see [DECISIONS.md D16](DECISIONS.md#d16--localstack-now-requires-a-free-account-token-even-for-community-free-services). Where it goes differs per path — see below.

**Aspire path also needs:** the [Aspire CLI](https://aspire.dev) (`curl -sSL https://aspire.dev/install.sh | bash`, or `dotnet tool install -g Aspire.Cli`).

**Kubernetes path also needs:** `kubectl`, and a local cluster tool — `kind` (tested against `v0.33.0`) or `minikube`. Install both via Homebrew: `brew install kind kubectl`.

**Optional — the API Gateway path** (`infrastructure/aws-local`, DECISIONS.md D17) additionally needs the Terraform CLI (tested against `v1.12.1`) and the `aws` CLI. See [infrastructure/aws-local/README.md](infrastructure/aws-local/README.md) — it's a layer on top of a running k8s deployment, not a separate starting point.

## Running it locally

### Primary path — .NET Aspire (fast dev loop, hot reload, IDE debugging)

1. One-time: set the LocalStack token as a user secret —
   ```bash
   cd aspire/AppHost
   dotnet user-secrets set Parameters:localstack-auth-token <your-token>
   ```
2. Start it:
   ```bash
   aspire run          # foreground, opens the Aspire dashboard — normal interactive use
   # or: aspire start   # background — scripting/agent use, `aspire stop` to tear down
   ```
   Brings up all 5 Postgres instances, LocalStack (SQS/SNS), Redis, every .NET service, both NestJS services, and the frontend, wired together, with the Aspire dashboard as the local observability UI. **Never `dotnet run` the AppHost directly** — the Aspire CLI manages process lifecycle/locks that a bare `dotnet run` doesn't, and cleanup gets messy (stale locks, orphaned containers).
3. **To debug** (breakpoints, step-through): open the repo in your IDE (VS Code, Rider, Visual Studio), set `aspire/AppHost` as the startup/launch project, and start a debug session from there — the IDE's Aspire tooling attaches to the AppHost and (in Rider/VS) can attach to individual service processes too. Don't `aspire run`/`aspire start` from the terminal at the same time as an IDE debug session against the same AppHost — pick one.
4. Verify it's up: open the Aspire dashboard link printed in the terminal — every resource should reach `Running`/healthy within ~30s. Then open the frontend URL shown for the `frontend` resource (typically `http://localhost:5173`) and walk through register → login → browse → reserve → pay.
5. **Validated**: the full flow above (register/login/browse/reserve/pay, both success and decline paths) has been run end-to-end against this exact setup — see the session history in `DECISIONS.md` for the bugs that came up and got fixed along the way (Prisma migrations, a MassTransit outbox bug, CORS).

### Secondary path — Kubernetes (the stated purpose of this PoC)

1. Create a cluster (once): `kind create cluster --name ticketing`
2. One-time: put the LocalStack token in `infrastructure/k8s/base/localstack/secret.yaml`'s `LOCALSTACK_AUTH_TOKEN` (it ships with an obvious placeholder — never commit a real token there).
3. Build, load, apply:
   ```bash
   ./infrastructure/k8s/build-all.sh
   for svc in gateway catalog ticketing orders payments fakepaymentgateway auth-service notification-service frontend; do
     kind load docker-image "ticketing/${svc}:local" --name ticketing
   done
   kubectl apply -k infrastructure/k8s/overlays/local
   ```
4. Verify it's up: `kubectl -n ticketing get pods -w` — everything should reach `Running`/`1/1` within a couple of minutes (Postgres needs to run its init script first; that's expected, not a hang).
5. Reach it: `kubectl -n ticketing port-forward svc/frontend 30173:80 &` and `kubectl -n ticketing port-forward svc/gateway 30500:5000 &`, then open `http://localhost:30173`. Full detail (NodePort vs. port-forward trade-offs, troubleshooting) in [infrastructure/k8s/README.md](infrastructure/k8s/README.md).
6. **Validated**: same full flow as Aspire, run end-to-end against a real `kind` cluster the same way — 8 real bugs found and fixed in the process (missing databases, wrong config keys, a broken Dockerfile ordering bug), all documented in `DECISIONS.md`.

Testing against a **remote** Docker host instead of local Docker (simulating EKS/SNS/S3 without a real AWS account) has its own guide: [infrastructure/LOCAL_AWS_SIMULATION.md](infrastructure/LOCAL_AWS_SIMULATION.md).

### Third piece — a real API Gateway in front of the k8s deployment

Once the k8s cluster above is up, [infrastructure/aws-local/README.md](infrastructure/aws-local/README.md) replaces YARP with an actual AWS API Gateway (+ Lambda JWT authorizer, + the frontend on S3) via a second, host-level LocalStack instance (DECISIONS.md D17) — the same Terraform module is meant to be reapplied against real AWS later. Aspire dev is unaffected; it keeps YARP. Known gaps (the Lambda authorizer's LocalStack-specific limitation, dropped rate limiting/waiting room) are in [docs/ARCHITECTURE_GAPS.md](docs/ARCHITECTURE_GAPS.md).

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
