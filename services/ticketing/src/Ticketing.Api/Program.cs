using MassTransit;
using Ticketing.Application;
using Ticketing.Infrastructure;
using TicketingPlatform.Idempotency;
using TicketingPlatform.Messaging;
using TicketingPlatform.Observability;

var builder = WebApplication.CreateBuilder(args);

builder.AddTicketingLogging("ticketing");
builder.AddServiceDefaults();

builder.AddNpgsqlDbContext<TicketingDbContext>("ticketingdb");

builder.Services.Configure<TicketingOptions>(builder.Configuration.GetSection(TicketingOptions.SectionName));
builder.Services.AddScoped<ISeatStore, SeatStore>();
builder.Services.AddScoped<ISeatAvailabilityNotifier, SignalRSeatAvailabilityNotifier>();
builder.Services.AddScoped<IIdempotencyStore, EfIdempotencyStore>();
builder.Services.AddScoped<SeatReservationService>();
builder.Services.AddHostedService<ExpiredReservationSweepService>();

builder.Services.AddSignalR();

builder.Services.AddTicketingMessaging(
    builder.Configuration,
    x =>
    {
        x.AddEntityFrameworkOutbox<TicketingDbContext>(o =>
        {
            o.UsePostgres();
            o.UseBusOutbox();
        });

        x.AddConsumer<ConfirmSeatConsumer>();
        x.AddConsumer<ReleaseReservationConsumer>();
    });

builder.Services.AddControllers();
builder.Services.AddOpenApi();

var app = builder.Build();

app.UseCorrelationId();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();

    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<TicketingDbContext>();
    await TicketingDbSeeder.SeedAsync(db);
}

app.MapDefaultEndpoints();
app.MapControllers();
app.MapHub<SeatAvailabilityHub>("/hubs/seat-availability");

await app.RunAsync();
