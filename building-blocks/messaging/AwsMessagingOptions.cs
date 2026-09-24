namespace TicketingPlatform.Messaging;

/// <summary>
/// Bound from configuration section "Messaging:Aws" (env vars AWS__Region etc, or plain
/// AWS_REGION/AWS_ENDPOINT_URL/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, which Program.cs maps in).
/// ServiceUrl is set locally to point MassTransit's AWS transport at LocalStack (DECISIONS.md D4);
/// left null in AWS, where the SDK resolves the real regional endpoint.
/// </summary>
public sealed class AwsMessagingOptions
{
    public const string SectionName = "Messaging:Aws";

    public string Region { get; set; } = "us-east-1";
    public string? ServiceUrl { get; set; }
    public string AccessKey { get; set; } = "test";
    public string SecretKey { get; set; } = "test";
}
