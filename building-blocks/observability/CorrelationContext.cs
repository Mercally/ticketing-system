namespace TicketingPlatform.Observability;

/// <summary>
/// Ambient business CorrelationId — distinct from the OTel TraceId/SpanId (ADR context: DECISIONS.md D9).
/// A new OTel trace legitimately starts at most async boundaries; CorrelationId survives across them,
/// so "select one purchase" in the Aspire dashboard/logs still works across trace boundaries.
/// </summary>
public static class CorrelationContext
{
    private static readonly AsyncLocal<string?> Current = new();

    public static string? CorrelationId
    {
        get => Current.Value;
        set => Current.Value = value;
    }

    public static string GetOrCreate()
    {
        Current.Value ??= Guid.NewGuid().ToString();
        return Current.Value;
    }
}
