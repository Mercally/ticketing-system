// Namespace is fixed by convention to Payments.Contracts.V1 — Payments is the canonical
// owner/publisher of these events (docs/CONTRACTS.md §10). MassTransit's default topology derives
// the SNS topic name from this full type name, so it must match exactly wherever a consumer
// (Orders' saga) keeps its own local copy.
namespace Payments.Contracts.V1;

public sealed record PaymentSucceededV1(Guid OrderId, Guid PaymentId, decimal Amount, DateTime ProcessedAtUtc, Guid CorrelationId);

public sealed record PaymentFailedV1(Guid OrderId, string Reason, DateTime FailedAtUtc, Guid CorrelationId);

public sealed record PaymentRefundedV1(Guid OrderId, Guid PaymentId, Guid CorrelationId);
