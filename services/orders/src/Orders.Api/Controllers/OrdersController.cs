using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Orders.Application;
using TicketingPlatform.Auth;
using TicketingPlatform.Idempotency;

namespace Orders.Api.Controllers;

// Mounted at root — the Gateway strips "/api/orders" before proxying here (docs/CONTRACTS.md §6).
[ApiController]
[Route("")]
[Authorize]
public sealed class OrdersController(OrderSubmissionService submission, OrdersQueryService queries) : ControllerBase
{
    [HttpPost]
    [Idempotent]
    public async Task<ActionResult<CreateOrderResult>> Create([FromBody] CreateOrderRequest request, CancellationToken cancellationToken)
    {
        // [Authorize] alone only proves "some valid token" — without this, any logged-in buyer
        // could place an order in someone else's name just by putting their userId in the body.
        if (request.BuyerId != User.GetUserId())
        {
            return Forbid();
        }

        var result = await submission.SubmitAsync(request, cancellationToken);
        return Created($"/{result.OrderId}", result);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<OrderDto>> Get(Guid id, CancellationToken cancellationToken)
    {
        var order = await queries.GetByIdAsync(id, cancellationToken);
        // A 404 immediately after Create is possible and expected (ADR-0003 eventual consistency,
        // OrderSubmissionService's doc comment) — the saga row is created asynchronously.
        if (order is null)
        {
            return NotFound();
        }

        // 404 rather than 403 for someone else's order — orderId is an opaque random guid, so
        // treating a mismatch the same as "doesn't exist" avoids confirming that a given id is a
        // real order at all.
        if (order.BuyerId != User.GetUserId())
        {
            return NotFound();
        }

        return Ok(order);
    }
}
