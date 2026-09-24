using MassTransit;
using Microsoft.EntityFrameworkCore;
using Orders.Application;
using Orders.Infrastructure;
using Orders.Infrastructure.Saga;
using TicketingPlatform.Idempotency;
using TicketingPlatform.Messaging;
using TicketingPlatform.Observability;

var builder = WebApplication.CreateBuilder(args);

builder.AddTicketingLogging("orders");
builder.AddServiceDefaults();

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

builder.Services.AddControllers();
builder.Services.AddOpenApi();

var app = builder.Build();

app.UseCorrelationId();

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
