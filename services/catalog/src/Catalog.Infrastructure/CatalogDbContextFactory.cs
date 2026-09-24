using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Catalog.Infrastructure;

/// <summary>Design-time-only factory so `dotnet ef migrations add` works without Aspire running.</summary>
public sealed class CatalogDbContextFactory : IDesignTimeDbContextFactory<CatalogDbContext>
{
    public CatalogDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__catalogdb")
            ?? "Host=localhost;Port=5432;Database=catalog;Username=postgres;Password=postgres";

        var options = new DbContextOptionsBuilder<CatalogDbContext>()
            .UseNpgsql(connectionString)
            .Options;

        return new CatalogDbContext(options);
    }
}
