# syntax=docker/dockerfile:1
#
# Catalog Service (.NET 10, Clean Architecture). Build from the REPO ROOT:
#   docker build -f infrastructure/docker/catalog.Dockerfile -t ticketing/catalog:local .
#
# Port: 5002 (docs/CONTRACTS.md §1).

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Multi-project solution: Catalog.Api references sibling Catalog.Application/Domain/Infrastructure
# plus aspire/ServiceDefaults and building-blocks/* by relative ProjectReference paths, so the
# full repo tree needs to be present for restore/publish to resolve them. Root .dockerignore
# strips bin/obj/node_modules/etc. so this stays reasonably small.
COPY . .

RUN dotnet restore "services/catalog/src/Catalog.Api/Catalog.Api.csproj"
RUN dotnet publish "services/catalog/src/Catalog.Api/Catalog.Api.csproj" \
    -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

# ASPNETCORE_HTTP_PORTS overrides the base image's default (8080) so Kestrel binds the
# CONTRACTS.md port directly — no extra ASPNETCORE_URLS wiring needed.
ENV ASPNETCORE_HTTP_PORTS=5002
EXPOSE 5002

COPY --from=build /app/publish .

ENTRYPOINT ["dotnet", "Catalog.Api.dll"]
