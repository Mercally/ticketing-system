using MassTransit;
using Ticketing.Application;
using Ticketing.Infrastructure;
using TicketingPlatform.Auth;
using TicketingPlatform.Idempotency;
using TicketingPlatform.Messaging;
using TicketingPlatform.Observability;

var builder = WebApplication.CreateBuilder(args);

builder.AddTicketingLogging("ticketing");
builder.AddServiceDefaults();
builder.AddJwtAuthentication();

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
    var db = scope.ServiceProvider.GetRequiredService<TicketingDbContext>();
    await TicketingDbSeeder.SeedAsync(db);
}

app.MapDefaultEndpoints();
app.MapControllers();
app.MapHub<SeatAvailabilityHub>("/hubs/seat-availability");

await app.RunAsync();
