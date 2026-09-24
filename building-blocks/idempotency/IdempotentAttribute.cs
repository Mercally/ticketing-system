using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Filters;

namespace TicketingPlatform.Idempotency;

/// <summary>
/// Apply to any controller action that must be safe against a client retrying the same POST
/// (ADR-0006). Requires an "Idempotency-Key" header (CONTRACTS.md §2). Resolves
/// <see cref="IIdempotencyStore"/> from DI — each service registers its own EF-backed
/// implementation (DECISIONS.md D10).
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class IdempotentAttribute : Attribute, IAsyncActionFilter
{
    public const string HeaderName = "Idempotency-Key";

    private static readonly TimeSpan RetentionWindow = TimeSpan.FromHours(24);

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var httpContext = context.HttpContext;
        var store = httpContext.RequestServices.GetService(typeof(IIdempotencyStore)) as IIdempotencyStore;
        if (store is null)
        {
            throw new InvalidOperationException($"{nameof(IIdempotencyStore)} is not registered in DI.");
        }

        if (!httpContext.Request.Headers.TryGetValue(HeaderName, out var keyValues) || string.IsNullOrWhiteSpace(keyValues.ToString()))
        {
            context.Result = new Microsoft.AspNetCore.Mvc.ObjectResult(new { error = "MissingIdempotencyKey", message = $"{HeaderName} header is required." })
            {
                StatusCode = 400,
            };
            return;
        }

        var key = keyValues.ToString();
        var endpoint = $"{httpContext.Request.Method} {httpContext.Request.Path}";
        var requestHash = await ComputeRequestHashAsync(httpContext);

        var existing = await store.FindAsync(endpoint, key, httpContext.RequestAborted);

        if (existing is null)
        {
            var inserted = await store.TryInsertPendingAsync(endpoint, key, requestHash, DateTime.UtcNow.Add(RetentionWindow), httpContext.RequestAborted);
            if (!inserted)
            {
                // Lost the race — someone else's request for the same fresh key landed first.
                existing = await store.FindAsync(endpoint, key, httpContext.RequestAborted);
            }
        }

        if (existing is not null)
        {
            if (existing.RequestHash != requestHash)
            {
                context.Result = new Microsoft.AspNetCore.Mvc.ObjectResult(new { error = "IdempotencyKeyReused", message = "This Idempotency-Key was already used with a different request body." })
                {
                    StatusCode = 409,
                };
                return;
            }

            if (existing.ResponseBody is null)
            {
                context.Result = new Microsoft.AspNetCore.Mvc.ObjectResult(new { error = "RequestInFlight", message = "The original request with this Idempotency-Key is still processing." })
                {
                    StatusCode = 409,
                };
                return;
            }

            httpContext.Response.ContentType = existing.ResponseContentType ?? "application/json";
            httpContext.Response.StatusCode = existing.StatusCode ?? 200;
            await httpContext.Response.WriteAsync(existing.ResponseBody, httpContext.RequestAborted);
            return;
        }

        var originalBody = httpContext.Response.Body;
        await using var captureStream = new MemoryStream();
        httpContext.Response.Body = captureStream;

        try
        {
            var executed = await next();

            captureStream.Seek(0, SeekOrigin.Begin);
            var responseBody = await new StreamReader(captureStream).ReadToEndAsync();
            captureStream.Seek(0, SeekOrigin.Begin);

            await captureStream.CopyToAsync(originalBody, httpContext.RequestAborted);
            httpContext.Response.Body = originalBody;

            if (executed.Exception is null && httpContext.Response.StatusCode is >= 200 and < 300)
            {
                await store.CompleteAsync(endpoint, key, httpContext.Response.StatusCode, responseBody, httpContext.Response.ContentType ?? "application/json", httpContext.RequestAborted);
            }
        }
        finally
        {
            httpContext.Response.Body = originalBody;
        }
    }

    private static async Task<string> ComputeRequestHashAsync(Microsoft.AspNetCore.Http.HttpContext httpContext)
    {
        httpContext.Request.EnableBuffering();
        httpContext.Request.Body.Position = 0;

        using var reader = new StreamReader(httpContext.Request.Body, Encoding.UTF8, leaveOpen: true);
        var body = await reader.ReadToEndAsync();
        httpContext.Request.Body.Position = 0;

        var hashBytes = SHA256.HashData(Encoding.UTF8.GetBytes(body));
        return Convert.ToHexString(hashBytes);
    }
}
