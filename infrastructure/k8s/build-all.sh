#!/usr/bin/env bash
# Builds every service image referenced by infrastructure/k8s/base/*/deployment.yaml.
# Run from the REPO ROOT (all Dockerfiles use repo root as build context):
#   ./infrastructure/k8s/build-all.sh
#
# Not executed/verified in this sandbox (no Docker daemon assumed available) — see
# infrastructure/k8s/README.md for what has and hasn't been validated here.
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

VITE_API_BASE_URL="${VITE_API_BASE_URL:-http://localhost:30500}"

dotnet_services=(gateway catalog ticketing orders payments)
for svc in "${dotnet_services[@]}"; do
  echo "==> Building ticketing/${svc}:local"
  docker build -f "infrastructure/docker/${svc}.Dockerfile" -t "ticketing/${svc}:local" .
done

echo "==> Building ticketing/fakepaymentgateway:local"
docker build -f infrastructure/docker/fakepaymentgateway.Dockerfile -t ticketing/fakepaymentgateway:local .

echo "==> Building ticketing/auth-service:local"
docker build -f infrastructure/docker/auth-service.Dockerfile -t ticketing/auth-service:local .

echo "==> Building ticketing/notification-service:local"
docker build -f infrastructure/docker/notification-service.Dockerfile -t ticketing/notification-service:local .

echo "==> Building ticketing/frontend:local (VITE_API_BASE_URL=${VITE_API_BASE_URL})"
docker build -f infrastructure/docker/frontend.Dockerfile \
  --build-arg "VITE_API_BASE_URL=${VITE_API_BASE_URL}" \
  -t ticketing/frontend:local .

echo "==> All images built."
