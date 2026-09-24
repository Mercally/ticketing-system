using Microsoft.Extensions.Logging;
using Payments.Domain;

namespace Payments.Application;

public sealed record ProcessPaymentCommand(Guid OrderId, decimal Amount, string Currency, string? SimulationMode);

public sealed record ProcessPaymentOutcome(Guid OrderId, bool Approved, Guid PaymentId, decimal Amount, string? FailureReason, DateTime OccurredAtUtc);

/// <summary>
/// Called by ProcessPaymentConsumer/RefundPaymentConsumer (Payments.Infrastructure). This is where
/// "the Payment Service must be idempotent" (prompt requirement) is concretely implemented: every
/// ProcessAsync call checks for an existing Payment row by OrderId BEFORE ever touching the gateway,
/// so a redelivered command (or a saga retry) never charges twice — it just re-derives the same
/// outcome from what's already persisted.
/// </summary>
public sealed class PaymentProcessingService(IPaymentStore payments, IPaymentGateway gateway, ILogger<PaymentProcessingService> logger)
{
    public async Task<ProcessPaymentOutcome> ProcessAsync(ProcessPaymentCommand command, CancellationToken cancellationToken)
    {
        var existing = await payments.GetByOrderIdAsync(command.OrderId, cancellationToken);
        if (existing is not null)
        {
            logger.LogInformation(
                "ProcessPayment: order {OrderId} already has a payment record (status {Status}) — not calling the gateway again",
                command.OrderId, existing.Status);
            return ToOutcome(existing);
        }

        PaymentGatewayResult gatewayResult;
        try
        {
            gatewayResult = await gateway.AuthorizeAsync(
                new PaymentGatewayRequest(command.OrderId, command.Amount, command.Currency, command.SimulationMode),
                cancellationToken);
        }
        catch (Exception ex)
        {
            // The resilience pipeline (Payments.Api Program.cs: timeout -> retry -> circuit breaker)
            // has already exhausted every SAFE option for this call by the time an exception reaches
            // here. Whatever remains — a connection failure after retries, the outer timeout firing,
            // or an open circuit — means there is NO definitive answer from the gateway: we don't
            // know if it processed the authorization or not. Treating this as a Failed payment here
            // (instead of re-throwing, which would trigger MassTransit message-level redelivery and
            // just repeat the exact same ambiguity against the gateway) is the safe default: nothing
            // is ever recorded as captured unless the gateway explicitly said so.
            logger.LogWarning(ex, "ProcessPayment: gateway call failed for order {OrderId}", command.OrderId);
            gatewayResult = new PaymentGatewayResult(false, null, $"GatewayUnavailable: {ex.GetType().Name}");
        }

        var payment = Payment.CreatePending(command.OrderId, command.Amount, command.Currency);
        var now = DateTime.UtcNow;

        if (gatewayResult.Approved)
        {
            payment.MarkSucceeded(gatewayResult.AuthCode ?? string.Empty, now);
        }
        else
        {
            payment.MarkFailed(gatewayResult.DeclineReason ?? "Declined", now);
        }

        var inserted = await payments.TryAddAsync(payment, cancellationToken);
        if (!inserted)
        {
            // Lost a genuine concurrent-insert race on the OrderId UNIQUE constraint (ADR-0006 last
            // line of defense) — extremely unlikely under the saga's normal single-publish-per-order
            // flow, but if it happens the gateway may have been called twice (this fake gateway has
            // no idempotency key of its own on /authorize; a real integration would pass one so the
            // processor itself dedupes). Defer to whichever row actually landed first rather than
            // silently discarding this attempt's outcome or inserting a second row.
            logger.LogWarning("ProcessPayment: lost insert race for order {OrderId} — re-reading the winning row", command.OrderId);
            var winner = await payments.GetByOrderIdAsync(command.OrderId, cancellationToken)
                ?? throw new InvalidOperationException($"Payment insert race for order {command.OrderId} but no winning row found.");
            return ToOutcome(winner);
        }

        return ToOutcome(payment);
    }

    /// <summary>
    /// Best-effort (DECISIONS.md D8): this fires when payment already succeeded but seat
    /// confirmation then failed — money already captured for a seat that didn't confirm, not a path
    /// that should retry-storm. Any failure here is logged and swallowed, never thrown, so a refund
    /// problem never triggers MassTransit message-level redelivery. Returns the refunded payment's
    /// Id on success (for the caller to publish PaymentRefundedV1), or null if nothing was refunded.
    /// </summary>
    public async Task<Guid?> RefundAsync(Guid orderId, string reason, CancellationToken cancellationToken)
    {
        try
        {
            var payment = await payments.GetByOrderIdAsync(orderId, cancellationToken);
            if (payment is null)
            {
                logger.LogWarning("RefundPayment: no payment found for order {OrderId} — nothing to refund", orderId);
                return null;
            }

            if (payment.Status == PaymentStatus.Refunded)
            {
                logger.LogInformation("RefundPayment: order {OrderId} already refunded — no-op", orderId);
                return null;
            }

            if (payment.Status != PaymentStatus.Succeeded)
            {
                logger.LogWarning(
                    "RefundPayment: order {OrderId} payment status is {Status}, not Succeeded — nothing to refund",
                    orderId, payment.Status);
                return null;
            }

            await gateway.RefundAsync(payment.AuthCode ?? string.Empty, orderId, cancellationToken);
            payment.MarkRefunded();
            await payments.UpdateAsync(payment, cancellationToken);

            return payment.Id;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "RefundPayment: refund failed for order {OrderId} (reason: {Reason})", orderId, reason);
            return null;
        }
    }

    private static ProcessPaymentOutcome ToOutcome(Payment payment)
        => new(payment.OrderId, payment.Status == PaymentStatus.Succeeded, payment.Id, payment.Amount, payment.FailureReason, payment.ProcessedAtUtc ?? payment.CreatedAtUtc);
}
