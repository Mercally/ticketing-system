using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Ticketing.Application;

namespace Ticketing.Infrastructure;

/// <summary>
/// Hygiene sweep only (ADR-0002) — reclaims expired reservations so seat-map reads/SignalR reflect
/// expiry promptly even with no new reservation attempt on that seat. Correctness never depends on
/// this running; the same expiry check is folded into TryReserveAsync's WHERE clause regardless.
/// </summary>
public sealed class ExpiredReservationSweepService(IServiceScopeFactory scopeFactory, ILogger<ExpiredReservationSweepService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(15);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var store = scope.ServiceProvider.GetRequiredService<ISeatStore>();
                var released = await store.ReleaseExpiredReservationsAsync(stoppingToken);

                if (released > 0)
                {
                    logger.LogInformation("Swept {Count} expired reservation(s) back to AVAILABLE", released);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Expired reservation sweep failed");
            }
        }
    }
}
