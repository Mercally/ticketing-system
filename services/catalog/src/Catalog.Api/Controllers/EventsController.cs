using Catalog.Application;
using Microsoft.AspNetCore.Mvc;

namespace Catalog.Api.Controllers;

// Mounted at root by design — the Gateway strips the "/api/catalog" prefix before proxying
// here, so from the buyer's perspective this is GET /api/catalog/events (docs/CONTRACTS.md §4).
[ApiController]
[Route("events")]
public sealed class EventsController(EventsQueryService events) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<EventSummaryDto>>> List(CancellationToken cancellationToken)
        => Ok(await events.ListAsync(cancellationToken));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<EventDetailDto>> Get(Guid id, CancellationToken cancellationToken)
    {
        var detail = await events.GetAsync(id, cancellationToken);
        return detail is null ? NotFound() : Ok(detail);
    }
}
