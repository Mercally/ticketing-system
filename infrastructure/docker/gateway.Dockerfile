# syntax=docker/dockerfile:1
#
# Gateway (.NET 10 + YARP — edge routing, rate limiting, waiting-room admission; not in the
# original prompt's service list, added per DECISIONS.md D1 to play the CloudFront/WAF/API
# Gateway role locally). This is the ONLY service the frontend talks to directly.
# Build from the REPO ROOT:
#   docker build -f infrastructure/docker/gateway.Dockerfile -t ticketing/gateway:local .
#
# Port: 5000 (docs/CONTRACTS.md §1).

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY . .

RUN dotnet restore "services/gateway/src/Gateway.Api/Gateway.Api.csproj"
RUN dotnet publish "services/gateway/src/Gateway.Api/Gateway.Api.csproj" \
    -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

ENV ASPNETCORE_HTTP_PORTS=5000
EXPOSE 5000

COPY --from=build /app/publish .

ENTRYPOINT ["dotnet", "Gateway.Api.dll"]
