# ADR-0001: Database per Service

## Status
Accepted

## Context
Five services own transactional state that must evolve independently: Auth (users/credentials), Catalog (events/venues), Ticketing (seat inventory), Orders (order lifecycle + saga), Payments (payment attempts). The prompt mandates strict service autonomy: no shared domain entities, no SharedKernel, independent deployability, and explicit database-per-microservice.

## Decision
Each service owns exactly one PostgreSQL database, with its own schema, migrations, and credentials. No service is ever granted network access to another service's database. All cross-service reads go through the owning service's API or through data it has received via events (i.e., its own local read model), never a direct join across databases.

Concretely:
- `auth-db` — owned by Auth Service (Prisma migrations)
- `catalog-db` — owned by Catalog Service (EF Core migrations)
- `ticketing-db` — owned by Ticketing Service (EF Core migrations)
- `orders-db` — owned by Order Service (EF Core migrations, includes MassTransit saga/outbox/inbox tables)
- `payments-db` — owned by Payment Service (EF Core migrations, includes outbox/inbox tables)

Hosting cardinality differs by environment (see `DECISIONS.md` D5): Aspire local dev runs five separate Postgres containers (closest to production topology); the local Kubernetes target runs one Postgres StatefulSet with five databases (laptop resource constraint); Terraform provisions five independent RDS instances for the AWS target. The logical ownership boundary — never queried cross-database — holds in every environment.

## Alternatives considered
- **Single shared database, separate schemas.** Rejected: a shared instance becomes a shared blast radius (one noisy-neighbor migration or lock storm degrades every service) and makes "independent deployability" a lie in practice even if schemas are logically separated.
- **Shared read-only reporting database fed by CDC.** Deferred, not rejected — reasonable for a future analytics need, but adds infrastructure (CDC pipeline) the PoC doesn't need yet. Each service instead publishes the specific integration events other services need (e.g., Ticketing doesn't need Catalog's full event data, only what's in `EventPublished`/similar).

## Trade-offs
- **Cost:** no cross-service joins; any view that needs data from two services must either call both APIs or maintain a local denormalized copy fed by events. This is accepted deliberately, not incidental.
- **Benefit:** a schema migration, a slow query, or a full outage in one service's database cannot directly take down another service's database.
- **Benefit:** each service can pick the storage technology and schema shape best suited to its access pattern (e.g., Ticketing's seat table is optimized for a single hot atomic UPDATE path, unrelated to Catalog's read-heavy reference data).
