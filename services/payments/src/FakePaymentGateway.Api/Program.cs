// Stateless simulator (docs/CONTRACTS.md §8) — deliberately minimal API, no Clean Architecture
// layering, per the task's own framing ("no layering needed"). Still wired into Aspire/OTel
// (AddServiceDefaults) because DECISIONS.md D2's whole point is that this is a REAL network
// participant, not an in-process fake — it should show up in observability like any other service.

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

// Used for the fire-and-forget DuplicateCallback webhook POSTs below — a plain client, not the
// named/resilient one Payments.Api configures for the reverse direction, since this simulator
// firing a best-effort notification at Payments isn't a correctness-critical call.
builder.Services.AddHttpClient();

var app = builder.Build();

app.MapDefaultEndpoints();

// docs/CONTRACTS.md §7/§8: these numbers must stay consistent with Payments.Api's configured
// resilience timeout (FakePaymentGateway:TimeoutSeconds there, default 5s — see its Program.cs).
// DelayedResponse (3s) sits comfortably UNDER that timeout ("slow but fine" — must still succeed).
// Timeout mode (30s) sits comfortably OVER it ("genuinely too slow" — the caller must time out for
// real, not fail fast).
var timeoutModeDelaySeconds = app.Configuration.GetValue("FakePaymentGateway:TimeoutModeDelaySeconds", 30);
var delayedResponseDelaySeconds = app.Configuration.GetValue("FakePaymentGateway:DelayedResponseDelaySeconds", 3);
var webhookUrl = app.Configuration["PaymentService:WebhookUrl"] ?? "http://localhost:5005/webhook";

app.MapPost("/authorize", async (AuthorizeRequest request, IHttpClientFactory httpClientFactory, ILogger<Program> logger, CancellationToken ct) =>
{
    var mode = request.SimulationMode ?? "Success";

    switch (mode)
    {
        case "Decline":
            return Results.Json(new { approved = false, reason = "Card declined by issuer" }, statusCode: StatusCodes.Status402PaymentRequired);

        case "Timeout":
            // Sleeps LONGER than the caller's configured HTTP timeout, then responds anyway — the
            // caller must genuinely experience a timeout (its own resilience pipeline gives up and
            // moves on), not see a fast failure that doesn't actually exercise anything.
            await Task.Delay(TimeSpan.FromSeconds(timeoutModeDelaySeconds), ct);
            return Results.Ok(new { approved = true, authCode = GenerateAuthCode() });

        case "DelayedResponse":
            // Shorter than the caller's timeout — exercises "slow but fine" without tripping it.
            await Task.Delay(TimeSpan.FromSeconds(delayedResponseDelaySeconds), ct);
            return Results.Ok(new { approved = true, authCode = GenerateAuthCode() });

        case "DuplicateCallback":
            {
                var authCode = GenerateAuthCode();
                var callbackId = Guid.NewGuid().ToString();

                // Fire-and-forget, intentionally not awaited before returning: two webhook POSTs
                // with the SAME callbackId, exercising Payment Service's webhook idempotency
                // (docs/CONTRACTS.md §8). Not awaited sequentially so neither delays this response.
                _ = FireWebhookAsync(httpClientFactory, webhookUrl, request.OrderId, callbackId, authCode, logger);
                _ = FireWebhookAsync(httpClientFactory, webhookUrl, request.OrderId, callbackId, authCode, logger);

                return Results.Ok(new { approved = true, authCode });
            }

        case "Success":
        default:
            return Results.Ok(new { approved = true, authCode = GenerateAuthCode() });
    }
});

app.MapPost("/refund", (RefundRequest request) => Results.Ok(new { refunded = true }));

await app.RunAsync();

static string GenerateAuthCode() => $"AUTH-{Guid.NewGuid():N}"[..16].ToUpperInvariant();

static async Task FireWebhookAsync(IHttpClientFactory httpClientFactory, string webhookUrl, Guid orderId, string callbackId, string authCode, ILogger logger)
{
    try
    {
        using var client = httpClientFactory.CreateClient();
        await client.PostAsJsonAsync(webhookUrl, new { orderId, callbackId, approved = true, authCode });
    }
    catch (Exception ex)
    {
        // Best-effort notification — the /authorize response has already gone out synchronously
        // with the same outcome, so a failed webhook delivery here isn't a correctness problem for
        // this simulator, just a missed opportunity to exercise the duplicate-callback path.
        logger.LogWarning(ex, "DuplicateCallback webhook POST to {WebhookUrl} failed for order {OrderId}", webhookUrl, orderId);
    }
}

internal sealed record AuthorizeRequest(Guid OrderId, decimal Amount, string Currency, string? SimulationMode);

internal sealed record RefundRequest(Guid OrderId, string AuthCode);
