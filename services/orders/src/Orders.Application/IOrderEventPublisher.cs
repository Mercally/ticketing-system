using Orders.Contracts.V1;

namespace Orders.Application;

/// <summary>Thin abstraction over IPublishEndpoint so Application doesn't take a direct MassTransit dependency (implemented in Infrastructure).</summary>
public interface IOrderEventPublisher
{
    Task PublishOrderSubmittedAsync(OrderSubmittedV1 message, CancellationToken cancellationToken);
}
