using System.Text.Json.Serialization;

namespace Ticketing.Domain;

/// <summary>Exactly these three values, exactly this casing, everywhere (docs/CONTRACTS.md §11).</summary>
[JsonConverter(typeof(SeatStatusJsonConverter))]
public enum SeatStatus
{
    Available,
    Reserved,
    Sold,
}
