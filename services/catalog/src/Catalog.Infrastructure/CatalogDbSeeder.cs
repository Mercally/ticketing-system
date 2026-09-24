using Catalog.Domain;
using Microsoft.EntityFrameworkCore;

namespace Catalog.Infrastructure;

/// <summary>
/// Demo event ids are fixed GUIDs, duplicated (not shared via project reference) in Ticketing's
/// own seeder so the vertical slice has matching data across the two independently-owned
/// databases without either service calling the other at seed time (DECISIONS.md D13).
/// </summary>
public static class CatalogDbSeeder
{
    public static readonly Guid DemoEvent1Id = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid DemoEvent2Id = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public static async Task SeedAsync(CatalogDbContext db, CancellationToken cancellationToken = default)
    {
        await db.Database.MigrateAsync(cancellationToken);

        if (await db.Events.AnyAsync(cancellationToken))
        {
            return;
        }

        db.Events.AddRange(
            new Event(
                DemoEvent1Id,
                "Arctic Skyline World Tour",
                "Riverside Arena",
                DateTime.UtcNow.AddDays(30),
                "The Arctic Skyline world tour makes its only stop at Riverside Arena this year.",
                null,
                seatMapRows: 5,
                seatMapCols: 10),
            new Event(
                DemoEvent2Id,
                "Global Philharmonic Gala",
                "City Concert Hall",
                DateTime.UtcNow.AddDays(45),
                "A one-night gala performance from the Global Philharmonic Orchestra.",
                null,
                seatMapRows: 5,
                seatMapCols: 10));

        await db.SaveChangesAsync(cancellationToken);
    }
}
