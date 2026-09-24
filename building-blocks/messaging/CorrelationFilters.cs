using MassTransit;
using TicketingPlatform.Observability;

namespace TicketingPlatform.Messaging;

/// <summary>
/// Stamps the ambient business CorrelationId (building-blocks/observability) onto every
/// outgoing Send/Publish, so it survives async boundaries without every call site remembering
/// to set it by hand (ADR-0004, DECISIONS.md D9).
/// </summary>
public sealed class CorrelationIdSendFilter<T> : IFilter<SendContext<T>> where T : class
{
    public Task Send(SendContext<T> context, IPipe<SendContext<T>> next)
    {
        var correlationId = CorrelationContext.CorrelationId;
        if (!string.IsNullOrWhiteSpace(correlationId) && !context.Headers.TryGetHeader("CorrelationId", out _))
        {
            context.Headers.Set("CorrelationId", correlationId);
        }

        return next.Send(context);
    }

    public void Probe(ProbeContext context) => context.CreateFilterScope("correlationIdSend");
}

public sealed class CorrelationIdPublishFilter<T> : IFilter<PublishContext<T>> where T : class
{
    public Task Send(PublishContext<T> context, IPipe<PublishContext<T>> next)
    {
        var correlationId = CorrelationContext.CorrelationId;
        if (!string.IsNullOrWhiteSpace(correlationId) && !context.Headers.TryGetHeader("CorrelationId", out _))
        {
            context.Headers.Set("CorrelationId", correlationId);
        }

        return next.Send(context);
    }

    public void Probe(ProbeContext context) => context.CreateFilterScope("correlationIdPublish");
}

/// <summary>
/// On the consume side, restores CorrelationId from the message header into the ambient context
/// so downstream logs/sends within this consumer keep the same business correlation, even though
/// a new OTel trace legitimately starts here.
/// </summary>
public sealed class CorrelationIdConsumeFilter<T> : IFilter<ConsumeContext<T>> where T : class
{
    public Task Send(ConsumeContext<T> context, IPipe<ConsumeContext<T>> next)
    {
        if (context.Headers.TryGetHeader("CorrelationId", out var value) && value is string correlationId)
        {
            CorrelationContext.CorrelationId = correlationId;
            System.Diagnostics.Activity.Current?.SetTag("correlation_id", correlationId);
        }

        return next.Send(context);
    }

    public void Probe(ProbeContext context) => context.CreateFilterScope("correlationIdConsume");
}
