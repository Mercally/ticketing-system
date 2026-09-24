namespace Catalog.Domain;

/// <summary>
/// Catalog owns event/venue reference data only — never seat availability (that's Ticketing's,
/// ADR-0001/ARCHITECTURE.md §4). SeatMapRows/Cols is layout metadata so the frontend can render a
/// grid shape before seat-level status arrives from Ticketing.
/// </summary>
public sealed class Event
{
    public Guid Id { get; private set; }
    public string Name { get; private set; } = default!;
    public string Venue { get; private set; } = default!;
    public DateTime StartsAtUtc { get; private set; }
    public string Description { get; private set; } = default!;
    public string? ImageUrl { get; private set; }
    public int SeatMapRows { get; private set; }
    public int SeatMapCols { get; private set; }

    private Event() { }

    public Event(Guid id, string name, string venue, DateTime startsAtUtc, string description, string? imageUrl, int seatMapRows, int seatMapCols)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("Event name is required.", nameof(name));
        if (seatMapRows <= 0 || seatMapCols <= 0) throw new ArgumentException("Seat map must have at least one row and column.");

        Id = id;
        Name = name;
        Venue = venue;
        StartsAtUtc = startsAtUtc;
        Description = description;
        ImageUrl = imageUrl;
        SeatMapRows = seatMapRows;
        SeatMapCols = seatMapCols;
    }
}
