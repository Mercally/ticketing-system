using MassTransit;
using Microsoft.EntityFrameworkCore;
using Payments.Application;
using Payments.Infrastructure;
using Polly;
using Polly.CircuitBreaker;
using Polly.Retry;
using Polly.Timeout;
using TicketingPlatform.Idempotency;
using TicketingPlatform.Messaging;
using TicketingPlatform.Observability;

var builder = WebApplication.CreateBuilder(args);

builder.AddTicketingLogging("payments");
builder.AddServiceDefaults();

builder.AddNpgsqlDbContext<PaymentsDbContext>("paymentsdb");

builder.Services.AddScoped<IIdempotencyStore, EfIdempotencyStore>();
builder.Services.AddScoped<IPaymentStore, EfPaymentStore>();
builder.Services.AddScoped<IWebhookCallbackStore, EfWebhookCallbackStore>();
builder.Services.AddScoped<PaymentProcessingService>();
builder.Services.AddScoped<PaymentWebhookService>();
builder.Services.AddScoped<PaymentsQueryService>();

// docs/CONTRACTS.md §7/§8: these three numbers are chosen to be mutually consistent across the two
// processes. FakePaymentGateway.Api's DelayedResponse mode sleeps 3s (comfortably under this
// timeout — "slow but fine"); its Timeout mode sleeps 30s (comfortably over it — a genuine timeout).
// If either service changes its number, the other must change to match.
var gatewayBaseUrl = builder.Configuration["FakePaymentGateway:BaseUrl"] ?? "http://localhost:5006";
var gatewayTimeout = TimeSpan.FromSeconds(builder.Configuration.GetValue("FakePaymentGateway:TimeoutSeconds", 5));

// RemoveAllResilienceHandlers (below) is marked [Experimental] by the package itself — not a sign
// of instability in what it does (removing handlers already registered on this builder), just that
// its exact API shape may still change in a future release; knowingly opted into here. The pragma
// has to bracket the whole statement, not just that one call, because the analyzer attributes the
// diagnostic to the statement's start.
#pragma warning disable EXTEXP0001
builder.Services.AddHttpClient<IPaymentGateway, HttpPaymentGatewayClient>(HttpPaymentGatewayClient.HttpClientName, client =>
    {
        client.BaseAddress = new Uri(gatewayBaseUrl);
    })
    // AddServiceDefaults() above already put Microsoft.Extensions.Http.Resilience's
    // AddStandardResilienceHandler() on every named/typed HttpClient by default
    // (ConfigureHttpClientDefaults). Strip it here so this client gets EXACTLY the pipeline below —
    // in this order, and nothing else — rather than the standard handler layered underneath it.
    .RemoveAllResilienceHandlers()
    .AddResilienceHandler("payment-gateway-pipeline", pipeline =>
    {
        // Order is spec'd exactly (docs/CONTRACTS.md §7): timeout -> retry -> circuit breaker,
        // outermost to innermost.

        // 1) Timeout (outermost) — bounds the ENTIRE call, including any retries, to gatewayTimeout
        // (5s). Because this wraps the retry strategy below, a call that's simply slow past this
        // bound is aborted as a whole with a TimeoutRejectedException — the retry strategy never
        // gets a chance to see or act on that exception (it's thrown by the strategy wrapping it,
        // not one it wraps), which is exactly what we want: see the retry comment below.
        pipeline.AddTimeout(gatewayTimeout);

        // 2) Retry — capped at 2 attempts (3 total), and deliberately narrow about WHAT it retries.
        // This is a correctness decision, not a style choice: "No aplicar retries indiscriminadamente
        // sobre operaciones no idempotentes" (the governing prompt) applies directly to
        // POST /authorize, which is NOT safe to blindly retry. If a call fails with an
        // HttpRequestException (DNS failure, connection refused/reset, TLS handshake failure — i.e.
        // it failed BEFORE any response was received), we know for certain the gateway never saw the
        // request, so a retry is safe. But if the call times out (TimeoutRejectedException from the
        // outer strategy above) or the gateway returns any response at all — even a slow one, even a
        // 5xx — we have NO way to know whether it was actually processed, so retrying would risk a
        // second, independent authorize attempt against a request that may have already gone
        // through (this fake gateway has no idempotency key of its own on /authorize; a real
        // processor integration would pass one so IT can dedupe — out of scope for this PoC).
        // ShouldHandle is therefore restricted to exactly HttpRequestException and nothing else.
        pipeline.AddRetry(new RetryStrategyOptions<HttpResponseMessage>
        {
            MaxRetryAttempts = 2,
            BackoffType = DelayBackoffType.Exponential,
            Delay = TimeSpan.FromMilliseconds(200),
            ShouldHandle = args => ValueTask.FromResult(args.Outcome.Exception is HttpRequestException),
        });

        // 3) Circuit breaker (innermost, closest to the transport) — protects a genuinely-down
        // gateway from continuing to be hammered once failures cluster. Broader than the retry
        // predicate on purpose: it should trip on any real failure signal (connection failure or an
        // attempt that ran out the outer timeout), not just the narrow retry-safe subset.
        pipeline.AddCircuitBreaker(new CircuitBreakerStrategyOptions<HttpResponseMessage>
        {
            FailureRatio = 0.5,
            SamplingDuration = TimeSpan.FromSeconds(10),
            MinimumThroughput = 4,
            BreakDuration = TimeSpan.FromSeconds(15),
            ShouldHandle = args => ValueTask.FromResult(args.Outcome.Exception is HttpRequestException or TimeoutRejectedException),
        });
    });
#pragma warning restore EXTEXP0001

builder.Services.AddTicketingMessaging(
    builder.Configuration,
    x =>
    {
        x.AddEntityFrameworkOutbox<PaymentsDbContext>(o =>
        {
            o.UsePostgres();
            o.UseBusOutbox();
        });

        x.AddConsumer<ProcessPaymentConsumer>();
        x.AddConsumer<RefundPaymentConsumer>();
    });

// Needed as of DECISIONS.md D17 (k8s: API Gateway calls this service directly — see
// catalog/Program.cs for the full reasoning, identical here). Harmless in Aspire dev.
var allowedOrigins = (builder.Configuration["ALLOWED_ORIGINS"] ?? "http://localhost:5173").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy => policy
        .WithOrigins(allowedOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod());
});

builder.Services.AddControllers();
builder.Services.AddOpenApi();

var app = builder.Build();

app.UseCorrelationId();
app.UseCors();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();

    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<PaymentsDbContext>();
    await db.Database.MigrateAsync();
}

app.MapDefaultEndpoints();
app.MapControllers();

await app.RunAsync();
