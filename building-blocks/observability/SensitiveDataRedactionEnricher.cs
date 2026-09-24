using Serilog.Core;
using Serilog.Events;

namespace TicketingPlatform.Observability;

/// <summary>
/// Last-line-of-defense scrubber: never let passwords, JWTs, payment tokens, or PII-shaped
/// property names leave a log line, even if a call site accidentally includes them (prompt
/// requirement: "Nunca incluir passwords, JWTs, payment tokens o PII sensible en logs/spans").
/// This is a safety net, not a substitute for not logging them in the first place.
/// </summary>
public sealed class SensitiveDataRedactionEnricher : ILogEventEnricher
{
    private static readonly HashSet<string> SensitivePropertyNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "Password", "PasswordHash", "Token", "AccessToken", "RefreshToken", "Jwt", "Authorization",
        "CardNumber", "Cvv", "Cvc", "PaymentToken", "Secret", "ClientSecret", "ApiKey", "Ssn",
    };

    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        foreach (var name in logEvent.Properties.Keys.ToList())
        {
            if (SensitivePropertyNames.Contains(name))
            {
                logEvent.AddOrUpdateProperty(propertyFactory.CreateProperty(name, "[REDACTED]"));
            }
        }
    }
}
