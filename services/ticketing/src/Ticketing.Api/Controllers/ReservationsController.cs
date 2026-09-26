using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Ticketing.Application;
using TicketingPlatform.Auth;
using TicketingPlatform.Idempotency;

namespace Ticketing.Api.Controllers;

[ApiController]
[Route("reservations")]
[Authorize]
public sealed class ReservationsController(SeatReservationService reservations) : ControllerBase
{
    public sealed record CreateReservationRequest(Guid EventId, Guid SeatId, Guid BuyerId);

    public sealed record ReservationResponse(Guid ReservationId, Guid SeatId, DateTime ExpiresAtUtc);

    [HttpPost]
    [Idempotent]
    public async Task<IActionResult> Reserve([FromBody] CreateReservationRequest request, CancellationToken cancellationToken)
    {
        // [Authorize] alone only proves "some valid token" — without this, any logged-in buyer
        // could reserve a seat in someone else's name just by putting their userId in the body.
        if (request.BuyerId != User.GetUserId())
        {
            return Forbid();
        }

        var result = await reservations.ReserveAsync(new ReserveSeatRequest(request.EventId, request.SeatId, request.BuyerId), cancellationToken);

        if (!result.Success)
        {
            return Conflict(new { error = "SeatUnavailable" });
        }

        return Created($"/reservations/{result.ReservationId}", new ReservationResponse(result.ReservationId!.Value, request.SeatId, result.ExpiresAtUtc!.Value));
    }

    // NOTE: this only requires *a* valid token, not that the caller owns this specific
    // reservation — ReleaseByReservationAsync takes no buyerId to check against. Closing that
    // needs the service/domain layer to know who holds a reservation, which is a bigger change
    // than adding authentication; flagged here rather than silently left unmentioned.
    [HttpPost("{id:guid}/release")]
    public async Task<IActionResult> Release(Guid id, CancellationToken cancellationToken)
    {
        var released = await reservations.ReleaseByReservationAsync(id, cancellationToken);
        return released ? NoContent() : NotFound();
    }
}
