using Microsoft.AspNetCore.Mvc;
using Ticketing.Application;
using TicketingPlatform.Idempotency;

namespace Ticketing.Api.Controllers;

[ApiController]
[Route("reservations")]
public sealed class ReservationsController(SeatReservationService reservations) : ControllerBase
{
    public sealed record CreateReservationRequest(Guid EventId, Guid SeatId, Guid BuyerId);

    public sealed record ReservationResponse(Guid ReservationId, Guid SeatId, DateTime ExpiresAtUtc);

    [HttpPost]
    [Idempotent]
    public async Task<IActionResult> Reserve([FromBody] CreateReservationRequest request, CancellationToken cancellationToken)
    {
        var result = await reservations.ReserveAsync(new ReserveSeatRequest(request.EventId, request.SeatId, request.BuyerId), cancellationToken);

        if (!result.Success)
        {
            return Conflict(new { error = "SeatUnavailable" });
        }

        return Created($"/reservations/{result.ReservationId}", new ReservationResponse(result.ReservationId!.Value, request.SeatId, result.ExpiresAtUtc!.Value));
    }

    [HttpPost("{id:guid}/release")]
    public async Task<IActionResult> Release(Guid id, CancellationToken cancellationToken)
    {
        var released = await reservations.ReleaseByReservationAsync(id, cancellationToken);
        return released ? NoContent() : NotFound();
    }
}
