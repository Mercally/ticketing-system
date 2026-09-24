using System.Threading.RateLimiting;
using Gateway.Api;
using Microsoft.AspNetCore.RateLimiting;
using StackExchange.Redis;
using TicketingPlatform.Observability;
using Yarp.ReverseProxy.Configuration;

var builder = WebApplication.CreateBuilder(args);

builder.AddTicketingLogging("gateway");
builder.AddServiceDefaults();

builder.Services.Configure<WaitingRoomOptions>(builder.Configuration.GetSection(WaitingRoomOptions.SectionName));

// DECISIONS.md D11 — Redis here holds ONLY waiting-room/rate-limit counters, never seat/order/
// payment state. Connection is lazy/abortConnect:false so a not-yet-ready Redis at boot doesn't
// crash the gateway — WaitingRoomMiddleware fails open on connection errors regardless.
var redisHost = builder.Configuration["REDIS_HOST"] ?? "localhost";
var redisPort = builder.Configuration["REDIS_PORT"] ?? "6379";
builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    ConnectionMultiplexer.Connect(new ConfigurationOptions
    {
        EndPoints = { $"{redisHost}:{redisPort}" },
        AbortOnConnectFail = false,
        ConnectRetry = 3,
    }));

// Routing/waiting-room downstream addresses — same env var names infrastructure/k8s/base/gateway
// ConfigMap already sets (AUTH_SERVICE_URL etc), with localhost defaults matching
// docs/CONTRACTS.md §1's ports for plain local/Aspire dev.
string ServiceUrl(string envVar, int defaultPort) => builder.Configuration[envVar] ?? $"http://localhost:{defaultPort}";

var authServiceUrl = ServiceUrl("AUTH_SERVICE_URL", 5001);
var catalogServiceUrl = ServiceUrl("CATALOG_SERVICE_URL", 5002);
var ticketingServiceUrl = ServiceUrl("TICKETING_SERVICE_URL", 5003);
var ordersServiceUrl = ServiceUrl("ORDERS_SERVICE_URL", 5004);
var paymentsServiceUrl = ServiceUrl("PAYMENTS_SERVICE_URL", 5005);

var clusters = new[]
{
    BuildCluster("auth", authServiceUrl),
    BuildCluster("catalog", catalogServiceUrl),
    BuildCluster("ticketing", ticketingServiceUrl),
    BuildCluster("orders", ordersServiceUrl),
    BuildCluster("payments", paymentsServiceUrl),
};

var routes = new[]
{
    BuildRoute("auth", "/api/auth/{**catch-all}", "/api/auth"),
    BuildRoute("catalog", "/api/catalog/{**catch-all}", "/api/catalog"),
    BuildRoute("ticketing", "/api/ticketing/{**catch-all}", "/api/ticketing"),
    BuildRoute("orders", "/api/orders/{**catch-all}", "/api/orders"),
    BuildRoute("payments", "/api/payments/{**catch-all}", "/api/payments"),
};

builder.Services.AddReverseProxy().LoadFromMemory(routes, clusters);

var allowedOrigins = (builder.Configuration["ALLOWED_ORIGINS"] ?? "http://localhost:5173").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy => policy
        .WithOrigins(allowedOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});

// Rate limiting + load shedding (ADR-0008): a bounded per-client queue — once the queue is full,
// new requests get an immediate 503/Retry-After instead of piling up waiting for a slot that may
// never come, which protects the gateway process itself under a genuine spike.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status503ServiceUnavailable;
    options.OnRejected = async (context, cancellationToken) =>
    {
        context.HttpContext.Response.Headers.RetryAfter = "1";
        await context.HttpContext.Response.WriteAsJsonAsync(new { error = "RateLimited", message = "Too many requests — please retry shortly." }, cancellationToken);
    };

    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(httpContext =>
        RateLimitPartition.GetSlidingWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new SlidingWindowRateLimiterOptions
            {
                PermitLimit = 200,
                Window = TimeSpan.FromSeconds(10),
                SegmentsPerWindow = 5,
                QueueLimit = 20,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            }));
});

var app = builder.Build();

app.UseCorrelationId();
app.UseCors();
app.UseRateLimiter();
app.UseMiddleware<WaitingRoomMiddleware>();

app.MapDefaultEndpoints();
app.MapReverseProxy();

await app.RunAsync();

static ClusterConfig BuildCluster(string clusterId, string address) => new()
{
    ClusterId = clusterId,
    Destinations = new Dictionary<string, DestinationConfig>
    {
        ["destination1"] = new DestinationConfig { Address = address },
    },
};

static RouteConfig BuildRoute(string clusterId, string pathPattern, string stripPrefix) => new()
{
    RouteId = clusterId,
    ClusterId = clusterId,
    Match = new RouteMatch { Path = pathPattern },
    Transforms = new[] { new Dictionary<string, string> { ["PathRemovePrefix"] = stripPrefix } },
};
