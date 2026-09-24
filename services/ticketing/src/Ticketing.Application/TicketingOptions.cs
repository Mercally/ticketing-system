namespace Ticketing.Application;

public sealed class TicketingOptions
{
    public const string SectionName = "Ticketing";

    public TimeSpan ReservationTtl { get; set; } = TimeSpan.FromMinutes(10);
}
