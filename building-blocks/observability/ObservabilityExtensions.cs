using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Serilog;

namespace TicketingPlatform.Observability;

public static class ObservabilityExtensions
{
    /// <summary>
    /// Serilog as the logging pipeline (prompt requirement), layered on top of Aspire's
    /// ServiceDefaults OpenTelemetry wiring (traces/metrics) rather than replacing it — Serilog
    /// exports to the same OTLP endpoint so logs, traces, and metrics land in the one Aspire
    /// dashboard timeline. Call this BEFORE builder.AddServiceDefaults() in Program.cs.
    /// </summary>
    public static IHostApplicationBuilder AddTicketingLogging(this IHostApplicationBuilder builder, string serviceName)
    {
        var otlpEndpoint = builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"];

        builder.Services.AddSerilog((services, config) =>
        {
            config
                .Enrich.FromLogContext()
                .Enrich.WithMachineName()
                .Enrich.WithProperty("Service", serviceName)
                .Enrich.With<SensitiveDataRedactionEnricher>()
                .MinimumLevel.Information()
                .WriteTo.Console();

            if (!string.IsNullOrWhiteSpace(otlpEndpoint))
            {
                config.WriteTo.OpenTelemetry(options =>
                {
                    options.Endpoint = otlpEndpoint;
                    options.ResourceAttributes = new Dictionary<string, object> { ["service.name"] = serviceName };
                });
            }
        });

        return builder;
    }
}
