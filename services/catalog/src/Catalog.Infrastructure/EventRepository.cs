using Catalog.Application;
using Catalog.Domain;
using Microsoft.EntityFrameworkCore;

namespace Catalog.Infrastructure;

public sealed class EventRepository(CatalogDbContext db) : IEventRepository
{
    public async Task<IReadOnlyList<Event>> GetAllAsync(CancellationToken cancellationToken)
        => await db.Events.AsNoTracking().ToListAsync(cancellationToken);

    public async Task<Event?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
        => await db.Events.AsNoTracking().FirstOrDefaultAsync(e => e.Id == id, cancellationToken);
}
