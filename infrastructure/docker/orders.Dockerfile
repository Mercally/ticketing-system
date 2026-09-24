# syntax=docker/dockerfile:1
#
# Order Service (.NET 10, Clean Architecture — hosts the MassTransit Saga State Machine).
# Build from the REPO ROOT:
#   docker build -f infrastructure/docker/orders.Dockerfile -t ticketing/orders:local .
#
# Port: 5004 (docs/CONTRACTS.md §1).

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY . .

RUN dotnet restore "services/orders/src/Orders.Api/Orders.Api.csproj"
RUN dotnet publish "services/orders/src/Orders.Api/Orders.Api.csproj" \
    -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

ENV ASPNETCORE_HTTP_PORTS=5004
EXPOSE 5004

COPY --from=build /app/publish .

ENTRYPOINT ["dotnet", "Orders.Api.dll"]
