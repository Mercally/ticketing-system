using MassTransit;
using Microsoft.EntityFrameworkCore;
using Orders.Infrastructure.Saga;
using TicketingPlatform.Idempotency;

namespace Orders.Infrastructure;

public sealed class OrdersDbContext(DbContextOptions<OrdersDbContext> options) : DbContext(options)
{
    public DbSet<OrderSagaState> OrderSagas => Set<OrderSagaState>();
    public DbSet<IdempotencyKeyRecord> IdempotencyKeys => Set<IdempotencyKeyRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<OrderSagaState>(b =>
        {
            b.ToTable("order_sagas");
            b.HasKey(s => s.CorrelationId);
            b.Property(s => s.CurrentState).HasMaxLength(64).IsRequired();
            b.Property(s => s.Currency).HasMaxLength(10).IsRequired();
            b.Property(s => s.PaymentSimulationMode).HasMaxLength(50);
            b.Property(s => s.FailureReason).HasMaxLength(1000);
            // ISagaVersion optimistic concurrency — MassTransit's EF saga repository bumps this
            // on every save and uses it to detect concurrent modification of the same instance.
            b.Property(s => s.Version).IsConcurrencyToken();
        });

        modelBuilder.Entity<IdempotencyKeyRecord>(b =>
        {
            b.ToTable("idempotency_keys");
            b.HasKey(k => new { k.Endpoint, k.Key });
            b.Property(k => k.Endpoint).HasMaxLength(200);
            b.Property(k => k.Key).HasMaxLength(200);
            b.Property(k => k.RequestHash).HasMaxLength(64);
        });

        // MassTransit EF Core Outbox/Inbox tables (ADR-0005) — Orders both publishes
        // (OrderSubmitted from the API, then every saga-driven command/event) and consumes
        // (PaymentSucceeded/Failed, TicketConfirmed/Failed, ReservationReleased).
        modelBuilder.AddInboxStateEntity();
        modelBuilder.AddOutboxMessageEntity();
        modelBuilder.AddOutboxStateEntity();
    }
}
