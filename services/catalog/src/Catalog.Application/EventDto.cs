namespace Catalog.Application;

public sealed record EventSummaryDto(Guid Id, string Name, string Venue, DateTime StartsAtUtc, string? ImageUrl);

public sealed record EventDetailDto(
    Guid Id,
    string Name,
    string Venue,
    DateTime StartsAtUtc,
    string Description,
    string? ImageUrl,
    int SeatMapRows,
    int SeatMapCols);
