// Namespace is fixed by convention to Ticketing.Contracts.V1 — Ticketing is the canonical
// owner/publisher of these events (docs/CONTRACTS.md §10). MassTransit's default topology derives
// the SNS topic name from this full type name, so it must match exactly wherever a consumer keeps
// its own local copy.
namespace Ticketing.Contracts.V1;

public sealed record TicketConfirmedV1(Guid OrderId, Guid ReservationId, Guid SeatId, Guid EventId, DateTime ConfirmedAtUtc, Guid CorrelationId);

public sealed record TicketConfirmationFailedV1(Guid OrderId, Guid ReservationId, Guid SeatId, string Reason, Guid CorrelationId);

public sealed record ReservationReleasedV1(Guid OrderId, Guid ReservationId, Guid SeatId, Guid CorrelationId);
