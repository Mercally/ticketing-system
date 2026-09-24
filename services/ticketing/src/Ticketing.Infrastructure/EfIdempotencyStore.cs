using Microsoft.EntityFrameworkCore;
using TicketingPlatform.Idempotency;

namespace Ticketing.Infrastructure;

public sealed class EfIdempotencyStore(TicketingDbContext db) : IIdempotencyStore
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
        var affected = await db.IdempotencyKeys
            .Where(k => k.Endpoint == endpoint && k.Key == key)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(k => k.StatusCode, statusCode)
                .SetProperty(k => k.ResponseBody, responseBody)
                .SetProperty(k => k.ResponseContentType, contentType), cancellationToken);

        if (affected == 0)
        {
            throw new InvalidOperationException($"Idempotency key record not found for completion: {endpoint} {key}");
        }
    }
}
