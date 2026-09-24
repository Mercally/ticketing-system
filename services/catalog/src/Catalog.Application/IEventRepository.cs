using Catalog.Domain;

namespace Catalog.Application;

public interface IEventRepository
{
    Task<IReadOnlyList<Event>> GetAllAsync(CancellationToken cancellationToken);
    Task<Event?> GetByIdAsync(Guid id, CancellationToken cancellationToken);
}
