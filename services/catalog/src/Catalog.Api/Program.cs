using Catalog.Application;
using Catalog.Infrastructure;
using TicketingPlatform.Observability;

var builder = WebApplication.CreateBuilder(args);

builder.AddTicketingLogging("catalog");
builder.AddServiceDefaults();

builder.AddNpgsqlDbContext<CatalogDbContext>("catalogdb");

builder.Services.AddScoped<IEventRepository, EventRepository>();
builder.Services.AddScoped<EventsQueryService>();

// Needed as of DECISIONS.md D17 (k8s: API Gateway calls this service directly, no YARP hop in
// front doing CORS anymore — HTTP_PROXY integrations can't inject headers on the real response,
// only Terraform's MOCK-integration OPTIONS preflight can). Same ALLOWED_ORIGINS convention as
// services/gateway's Program.cs. Harmless in Aspire dev, where YARP still fronts this service and
// already handles CORS — the browser never talks to Catalog directly there.
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
    var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
    await CatalogDbSeeder.SeedAsync(db);
}

app.MapDefaultEndpoints();
app.MapControllers();

app.Run();
