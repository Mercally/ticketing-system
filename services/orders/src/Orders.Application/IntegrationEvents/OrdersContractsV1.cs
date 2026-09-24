// Namespace fixed to Orders.Contracts.V1 — Orders is the canonical owner/sender of every type
// here (docs/CONTRACTS.md §10). Commands (ProcessPayment/ConfirmSeat/ReleaseReservation/
// RefundPayment) are implemented as PUBLISHED messages with exactly one intended subscriber,
// not point-to-point Send — see DECISIONS.md D3 amendment: this avoids the saga needing to know
// another service's exact auto-generated queue name/address across a compiled-independently
// service boundary, which Send() would require. Publish's topic name is derived deterministically
// from this type's full name by both sides' identical kebab-case formatter, so it just works.
namespace Orders.Contracts.V1;

public sealed record OrderSubmittedV1(
    Guid OrderId,
    Guid ReservationId,
    Guid SeatId,
    Guid EventId,
    Guid BuyerId,
    decimal Amount,
    string Currency,
    string? PaymentSimulationMode,
    Guid CorrelationId);

public sealed record OrderConfirmedV1(Guid OrderId, Guid EventId, Guid SeatId, Guid BuyerId, decimal Amount, DateTime ConfirmedAtUtc, Guid CorrelationId);

public sealed record OrderCancelledV1(Guid OrderId, string Reason, Guid CorrelationId);

public sealed record ProcessPaymentV1(Guid OrderId, Guid BuyerId, decimal Amount, string Currency, string IdempotencyKey, string? SimulationMode, Guid CorrelationId);

public sealed record ConfirmSeatV1(Guid OrderId, Guid ReservationId, Guid SeatId, Guid CorrelationId);

public sealed record ReleaseReservationV1(Guid OrderId, Guid ReservationId, Guid SeatId, Guid CorrelationId);

public sealed record RefundPaymentV1(Guid OrderId, string Reason, Guid CorrelationId);
