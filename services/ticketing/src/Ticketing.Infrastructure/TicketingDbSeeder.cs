using Microsoft.EntityFrameworkCore;
using Ticketing.Domain;

namespace Ticketing.Infrastructure;

/// <summary>
/// Same fixed demo event GUIDs as Catalog.Infrastructure.CatalogDbSeeder, duplicated by
/// convention rather than shared (DECISIONS.md D13) — Ticketing seeds its own seat inventory
/// independently, matching Catalog's 5x10 seat map layout for these two events.
/// </summary>
public static class TicketingDbSeeder
{
    private static readonly Guid DemoEvent1Id = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid DemoEvent2Id = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private const int Rows = 5;
    private const int Cols = 10;
    private static readonly string[] SectionNames = ["A", "B", "C", "D", "E"];

    public static async Task SeedAsync(TicketingDbContext db, CancellationToken cancellationToken = default)
    {
        await db.Database.MigrateAsync(cancellationToken);

        if (await db.Seats.AnyAsync(cancellationToken))
        {
            return;
        }

        foreach (var eventId in new[] { DemoEvent1Id, DemoEvent2Id })
        {
            for (var row = 1; row <= Rows; row++)
            {
                var section = SectionNames[row - 1];
                for (var col = 1; col <= Cols; col++)
                {
                    db.Seats.Add(new Seat(Guid.NewGuid(), eventId, label: $"{section}{col}", section: section, row: row));
                }
            }
        }

        await db.SaveChangesAsync(cancellationToken);
    }
}
