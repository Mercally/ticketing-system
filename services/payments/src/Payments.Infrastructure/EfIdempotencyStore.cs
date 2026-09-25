using Microsoft.EntityFrameworkCore;
using TicketingPlatform.Idempotency;

namespace Payments.Infrastructure;

public sealed class EfIdempotencyStore(PaymentsDbContext db) : IIdempotencyStore
{
    public async Task<IdempotencyKeyRecord?> FindAsync(string endpoint, string key, CancellationToken cancellationToken)
        => await db.IdempotencyKeys.AsNoTracking().FirstOrDefaultAsync(k => k.Endpoint == endpoint && k.Key == key, cancellationToken);

    public async Task<bool> TryInsertPendingAsync(string endpoint, string key, string requestHash, DateTime expiresAtUtc, CancellationToken cancellationToken)
    {
        db.IdempotencyKeys.Add(new IdempotencyKeyRecord
        {
            Endpoint = endpoint,
            Key = key,
            RequestHash = requestHash,
            CreatedAtUtc = DateTime.UtcNow,
            ExpiresAtUtc = expiresAtUtc,
        });

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException)
        {
            // UNIQUE (Endpoint, Key) violation — a concurrent request for the same fresh key won the race.
            db.ChangeTracker.Clear();
            return false;
        }
    }

    public async Task CompleteAsync(string endpoint, string key, int statusCode, string responseBody, string contentType, CancellationToken cancellationToken)
    {
        // ExecuteUpdateAsync would bypass SaveChangesAsync (and with it, MassTransit's EF Core bus
        // outbox — Publish() calls made earlier in this request are only flushed to OutboxMessage
        // when THIS DbContext's SaveChangesAsync runs). Go through the tracked entity instead so
        // this write and the buffered outbox message commit together.
        var record = await db.IdempotencyKeys.FirstOrDefaultAsync(k => k.Endpoint == endpoint && k.Key == key, cancellationToken)
            ?? throw new InvalidOperationException($"Idempotency key record not found for completion: {endpoint} {key}");

        record.StatusCode = statusCode;
        record.ResponseBody = responseBody;
        record.ResponseContentType = contentType;

        await db.SaveChangesAsync(cancellationToken);
    }
}
