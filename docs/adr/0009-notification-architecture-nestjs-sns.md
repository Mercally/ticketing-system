# ADR-0009: Notification Architecture with NestJS + SNS

## Status
Accepted

## Context
The prompt requires notifications to be fully decoupled from the transactional purchase flow: Order, Payment, and Ticketing must never call a notification mechanism directly; a separate Notification Service, built with NestJS, consumes relevant domain events and publishes to AWS SNS, propagating trace/correlation context and processing idempotently, without ever affecting the purchase flow if it's slow or failing.

## Decision
`services/notification-service` (NestJS + TypeScript) is a pure event consumer with no involvement in the purchase transaction:

- **Consumes** (via the AWS SDK, polling its own SQS queues subscribed to the relevant SNS topics — see ADR-0004): `OrderConfirmed`, `PaymentSucceeded`, `PaymentFailed`, `TicketConfirmed`.
- **Idempotency**: every consumed message's `MessageId` is recorded in a local Postgres table (via Prisma, its own small schema — same database-per-service boundary as everywhere else, ADR-0001) before/as part of processing; a redelivered `MessageId` already recorded is acknowledged and skipped, mirroring the Inbox pattern used on the .NET side (ADR-0005/0006) but implemented directly since MassTransit isn't available in Node.
- **Publishes** a simplified outbound notification message to a `notifications-outbound` SNS topic — representing the abstraction boundary to actual delivery channels (email/SMS/push), which are out of scope for this PoC (no real SES/SNS-mobile/SMS integration is wired up; publishing to the topic is the observable, testable unit of "a notification was sent").
- **Propagates** `traceparent` and `CorrelationId` from the inbound SQS message attributes into its own OTel spans (`@opentelemetry/instrumentation-aws-sdk`, `@opentelemetry/instrumentation-http`) and forward into the outbound publish's message attributes, so the trace reconstructed in the Aspire dashboard includes this hop.
- **Retries transient failures** (e.g., SNS publish failing due to a throttling/network blip) via bounded retry with backoff at the SNS-publish call site; failures in *consuming* (processing a malformed or unexpected message) go through SQS's own redrive policy to a DLQ after N receives, same as the .NET consumers — poison messages here can't affect Order/Payment/Ticketing because there is no path back from Notification Service into their data.

Layering inside the service follows the same separation the prompt asks for NestJS services generally: `Controllers` (health/admin endpoints only — there's no public write API here), `Application/Use Cases` (`ProcessOrderConfirmedUseCase` etc., one per consumed event type), `Domain` (the notification record concept), `Infrastructure` (SQS/SNS clients, Prisma repository, OTel wiring).

## Alternatives considered
- **Order/Payment/Ticketing call Notification Service's API directly (synchronous HTTP) when something happens.** Explicitly forbidden by the prompt ("No enviar notificaciones directamente desde Order, Payment o Ticketing Service"), and for good reason: it would make the purchase's critical path depend on Notification Service's availability/latency, exactly the coupling the async event design elsewhere in the system is built to avoid.
- **Notification Service written in .NET like the other backend services, for stack consistency.** Rejected — the prompt explicitly specifies NestJS for this service (and for Auth), independent of the rest of the backend; this is treated as a deliberate polyglot requirement to demonstrate, not an oversight to "fix" toward consistency.
- **Notification Service calls real AWS SES/SMS/push providers.** Out of scope for a PoC with no external provider credentials; publishing to `notifications-outbound` SNS is the point where a real implementation would plug in downstream subscribers (SES-backed Lambda, etc.) without any change to Notification Service itself — the abstraction boundary is deliberately placed there.

## Trade-offs
- **Cost:** an extra hop (SNS → SQS → Notification Service → SNS again) versus a direct call — accepted deliberately for the decoupling guarantee; if Notification Service is entirely down, purchases still complete normally and notifications simply queue in SQS until it recovers.
- **Cost:** two different idempotency implementations exist in the codebase (MassTransit's built-in Inbox for .NET, a hand-written Prisma-backed check for NestJS) rather than one shared mechanism — an accepted consequence of the deliberate polyglot requirement (no shared code across the .NET/Node boundary is sensible anyway).
- **Benefit:** Notification Service can be redeployed, scaled, or even taken fully offline for a period without any buyer-facing impact on browsing, reserving, or purchasing — verified by `tests` covering duplicate consumption, idempotency, SNS publish, and trace propagation independent of the rest of the system.
