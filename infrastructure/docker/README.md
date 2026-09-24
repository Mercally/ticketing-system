# infrastructure/docker

One Dockerfile per service. **All of them are built from the repo root as build context** —
this is required because the .NET solution's projects reference each other (and shared
`aspire/ServiceDefaults` + `building-blocks/*`) via relative `ProjectReference` paths, and the
NestJS/frontend Dockerfiles are kept consistent with that same root-context convention. The root
`.dockerignore` (repo root, one level up from this directory) strips `bin/`, `obj/`,
`node_modules/`, `dist/`, `.git/`, etc. so the build context stays reasonably small.

## Status

These Dockerfiles are **structurally correct but unbuilt/unverified** in this sandbox — the
services they target (`.Api.csproj` projects, `services/auth-service`, `services/notification-service`)
are still being implemented by other in-progress work as of when this was written. Paths, ports,
and entrypoints were checked against what exists on disk right now (`.csproj` files, `package.json`,
`TicketingPlatform.slnx`) and against `docs/CONTRACTS.md` §1 for ports. No `docker build` was run
here — do that once the corresponding service code lands.

## .NET services

Multi-stage: `mcr.microsoft.com/dotnet/sdk:10.0` (restore + publish the specific `.Api.csproj`)
→ `mcr.microsoft.com/dotnet/aspnet:10.0` (runtime, copies published output only).
`ASPNETCORE_HTTP_PORTS` is set per service to override the base image's default (8080) with the
CONTRACTS.md port directly.

```bash
docker build -f infrastructure/docker/gateway.Dockerfile              -t ticketing/gateway:local              .
docker build -f infrastructure/docker/catalog.Dockerfile              -t ticketing/catalog:local              .
docker build -f infrastructure/docker/ticketing.Dockerfile            -t ticketing/ticketing:local            .
docker build -f infrastructure/docker/orders.Dockerfile               -t ticketing/orders:local               .
docker build -f infrastructure/docker/payments.Dockerfile             -t ticketing/payments:local             .
docker build -f infrastructure/docker/fakepaymentgateway.Dockerfile   -t ticketing/fakepaymentgateway:local   .
```

## NestJS services

Multi-stage: `node:22-alpine` (npm ci, conditional `prisma generate`, `npm run build`) →
`node:22-alpine` (npm ci --omit=dev, copy `dist/` + `prisma/`). `prisma generate` runs only if
`prisma/schema.prisma` exists at build time, so these build cleanly today (no Prisma yet on
`auth-service`/`notification-service`) and will keep working once Prisma lands — no Dockerfile
edit required either way.

```bash
docker build -f infrastructure/docker/auth-service.Dockerfile         -t ticketing/auth-service:local         .
docker build -f infrastructure/docker/notification-service.Dockerfile -t ticketing/notification-service:local .
```

Both require a `package-lock.json` committed next to `package.json` (`npm ci` needs one) — neither
service has one yet as of writing; that's expected to land with the rest of that service's code.

## Frontend

Multi-stage: `node:22-alpine` (npm ci, `vite build`) → `nginx:alpine` (serves `dist/`, SPA
fallback via `infrastructure/docker/frontend-nginx.conf`). `VITE_API_BASE_URL` is a **build ARG**
baked into the static bundle — Vite has no runtime env story, so this must be the browser-reachable
address of the Gateway at build time, not a cluster-internal DNS name. See the Dockerfile header
comment and `infrastructure/k8s/README.md` for the default and how to override it.

```bash
docker build -f infrastructure/docker/frontend.Dockerfile \
  --build-arg VITE_API_BASE_URL=http://localhost:30500 \
  -t ticketing/frontend:local .
```

## All at once

```bash
for f in gateway catalog ticketing orders payments fakepaymentgateway; do
  docker build -f "infrastructure/docker/$f.Dockerfile" -t "ticketing/$f:local" .
done
docker build -f infrastructure/docker/auth-service.Dockerfile         -t ticketing/auth-service:local         .
docker build -f infrastructure/docker/notification-service.Dockerfile -t ticketing/notification-service:local .
docker build -f infrastructure/docker/frontend.Dockerfile             -t ticketing/frontend:local              \
  --build-arg VITE_API_BASE_URL=http://localhost:30500
```

This is also captured as `infrastructure/k8s/build-all.sh`, referenced from
`infrastructure/k8s/README.md` alongside the `kind load docker-image` / `minikube image load` steps.
