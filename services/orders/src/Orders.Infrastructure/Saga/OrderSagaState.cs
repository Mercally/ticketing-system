using MassTransit;

namespace Orders.Infrastructure.Saga;

/// <summary>
/// The saga instance IS the order aggregate for this workflow — deliberately no separate "Order"
/// table kept in sync with it (see Orders.Application.IOrderReadStore doc comment, and
/// DECISIONS.md D6/D7). CorrelationId = OrderId. CurrentState's string values match
/// docs/CONTRACTS.md §6's status enum exactly (the State names below), so the API can return
/// CurrentState as-is with no translation.
/// </summary>
public sealed class OrderSagaState : SagaStateMachineInstance, ISagaVersion
{
    public Guid CorrelationId { get; set; }
    public string CurrentState { get; set; } = default!;

    public Guid ReservationId { get; set; }
    public Guid SeatId { get; set; }
    public Guid EventId { get; set; }
    public Guid BuyerId { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = default!;
    public string? PaymentSimulationMode { get; set; }
    public string? FailureReason { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }

    public int Version { get; set; }
}
