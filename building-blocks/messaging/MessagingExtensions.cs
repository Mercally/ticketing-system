using MassTransit;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Amazon.SQS;
using Amazon.SimpleNotificationService;

namespace TicketingPlatform.Messaging;

/// <summary>
/// Shared MassTransit/AWS-transport conventions (ADR-0004): kebab-case endpoint naming (so a
/// message's CLR full name deterministically maps to the same SNS topic/SQS queue name whether
/// the producer or a hand-duplicated consumer copy compiled it — see docs/CONTRACTS.md §10),
/// short in-memory retry for transient faults, and CorrelationId propagation. Each service still
/// registers its own consumers/sagas via the <paramref name="configure"/> callback — this helper
/// owns only the cross-cutting transport wiring, never message types (DECISIONS.md D3).
/// </summary>
public static class MessagingExtensions
{
    public static IServiceCollection AddTicketingMessaging(
        this IServiceCollection services,
        IConfiguration configuration,
        Action<IBusRegistrationConfigurator> configure)
    {
        var aws = configuration.GetSection(AwsMessagingOptions.SectionName).Get<AwsMessagingOptions>() ?? new AwsMessagingOptions();

        services.AddMassTransit(x =>
        {
            x.SetKebabCaseEndpointNameFormatter();

            configure(x);

            x.UsingAmazonSqs((context, cfg) =>
            {
                cfg.Host(aws.Region, h =>
                {
                    h.AccessKey(aws.AccessKey);
                    h.SecretKey(aws.SecretKey);

                    if (!string.IsNullOrWhiteSpace(aws.ServiceUrl))
                    {
                        h.Config(new AmazonSQSConfig { ServiceURL = aws.ServiceUrl });
                        h.Config(new AmazonSimpleNotificationServiceConfig { ServiceURL = aws.ServiceUrl });
                    }
                });

                // Short in-memory retry for transient faults (e.g. a momentary DB blip), then the
                // message goes back to SQS for redelivery; MassTransit's AmazonSQS transport moves
                // messages that keep faulting to an auto-provisioned "<queue>_error" queue — the DLQ.
                cfg.UseMessageRetry(r => r.Intervals(
                    TimeSpan.FromMilliseconds(200),
                    TimeSpan.FromMilliseconds(500),
                    TimeSpan.FromSeconds(1),
                    TimeSpan.FromSeconds(3)));

                cfg.UseSendFilter(typeof(CorrelationIdSendFilter<>), context);
                cfg.UsePublishFilter(typeof(CorrelationIdPublishFilter<>), context);
                cfg.UseConsumeFilter(typeof(CorrelationIdConsumeFilter<>), context);

                // Services with an EF Core Outbox (ADR-0005) call x.AddEntityFrameworkOutbox<TDbContext>()
                // in their `configure` callback above — MassTransit auto-applies inbox-based idempotent
                // consumption to every endpoint ConfigureEndpoints sets up below, no per-endpoint wiring needed.
                cfg.ConfigureEndpoints(context);
            });
        });

        return services;
    }
}
