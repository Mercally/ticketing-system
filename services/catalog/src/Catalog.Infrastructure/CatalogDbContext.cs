using Catalog.Domain;
using Microsoft.EntityFrameworkCore;

namespace Catalog.Infrastructure;

public sealed class CatalogDbContext(DbContextOptions<CatalogDbContext> options) : DbContext(options)
{
    public DbSet<Event> Events => Set<Event>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Event>(b =>
        {
            b.ToTable("events");
            b.HasKey(e => e.Id);
            b.Property(e => e.Name).HasMaxLength(200).IsRequired();
            b.Property(e => e.Venue).HasMaxLength(200).IsRequired();
            b.Property(e => e.Description).HasMaxLength(2000).IsRequired();
            b.Property(e => e.ImageUrl).HasMaxLength(500);
        });
    }
}
