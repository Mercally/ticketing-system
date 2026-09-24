# ADR-0004: SQS/SNS Messaging

## Status
Accepted

## Context
Asynchronous communication between services (saga commands/events, notification fan-out) must survive individual service restarts, handle at-least-once delivery without corrupting business state, isolate poison messages, and remain observable end-to-end. The prompt mandates AWS SQS (+ SNS where appropriate) as the transport and MassTransit as the .NET abstraction over it.

## Decision
Use **MassTransit with the AWS transport** (`MassTransit.AmazonSQS`) for all .NET-side messaging. Topology: each publishable integration event maps to one **SNS topic**; each service that needs to consume it owns one **SQS queue** subscribed to that topic (fan-out), following MassTransit's default publish-topology conventions. Commands (`ProcessPayment`, `ConfirmSeat`, `ReleaseReservation`) are sent directly to the target service's queue rather than broadcast via SNS, since a command has exactly one intended recipient.

Every queue is provisioned with a **dead-letter queue**; MassTransit's default retry + redelivery policy is configured explicitly per consumer (short in-memory retry for transient faults, longer redelivery via a delayed-redelivery queue for faults that need backoff, then DLQ after the configured attempt count) rather than left at library defaults, so poison-message handling is a deliberate, visible choice per consumer rather than implicit. Every message carries: a `CorrelationId` header (business correlation, ADR context in `ARCHITECTURE.md` §10), the W3C `traceparent` (via MassTransit's native `ActivitySource` integration, which OTel picks up automatically), and a `MessageId` used both by SQS's own deduplication semantics and by the Inbox pattern (ADR-0005) for idempotent consumption. Message contracts are versioned by type name suffix (`V1`, `V2`, ...); a breaking change ships as a new type/topic rather than mutating an existing one in place, so old and new consumers can coexist during rollout.

Locally, MassTransit's AWS transport points at a **LocalStack** container (see `DECISIONS.md` D4) so the exact same transport code path runs in dev and in AWS — only endpoint/credentials configuration differs between environments.

NestJS services (Notification Service) talk to the same SQS queues/SNS topics directly via the AWS SDK (not MassTransit, which is .NET-only), applying the same conventions (dead-letter queues, correlation propagation, idempotent handling) by hand — see ADR-0009.

## Alternatives considered
- **MassTransit with RabbitMQ transport, deployed separately from AWS.** Would be simpler to run locally (a single container, no LocalStack needed) but would mean the local dev/test path exercises a fundamentally different transport than production, undermining exactly the kind of "test what you ship" confidence this PoC is meant to build. Rejected in favor of LocalStack, which keeps the real `MassTransit.AmazonSQS` code path in use everywhere.
- **Kafka.** Stronger fit for high-throughput event streaming with replay, but the prompt specifies AWS SQS/SNS explicitly, and introducing Kafka here would be exactly the "technology chosen because it's popular" anti-pattern the prompt warns against — SQS/SNS's simpler at-least-once queue+fanout model is sufficient for this system's actual message volume and semantics (commands and domain events, not a stream needing replay/windowing).
- **One SQS queue consumed by all services (shared queue, filter by message type).** Rejected: couples every consumer's scaling and failure characteristics to a single queue's throughput and redrive policy, and makes per-consumer DLQ/retry tuning impossible. One queue per consumer per topic keeps failure isolated to exactly the consumer experiencing it.

## Trade-offs
- **Cost:** SNS+SQS fan-out means an event published once may be delivered to multiple queues, each independently at-least-once — consumers **must** be idempotent (ADR-0005/0006); this isn't optional given the topology, so it's built in from the start rather than retrofitted.
- **Cost:** LocalStack is an approximation of real AWS, not a perfect one; some IAM/throttling/limits behavior can only be verified against real AWS. Acceptable for a local PoC; Terraform defines the real target for when that verification matters.
- **Benefit:** dev/test and production run literally the same transport client code, which is the strongest available confidence that messaging behavior (retries, DLQ, ordering-within-partition-key where used) observed locally will match production.
