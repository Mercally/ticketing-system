using MassTransit;
using Orders.Application;
using Orders.Contracts.V1;

namespace Orders.Infrastructure;

public sealed class OrderEventPublisher(IPublishEndpoint publishEndpoint) : IOrderEventPublisher
{
    public Task PublishOrderSubmittedAsync(OrderSubmittedV1 message, CancellationToken cancellationToken)
        => publishEndpoint.Publish(message, cancellationToken);
}
