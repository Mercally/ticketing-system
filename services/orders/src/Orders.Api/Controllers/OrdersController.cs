using Microsoft.AspNetCore.Mvc;
using Orders.Application;
using TicketingPlatform.Idempotency;

namespace Orders.Api.Controllers;

// Mounted at root — the Gateway strips "/api/orders" before proxying here (docs/CONTRACTS.md §6).
[ApiController]
[Route("")]
public sealed class OrdersController(OrderSubmissionService submission, OrdersQueryService queries) : ControllerBase
{
    [HttpPost]
    [Idempotent]
    public async Task<ActionResult<CreateOrderResult>> Create([FromBody] CreateOrderRequest request, CancellationToken cancellationToken)
    {
        var result = await submission.SubmitAsync(request, cancellationToken);
        return Created($"/{result.OrderId}", result);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<OrderDto>> Get(Guid id, CancellationToken cancellationToken)
    {
        var order = await queries.GetByIdAsync(id, cancellationToken);
        // A 404 immediately after Create is possible and expected (ADR-0003 eventual consistency,
        // OrderSubmissionService's doc comment) — the saga row is created asynchronously.
        return order is null ? NotFound() : Ok(order);
    }
}
