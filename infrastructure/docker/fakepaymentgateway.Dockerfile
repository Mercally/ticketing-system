# syntax=docker/dockerfile:1
#
# Fake Payment Gateway (.NET 10 Minimal API — simulated external pasarela de pagos,
# runs as its OWN process/container per DECISIONS.md D2, so Payment Service's resilience
# pipeline — timeout/retry/circuit breaker — has a real network hop to exercise).
# Build from the REPO ROOT:
#   docker build -f infrastructure/docker/fakepaymentgateway.Dockerfile -t ticketing/fakepaymentgateway:local .
#
# Port: 5006 ("payments-gateway-fake" in docs/CONTRACTS.md §1).

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY . .

RUN dotnet restore "services/payments/src/FakePaymentGateway.Api/FakePaymentGateway.Api.csproj"
RUN dotnet publish "services/payments/src/FakePaymentGateway.Api/FakePaymentGateway.Api.csproj" \
    -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

ENV ASPNETCORE_HTTP_PORTS=5006
EXPOSE 5006

COPY --from=build /app/publish .

ENTRYPOINT ["dotnet", "FakePaymentGateway.Api.dll"]
