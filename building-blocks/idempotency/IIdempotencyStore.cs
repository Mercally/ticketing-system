namespace TicketingPlatform.Idempotency;

public interface IIdempotencyStore
{
    Task<IdempotencyKeyRecord?> FindAsync(string endpoint, string key, CancellationToken cancellationToken);

    /// <summary>
    /// Inserts a "pending" row (no response yet). Returns false if a concurrent request already
    /// inserted the same (endpoint, key) first — a genuine race under the same fresh key, caught
    /// by the UNIQUE constraint that backs this (ADR-0006's "last line of defense"). Callers
    /// should re-<see cref="FindAsync"/> on false rather than treat it as an error.
    /// </summary>
    Task<bool> TryInsertPendingAsync(string endpoint, string key, string requestHash, DateTime expiresAtUtc, CancellationToken cancellationToken);

    Task CompleteAsync(string endpoint, string key, int statusCode, string responseBody, string contentType, CancellationToken cancellationToken);
}
