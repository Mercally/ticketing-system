namespace Gateway.Api;

/// <summary>
/// Admission-control scope reduction (ADR-0008): this implementation bounds CONCURRENT in-flight
/// requests per event on the hot Ticketing routes via a Redis counter shared across Gateway
/// replicas — the actual correctness-protecting mechanism (keeping request pressure on Ticketing's
/// Postgres bounded regardless of how many buyers are simultaneously trying). It does NOT
/// implement a queue-position/wait-token UX (buyer sees "please retry shortly" via 503 +
/// Retry-After, not a live position number) — that's a richer UI feature layered on the same
/// counter, left out of this PoC pass as a deliberate scope cut, not an oversight.
/// </summary>
public sealed class WaitingRoomOptions
{
    public const string SectionName = "WaitingRoom";

    public int MaxConcurrentAdmissionsPerEvent { get; set; } = 50;
    public int AdmissionWindowSeconds { get; set; } = 30;
}
