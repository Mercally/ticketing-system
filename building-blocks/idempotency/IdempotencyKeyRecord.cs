namespace TicketingPlatform.Idempotency;

/// <summary>
/// Persistence shape each service maps to its OWN "idempotency_keys" table (own DbContext, own
/// migration — DECISIONS.md D10: no shared idempotency store across services). PK is
/// (Endpoint, Key). A row with ResponseBody == null is "in flight" (the original request hasn't
/// finished yet) — see ADR-0006.
/// </summary>
public sealed class IdempotencyKeyRecord
{
    public string Endpoint { get; set; } = default!;
    public string Key { get; set; } = default!;
    public string RequestHash { get; set; } = default!;
    public int? StatusCode { get; set; }
    public string? ResponseBody { get; set; }
    public string? ResponseContentType { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime ExpiresAtUtc { get; set; }
}
