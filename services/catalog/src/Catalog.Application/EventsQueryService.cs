namespace Catalog.Application;

public sealed class EventsQueryService(IEventRepository repository)
{
    public async Task<IReadOnlyList<EventSummaryDto>> ListAsync(CancellationToken cancellationToken)
    {
        var events = await repository.GetAllAsync(cancellationToken);
        return events
            .OrderBy(e => e.StartsAtUtc)
            .Select(e => new EventSummaryDto(e.Id, e.Name, e.Venue, e.StartsAtUtc, e.ImageUrl))
            .ToList();
    }

    public async Task<EventDetailDto?> GetAsync(Guid id, CancellationToken cancellationToken)
    {
        var e = await repository.GetByIdAsync(id, cancellationToken);
        return e is null
            ? null
            : new EventDetailDto(e.Id, e.Name, e.Venue, e.StartsAtUtc, e.Description, e.ImageUrl, e.SeatMapRows, e.SeatMapCols);
    }
}
