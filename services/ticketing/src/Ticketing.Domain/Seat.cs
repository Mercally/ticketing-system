namespace Ticketing.Domain;

/// <summary>
/// Ticketing is the sole authoritative owner of seat state (ADR-0001/0002). This entity is a
/// read/materialization shape; the actual state-transition guarantee comes from single atomic
/// conditional UPDATE statements (EF Core's ExecuteUpdateAsync) in
/// Ticketing.Infrastructure.SeatStore — never from loading this entity, mutating it, and calling
/// SaveChanges. See ADR-0002 for why.
/// </summary>
public sealed class Seat
{
    public Guid Id { get; private set; }
    public Guid EventId { get; private set; }
    public string Label { get; private set; } = default!;
    public string Section { get; private set; } = default!;
    public int Row { get; private set; }
    public SeatStatus Status { get; private set; }
    public Guid? ReservationId { get; private set; }
    public Guid? BuyerId { get; private set; }
    public DateTime? ReservedUntilUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    private Seat() { }

    public Seat(Guid id, Guid eventId, string label, string section, int row)
    {
        Id = id;
        EventId = eventId;
        Label = label;
        Section = section;
        Row = row;
        Status = SeatStatus.Available;
        UpdatedAtUtc = DateTime.UtcNow;
    }
}
