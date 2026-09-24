using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Serilog.Context;

namespace TicketingPlatform.Observability;

/// <summary>
/// Reads X-Correlation-Id (CONTRACTS.md §2), or mints one, pushes it into CorrelationContext + the
/// Serilog log scope + the current Activity, and echoes it back on the response.
/// </summary>
public sealed class CorrelationIdMiddleware(RequestDelegate next)
{
    public const string HeaderName = "X-Correlation-Id";

    public async Task InvokeAsync(HttpContext context)
    {
        var correlationId = context.Request.Headers.TryGetValue(HeaderName, out var values) && !string.IsNullOrWhiteSpace(values.ToString())
            ? values.ToString()
            : Guid.NewGuid().ToString();

        CorrelationContext.CorrelationId = correlationId;
        System.Diagnostics.Activity.Current?.SetTag("correlation_id", correlationId);
        context.Response.Headers[HeaderName] = correlationId;

        using (LogContext.PushProperty("CorrelationId", correlationId))
        {
            await next(context);
        }
    }
}

public static class CorrelationIdMiddlewareExtensions
{
    public static IApplicationBuilder UseCorrelationId(this IApplicationBuilder app)
        => app.UseMiddleware<CorrelationIdMiddleware>();
}
