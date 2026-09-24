using Microsoft.Extensions.Options;
using StackExchange.Redis;

namespace Gateway.Api;

/// <summary>
/// Waiting Room / Admission Control (ADR-0008, ARCHITECTURE.md §9). Applies only to Ticketing's
/// hot routes (seat map + reserve — the ones that hit Postgres's hot seat rows). Redis is used
/// here strictly as a traffic-shaping counter shared across Gateway replicas — never seat/
/// reservation state (DECISIONS.md D11); a Redis outage fails OPEN (admits everyone) rather than
/// blocking all traffic, since the actual seat-exclusivity guarantee lives entirely in Ticketing's
/// Postgres CAS (ADR-0002) regardless of what got past this middleware.
/// </summary>
public sealed class WaitingRoomMiddleware(RequestDelegate next, IConnectionMultiplexer redis, IOptions<WaitingRoomOptions> options, ILogger<WaitingRoomMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? string.Empty;
        if (!path.StartsWith("/api/ticketing/", StringComparison.OrdinalIgnoreCase))
        {
            await next(context);
            return;
        }

        var bucket = ExtractEventIdBucket(path) ?? "ticketing-writes";
        var key = $"waitingroom:admitted:{bucket}";
        var opts = options.Value;

        long current;
        try
        {
            var db = redis.GetDatabase();
            current = await db.StringIncrementAsync(key);
            if (current == 1)
            {
                await db.KeyExpireAsync(key, TimeSpan.FromSeconds(opts.AdmissionWindowSeconds));
            }
        }
        catch (RedisConnectionException ex)
        {
            // Fail open — see class doc comment. Correctness never depends on this middleware.
            logger.LogWarning(ex, "Waiting room Redis unavailable; admitting request without admission control");
            await next(context);
            return;
        }

        if (current > opts.MaxConcurrentAdmissionsPerEvent)
        {
            try
            {
                await redis.GetDatabase().StringDecrementAsync(key);
            }
            catch (RedisConnectionException)
            {
                // Best-effort release; the key's own TTL (AdmissionWindowSeconds) bounds the damage either way.
            }

            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            context.Response.Headers.RetryAfter = "2";
            await context.Response.WriteAsJsonAsync(new
            {
                error = "HighDemand",
                message = "This event is experiencing high demand. Please retry shortly.",
            });
            return;
        }

        try
        {
            await next(context);
        }
        finally
        {
            try
            {
                await redis.GetDatabase().StringDecrementAsync(key);
            }
            catch (RedisConnectionException)
            {
                // Same as above — the key's TTL bounds any leaked counter.
            }
        }
    }

    private static string? ExtractEventIdBucket(string path)
    {
        // "/api/ticketing/events/{eventId}/seats" -> bucket per event; everything else
        // (e.g. POST /api/ticketing/reservations, whose eventId is in the JSON body, not the
        // path) shares the single "ticketing-writes" bucket rather than parsing the request body
        // here (buffering the body in middleware for this alone isn't worth the complexity).
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var eventsIndex = Array.IndexOf(segments, "events");
        return eventsIndex >= 0 && eventsIndex + 1 < segments.Length ? segments[eventsIndex + 1] : null;
    }
}
