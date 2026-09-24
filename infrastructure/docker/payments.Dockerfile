# syntax=docker/dockerfile:1
#
# Payment Service (.NET 10, Clean Architecture — idempotent payment orchestration).
# Build from the REPO ROOT:
#   docker build -f infrastructure/docker/payments.Dockerfile -t ticketing/payments:local .
#
# Port: 5005 (docs/CONTRACTS.md §1).

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY . .

RUN dotnet restore "services/payments/src/Payments.Api/Payments.Api.csproj"
RUN dotnet publish "services/payments/src/Payments.Api/Payments.Api.csproj" \
    -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

ENV ASPNETCORE_HTTP_PORTS=5005
EXPOSE 5005

COPY --from=build /app/publish .

ENTRYPOINT ["dotnet", "Payments.Api.dll"]
