using MassTransit;
using Microsoft.EntityFrameworkCore;
using Orders.Application;
using Orders.Infrastructure;
using Orders.Infrastructure.Saga;
using TicketingPlatform.Auth;
using TicketingPlatform.Idempotency;
using TicketingPlatform.Messaging;
using TicketingPlatform.Observability;

var builder = WebApplication.CreateBuilder(args);

builder.AddTicketingLogging("orders");
builder.AddServiceDefaults();
builder.AddJwtAuthentication();

builder.AddNpgsqlDbContext<OrdersDbContext>("ordersdb");

builder.Services.AddScoped<IOrderReadStore, OrderReadStore>();
builder.Services.AddScoped<IOrderEventPublisher, OrderEventPublisher>();
builder.Services.AddScoped<IIdempotencyStore, EfIdempotencyStore>();
builder.Services.AddScoped<OrdersQueryService>();
builder.Services.AddScoped<OrderSubmissionService>();

builder.Services.AddTicketingMessaging(
    builder.Configuration,
    x =>
    {
        x.AddEntityFrameworkOutbox<OrdersDbContext>(o =>
        {
            o.UsePostgres();
            o.UseBusOutbox();
        });

        x.AddSagaStateMachine<OrderStateMachine, OrderSagaState>()
            .EntityFrameworkRepository(r =>
            {
                r.ExistingDbContext<OrdersDbContext>();
                r.UsePostgres();
            });
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
app.UseAuthentication();
app.UseAuthorization();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();

    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<OrdersDbContext>();
    await db.Database.MigrateAsync();
}

app.MapDefaultEndpoints();
app.MapControllers();

await app.RunAsync();
