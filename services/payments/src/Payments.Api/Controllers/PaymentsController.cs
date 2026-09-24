using Microsoft.AspNetCore.Mvc;
using Payments.Application;

namespace Payments.Api.Controllers;

// Mounted at root — the Gateway strips "/api/payments" before proxying here (docs/CONTRACTS.md §1/§7).
[ApiController]
[Route("")]
public sealed class PaymentsController(PaymentsQueryService queries) : ControllerBase
{
    [HttpGet("{orderId:guid}")]
    public async Task<ActionResult<PaymentStatusDto>> Get(Guid orderId, CancellationToken cancellationToken)
    {
        var result = await queries.GetByOrderIdAsync(orderId, cancellationToken);
        return result is null ? NotFound() : Ok(result);
    }
}
