# syntax=docker/dockerfile:1
#
# Ticketing/Inventory Service (.NET 10, Clean Architecture — seat authority + SignalR hub).
# Build from the REPO ROOT:
#   docker build -f infrastructure/docker/ticketing.Dockerfile -t ticketing/ticketing:local .
#
# Port: 5003 (docs/CONTRACTS.md §1). SignalR hub is served on this same port at
# /hubs/seat-availability — no separate port/ingress rule needed, just WebSocket upgrade support
# on whatever fronts this Service (see infrastructure/k8s/README.md).

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY . .

RUN dotnet restore "services/ticketing/src/Ticketing.Api/Ticketing.Api.csproj"
RUN dotnet publish "services/ticketing/src/Ticketing.Api/Ticketing.Api.csproj" \
    -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

ENV ASPNETCORE_HTTP_PORTS=5003
EXPOSE 5003

COPY --from=build /app/publish .

ENTRYPOINT ["dotnet", "Ticketing.Api.dll"]
