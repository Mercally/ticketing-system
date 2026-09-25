#!/usr/bin/env bash
# Exposes the 5 backend k8s Services on the host so the host-level LocalStack's API Gateway
# HTTP_PROXY integrations (which run as sibling Docker containers, not inside kind's pod network)
# can reach them via host.docker.internal:<port>. Same kubectl port-forward pattern already used
# to reach frontend/gateway during e2e validation (infrastructure/k8s/README.md §6) — just for
# the 5 backends instead, and on a different port range (31001-31005) so it doesn't collide with
# the existing 30173/30500 NodePorts.
#
# Written without associative arrays / bash 4+ syntax on purpose — macOS ships bash 3.2 as
# /bin/bash, which doesn't support `declare -A`.
#
# Run this AFTER `kubectl apply -k infrastructure/k8s/overlays/local` and before `terraform apply`
# in this directory. Ctrl+C stops all 5 forwards (they're child processes of this script).
set -euo pipefail

NAMESPACE=ticketing

# svc:local_port:target_port
MAPPINGS="auth-service:31001:5001 catalog:31002:5002 ticketing:31003:5003 orders:31004:5004 payments:31005:5005"

pids=""
cleanup() {
  echo "Stopping port-forwards..."
  for pid in $pids; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

for mapping in $MAPPINGS; do
  svc="${mapping%%:*}"
  rest="${mapping#*:}"
  local_port="${rest%%:*}"
  target_port="${rest#*:}"
  echo "==> ${svc}: localhost:${local_port} -> svc/${svc}:${target_port}"
  kubectl -n "$NAMESPACE" port-forward "svc/${svc}" "${local_port}:${target_port}" &
  pids="$pids $!"
done

echo "All 5 backends forwarded. Press Ctrl+C to stop."
wait
