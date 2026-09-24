using MassTransit;
using Microsoft.EntityFrameworkCore;
using Payments.Domain;
using TicketingPlatform.Idempotency;

namespace Payments.Infrastructure;

public sealed class PaymentsDbContext(DbContextOptions<PaymentsDbContext> options) : DbContext(options)
{
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<IdempotencyKeyRecord> IdempotencyKeys => Set<IdempotencyKeyRecord>();
    public DbSet<WebhookCallbackRecord> WebhookCallbacks => Set<WebhookCallbackRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Payment>(b =>
        {
            b.ToTable("payments");
            b.HasKey(p => p.Id);
            b.Property(p => p.Currency).HasMaxLength(10).IsRequired();
            b.Property(p => p.Status).HasConversion<string>().HasMaxLength(20);
            b.Property(p => p.AuthCode).HasMaxLength(100);
            b.Property(p => p.FailureReason).HasMaxLength(1000);
            // Last line of defense (ADR-0006, docs/CONTRACTS.md §7): a payment is 1:1 with an order
            // by construction — this UNIQUE index is what actually prevents a double-charge if the
            // application-level idempotency check (PaymentProcessingService.ProcessAsync reading by
            // OrderId before calling the gateway) ever loses a concurrency race.
            b.HasIndex(p => p.OrderId).IsUnique();
        });

        modelBuilder.Entity<IdempotencyKeyRecord>(b =>
        {
            b.ToTable("idempotency_keys");
            b.HasKey(k => new { k.Endpoint, k.Key });
            b.Property(k => k.Endpoint).HasMaxLength(200);
            b.Property(k => k.Key).HasMaxLength(200);
            b.Property(k => k.RequestHash).HasMaxLength(64);
        });

        modelBuilder.Entity<WebhookCallbackRecord>(b =>
        {
            b.ToTable("webhook_callbacks");
            // (OrderId, CallbackId) is the whole dedupe key (docs/CONTRACTS.md §7/§8) — distinct
            // from the idempotency_keys table above, which is the client-Idempotency-Key mechanism.
            b.HasKey(w => new { w.OrderId, w.CallbackId });
            b.Property(w => w.CallbackId).HasMaxLength(200);
        });

        // MassTransit EF Core Outbox/Inbox tables (ADR-0005) — Payments both consumes commands
        // (ProcessPayment/RefundPayment) and publishes events as part of the same operation.
        modelBuilder.AddInboxStateEntity();
        modelBuilder.AddOutboxMessageEntity();
        modelBuilder.AddOutboxStateEntity();
    }
}
