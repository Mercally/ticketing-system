namespace Orders.Application;

public sealed record CreateOrderRequest(
    Guid ReservationId,
    Guid EventId,
    Guid SeatId,
    Guid BuyerId,
    decimal Amount,
    string Currency,
    string? PaymentSimulationMode);

public sealed record CreateOrderResult(Guid OrderId, string Status);

public sealed record OrderDto(
    Guid OrderId,
    string Status,
    Guid EventId,
    Guid SeatId,
    decimal Amount,
    string Currency,
    string? FailureReason,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc);
