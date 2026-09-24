// Ticketing's own LOCAL copy of the commands Orders' saga sends it — namespace intentionally
// matches Orders.Contracts.V1 (the canonical owner/sender), NOT Ticketing's own namespace, so
// MassTransit's default type-name-based topology routes correctly with zero shared project
// reference (docs/CONTRACTS.md §10, DECISIONS.md D3).
namespace Orders.Contracts.V1;

public sealed record ConfirmSeatV1(Guid OrderId, Guid ReservationId, Guid SeatId, Guid CorrelationId);

public sealed record ReleaseReservationV1(Guid OrderId, Guid ReservationId, Guid SeatId, Guid CorrelationId);
