// Payments' own LOCAL copy of the commands Orders' saga sends it — namespace intentionally matches
// Orders.Contracts.V1 (the canonical owner/sender), NOT Payments' own namespace, so MassTransit's
// default type-name-based topology routes correctly with zero shared project reference
// (docs/CONTRACTS.md §10, DECISIONS.md D3). Only the two commands Payments actually consumes are
// copied here — same pattern as Ticketing.Application/IntegrationEvents/OrdersContractsV1.cs, which
// only carries ConfirmSeatV1/ReleaseReservationV1, the subset IT consumes.
namespace Orders.Contracts.V1;

public sealed record ProcessPaymentV1(Guid OrderId, Guid BuyerId, decimal Amount, string Currency, string IdempotencyKey, string? SimulationMode, Guid CorrelationId);

public sealed record RefundPaymentV1(Guid OrderId, string Reason, Guid CorrelationId);
