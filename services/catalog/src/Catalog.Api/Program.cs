using Catalog.Application;
using Catalog.Infrastructure;
using TicketingPlatform.Observability;

var builder = WebApplication.CreateBuilder(args);

builder.AddTicketingLogging("catalog");
builder.AddServiceDefaults();

builder.AddNpgsqlDbContext<CatalogDbContext>("catalogdb");

builder.Services.AddScoped<IEventRepository, EventRepository>();
builder.Services.AddScoped<EventsQueryService>();

builder.Services.AddControllers();
builder.Services.AddOpenApi();

var app = builder.Build();

app.UseCorrelationId();

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
