// Orders' own LOCAL copies of event shapes it consumes but does not own (DECISIONS.md D3) — each
// namespace matches the OWNING service exactly, per docs/CONTRACTS.md §10's namespace-ownership
// rule, even though physically compiled here. (Block-scoped namespaces: a file can only carry one
// file-scoped namespace declaration, and this file needs two.)

namespace Payments.Contracts.V1
{
    public sealed record PaymentSucceededV1(Guid OrderId, Guid PaymentId, decimal Amount, DateTime ProcessedAtUtc, Guid CorrelationId);

    public sealed record PaymentFailedV1(Guid OrderId, string Reason, DateTime FailedAtUtc, Guid CorrelationId);
}

namespace Ticketing.Contracts.V1
{
    public sealed record TicketConfirmedV1(Guid OrderId, Guid ReservationId, Guid SeatId, Guid EventId, DateTime ConfirmedAtUtc, Guid CorrelationId);

    public sealed record TicketConfirmationFailedV1(Guid OrderId, Guid ReservationId, Guid SeatId, string Reason, Guid CorrelationId);

    public sealed record ReservationReleasedV1(Guid OrderId, Guid ReservationId, Guid SeatId, Guid CorrelationId);
}
