using MassTransit;
using MassTransit.Testing;
using Microsoft.Extensions.DependencyInjection;
using Orders.Contracts.V1;
using Orders.Infrastructure.Saga;
using Payments.Contracts.V1;
using Ticketing.Contracts.V1;
using Xunit;

namespace Orders.SagaTests;

/// <summary>
/// Exercises the saga state machine (ARCHITECTURE.md §7, ADR-0003) end-to-end over MassTransit's
/// in-memory test harness — no real SQS/SNS, no Postgres (the saga repository here is in-memory;
/// EF persistence is validated separately by the fact that `dotnet ef migrations add` succeeds
/// against OrdersDbContext, which includes this exact saga entity).
///
/// Assertions are made primarily against PUBLISHED messages rather than internal saga state,
/// because the published messages are the actual observable contract the rest of the system
/// depends on. Positive assertions (`await harness.Published.Any&lt;T&gt;()`) wait/poll for the
/// message; negative assertions ("this must NOT have been published") are checked as a
/// synchronous snapshot via `harness.Published.Select&lt;T&gt;()` instead of awaiting `Any&lt;T&gt;()` —
/// awaiting a negative `Any&lt;T&gt;()` blocks for the harness's full timeout budget every time (there's
/// nothing to short-circuit on), and doing that more than once per test starves later positive
/// awaits of their share of that same shared budget. Negative checks are placed AFTER the positive
/// await that already proves enough wall-clock time has passed for the negative case to have
/// happened too, if it were going to.
/// </summary>
public sealed class OrderStateMachineTests : IAsyncLifetime
{
    private ServiceProvider _provider = default!;
    private ITestHarness _harness = default!;

    public async Task InitializeAsync()
    {
        var services = new ServiceCollection();
        services.AddMassTransitTestHarness(x =>
        {
            x.AddSagaStateMachine<OrderStateMachine, OrderSagaState>();
        });

        _provider = services.BuildServiceProvider(true);
        _harness = _provider.GetRequiredService<ITestHarness>();
        await _harness.Start();
    }

    public async Task DisposeAsync()
    {
        await _harness.Stop();
        await _provider.DisposeAsync();
    }

    private static OrderSubmittedV1 NewOrderSubmitted(Guid orderId, string? simulationMode = null) => new(
        orderId,
        ReservationId: Guid.NewGuid(),
        SeatId: Guid.NewGuid(),
        EventId: Guid.NewGuid(),
        BuyerId: Guid.NewGuid(),
        Amount: 89.99m,
        Currency: "USD",
        PaymentSimulationMode: simulationMode,
        CorrelationId: orderId);

    private bool WasPublished<T>(Guid orderId, Func<T, Guid> orderIdSelector) where T : class
        => _harness.Published.Select<T>().Any(x => orderIdSelector((T)x.Context.Message) == orderId);

    [Fact]
    public async Task Happy_path_reserve_to_confirmed_publishes_every_expected_step_in_order()
    {
        var orderId = Guid.NewGuid();

        await _harness.Bus.Publish(NewOrderSubmitted(orderId));
        Assert.True(await _harness.Published.Any<ProcessPaymentV1>(x => x.Context.Message.OrderId == orderId));

        await _harness.Bus.Publish(new PaymentSucceededV1(orderId, Guid.NewGuid(), 89.99m, DateTime.UtcNow, orderId));
        Assert.True(await _harness.Published.Any<ConfirmSeatV1>(x => x.Context.Message.OrderId == orderId));

        await _harness.Bus.Publish(new TicketConfirmedV1(orderId, Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), DateTime.UtcNow, orderId));
        Assert.True(await _harness.Published.Any<OrderConfirmedV1>(x => x.Context.Message.OrderId == orderId));

        var instance = _harness.GetSagaStateMachineHarness<OrderStateMachine, OrderSagaState>().Created.Contains(orderId);
        Assert.NotNull(instance);
        Assert.Equal("Completed", instance!.CurrentState);

        // Never two successful confirmations / never a purchase that both charges and doesn't
        // confirm: exactly one OrderConfirmedV1 for this order, and no OrderCancelledV1 at all.
        Assert.Equal(1, _harness.Published.Select<OrderConfirmedV1>().Count(x => x.Context.Message.OrderId == orderId));
        Assert.False(WasPublished<OrderCancelledV1>(orderId, m => m.OrderId));
    }

    [Fact]
    public async Task Payment_failed_cancels_order_and_releases_the_reservation_never_confirming_the_seat()
    {
        var orderId = Guid.NewGuid();

        await _harness.Bus.Publish(NewOrderSubmitted(orderId, simulationMode: "Decline"));
        Assert.True(await _harness.Published.Any<ProcessPaymentV1>(x => x.Context.Message.OrderId == orderId));

        await _harness.Bus.Publish(new PaymentFailedV1(orderId, "card_declined", DateTime.UtcNow, orderId));
        Assert.True(await _harness.Published.Any<ReleaseReservationV1>(x => x.Context.Message.OrderId == orderId));

        await _harness.Bus.Publish(new ReservationReleasedV1(orderId, Guid.NewGuid(), Guid.NewGuid(), orderId));
        Assert.True(await _harness.Published.Any<OrderCancelledV1>(x => x.Context.Message.OrderId == orderId));

        var instance = _harness.GetSagaStateMachineHarness<OrderStateMachine, OrderSagaState>().Created.Contains(orderId);
        Assert.NotNull(instance);
        Assert.Equal("Cancelled", instance!.CurrentState);

        Assert.False(WasPublished<ConfirmSeatV1>(orderId, m => m.OrderId));
        Assert.False(WasPublished<OrderConfirmedV1>(orderId, m => m.OrderId));
    }

    /// <summary>
    /// DECISIONS.md D8: payment succeeds but seat confirmation then fails — the saga must both
    /// release the reservation AND refund the payment, so a buyer is never charged for a seat
    /// they don't get. This is additive correctness behavior beyond the prompt's literal
    /// compensation path, and is exactly what this test guards.
    /// </summary>
    [Fact]
    public async Task Ticket_confirmation_failure_after_payment_success_releases_the_seat_and_refunds_the_payment()
    {
        var orderId = Guid.NewGuid();

        await _harness.Bus.Publish(NewOrderSubmitted(orderId));
        await _harness.Bus.Publish(new PaymentSucceededV1(orderId, Guid.NewGuid(), 89.99m, DateTime.UtcNow, orderId));
        Assert.True(await _harness.Published.Any<ConfirmSeatV1>(x => x.Context.Message.OrderId == orderId));

        await _harness.Bus.Publish(new TicketConfirmationFailedV1(orderId, Guid.NewGuid(), Guid.NewGuid(), "ReservationExpired", orderId));
        Assert.True(await _harness.Published.Any<ReleaseReservationV1>(x => x.Context.Message.OrderId == orderId));
        Assert.True(await _harness.Published.Any<RefundPaymentV1>(x => x.Context.Message.OrderId == orderId));

        await _harness.Bus.Publish(new ReservationReleasedV1(orderId, Guid.NewGuid(), Guid.NewGuid(), orderId));
        Assert.True(await _harness.Published.Any<OrderCancelledV1>(x => x.Context.Message.OrderId == orderId));

        Assert.False(WasPublished<OrderConfirmedV1>(orderId, m => m.OrderId));
    }

    [Fact]
    public async Task Two_concurrent_orders_are_tracked_independently_by_CorrelationId()
    {
        var orderA = Guid.NewGuid();
        var orderB = Guid.NewGuid();

        await _harness.Bus.Publish(NewOrderSubmitted(orderA));
        await _harness.Bus.Publish(NewOrderSubmitted(orderB));

        await _harness.Bus.Publish(new PaymentSucceededV1(orderA, Guid.NewGuid(), 89.99m, DateTime.UtcNow, orderA));
        Assert.True(await _harness.Published.Any<ConfirmSeatV1>(x => x.Context.Message.OrderId == orderA));

        await _harness.Bus.Publish(new PaymentFailedV1(orderB, "insufficient_funds", DateTime.UtcNow, orderB));
        Assert.True(await _harness.Published.Any<ReleaseReservationV1>(x => x.Context.Message.OrderId == orderB));

        Assert.False(WasPublished<ReleaseReservationV1>(orderA, m => m.OrderId));
        Assert.False(WasPublished<ConfirmSeatV1>(orderB, m => m.OrderId));
    }
}
