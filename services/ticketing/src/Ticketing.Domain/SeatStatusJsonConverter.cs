using System.Text.Json;
using System.Text.Json.Serialization;

namespace Ticketing.Domain;

/// <summary>Serializes SeatStatus exactly as "AVAILABLE" | "RESERVED" | "SOLD" (docs/CONTRACTS.md §11) — not PascalCase.</summary>
public sealed class SeatStatusJsonConverter : JsonConverter<SeatStatus>
{
    public override SeatStatus Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        => reader.GetString() switch
        {
            "AVAILABLE" => SeatStatus.Available,
            "RESERVED" => SeatStatus.Reserved,
            "SOLD" => SeatStatus.Sold,
            var other => throw new JsonException($"Unknown seat status '{other}'."),
        };

    public override void Write(Utf8JsonWriter writer, SeatStatus value, JsonSerializerOptions options)
        => writer.WriteStringValue(value switch
        {
            SeatStatus.Available => "AVAILABLE",
            SeatStatus.Reserved => "RESERVED",
            SeatStatus.Sold => "SOLD",
            _ => throw new ArgumentOutOfRangeException(nameof(value)),
        });
}
