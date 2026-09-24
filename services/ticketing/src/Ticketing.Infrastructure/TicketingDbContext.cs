using MassTransit;
using Microsoft.EntityFrameworkCore;
using Ticketing.Domain;
using TicketingPlatform.Idempotency;

namespace Ticketing.Infrastructure;

public sealed class TicketingDbContext(DbContextOptions<TicketingDbContext> options) : DbContext(options)
{
    public DbSet<Seat> Seats => Set<Seat>();
    public DbSet<IdempotencyKeyRecord> IdempotencyKeys => Set<IdempotencyKeyRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Seat>(b =>
        {
            b.ToTable("seats");
            b.HasKey(s => s.Id);
            b.Property(s => s.Label).HasMaxLength(20).IsRequired();
            b.Property(s => s.Section).HasMaxLength(50).IsRequired();
            b.Property(s => s.Status).HasConversion<string>().HasMaxLength(20);
            // Last line of defense (ADR-0002) against ever inserting a duplicate seat row for the
            // same event — distinct from the CAS UPDATE mechanism, which governs transitions on a
            // row that already exists.
            b.HasIndex(s => new { s.EventId, s.Label }).IsUnique();
            b.HasIndex(s => s.EventId);
        });

        modelBuilder.Entity<IdempotencyKeyRecord>(b =>
        {
            b.ToTable("idempotency_keys");
            b.HasKey(k => new { k.Endpoint, k.Key });
            b.Property(k => k.Endpoint).HasMaxLength(200);
            b.Property(k => k.Key).HasMaxLength(200);
            b.Property(k => k.RequestHash).HasMaxLength(64);
        });

        // MassTransit EF Core Outbox/Inbox tables (ADR-0005) — Ticketing both consumes commands
        // (ConfirmSeat/ReleaseReservation) and publishes events as part of the same operation.
        modelBuilder.AddInboxStateEntity();
        modelBuilder.AddOutboxMessageEntity();
        modelBuilder.AddOutboxStateEntity();
    }
}
