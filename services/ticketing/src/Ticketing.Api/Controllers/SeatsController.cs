using Microsoft.AspNetCore.Mvc;
using Ticketing.Application;

namespace Ticketing.Api.Controllers;

[ApiController]
public sealed class SeatsController(SeatReservationService reservations) : ControllerBase
{
    [HttpGet("events/{eventId:guid}/seats")]
    public async Task<ActionResult<IReadOnlyList<SeatDto>>> ListByEvent(Guid eventId, CancellationToken cancellationToken)
        => Ok(await reservations.ListSeatsAsync(eventId, cancellationToken));
}
