using MassTransit;
using Microsoft.Extensions.Logging;
using Orders.Contracts.V1;
using Payments.Application;
using Payments.Contracts.V1;

namespace Payments.Infrastructure;

/// <summary>
/// Consumes ProcessPaymentV1 (Orders' saga, published right after OrderSubmitted). Idempotent
/// consumption is covered two ways: MassTransit's EF Core Inbox (ADR-0005/0006) makes a redelivered
/// MessageId a no-op before Consume even runs, and PaymentProcessingService itself re-checks by
/// OrderId (the UNIQUE constraint, docs/CONTRACTS.md §7) before ever calling the gateway — this
/// second layer is what makes the Payment Service idempotent even against a distinct message that
/// happens to reference an order it already resolved, not just exact-message redelivery.
/// </summary>
public sealed class ProcessPaymentConsumer(PaymentProcessingService payments) : IConsumer<ProcessPaymentV1>
{
    public async Task Consume(ConsumeContext<ProcessPaymentV1> context)
    {
        var msg = context.Message;
        var outcome = await payments.ProcessAsync(
            new ProcessPaymentCommand(msg.OrderId, msg.Amount, msg.Currency, msg.SimulationMode),
            context.CancellationToken);

        if (outcome.Approved)
        {
            await context.Publish(new PaymentSucceededV1(outcome.OrderId, outcome.PaymentId, outcome.Amount, outcome.OccurredAtUtc, msg.CorrelationId));
        }
        else
        {
            await context.Publish(new PaymentFailedV1(outcome.OrderId, outcome.FailureReason ?? "Unknown", outcome.OccurredAtUtc, msg.CorrelationId));
        }
    }
}

/// <summary>
/// Consumes RefundPaymentV1 (Orders' saga, sent when seat confirmation fails after payment already
/// succeeded — DECISIONS.md D8). Refund is best-effort: PaymentProcessingService.RefundAsync
/// swallows and logs its own failures rather than throwing, so a refund problem never triggers
/// MassTransit message-level redelivery/retry-storm over money that's already captured.
/// </summary>
public sealed class RefundPaymentConsumer(PaymentProcessingService payments, ILogger<RefundPaymentConsumer> logger) : IConsumer<RefundPaymentV1>
{
    public async Task Consume(ConsumeContext<RefundPaymentV1> context)
    {
        var msg = context.Message;
        var paymentId = await payments.RefundAsync(msg.OrderId, msg.Reason, context.CancellationToken);

        if (paymentId is not null)
        {
            await context.Publish(new PaymentRefundedV1(msg.OrderId, paymentId.Value, msg.CorrelationId));
        }
        else
        {
            logger.LogInformation(
                "RefundPayment: no PaymentRefundedV1 published for order {OrderId} — refund did not complete (see prior logs)",
                msg.OrderId);
        }
    }
}
