using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Ticketing.Infrastructure;

public sealed class TicketingDbContextFactory : IDesignTimeDbContextFactory<TicketingDbContext>
{
    public TicketingDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__ticketingdb")
            ?? "Host=localhost;Port=5432;Database=ticketing;Username=postgres;Password=postgres";

        var options = new DbContextOptionsBuilder<TicketingDbContext>()
            .UseNpgsql(connectionString)
            .Options;

        return new TicketingDbContext(options);
    }
}
