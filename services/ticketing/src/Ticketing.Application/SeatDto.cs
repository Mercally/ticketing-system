using Ticketing.Domain;

namespace Ticketing.Application;

public sealed record SeatDto(Guid Id, string Label, string Section, int Row, SeatStatus Status);

public sealed record ReserveSeatRequest(Guid EventId, Guid SeatId, Guid BuyerId);

public sealed record ReserveSeatResult(bool Success, Guid? ReservationId, DateTime? ExpiresAtUtc);
