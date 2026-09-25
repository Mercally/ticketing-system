# infrastructure/aws-local

A real AWS API Gateway (+ Lambda JWT authorizer, + the frontend on S3) fronting the k8s
deployment, via a **second, host-level LocalStack instance** — replacing YARP entirely for the
k8s path (DECISIONS.md D17). Aspire dev is untouched; it keeps YARP.

**Why a second LocalStack**, separate from the one already running inside the `kind` cluster
(`infrastructure/k8s/base/localstack`, SQS/SNS for the order saga): LocalStack's Lambda support
spawns sibling Docker containers via the host's `docker.sock`. The in-cluster LocalStack pod lives
on `kind`'s pod network (Calico/kindnet overlay) — a Lambda container spawned on the host's Docker
network has no route back to that pod network. Running LocalStack here, as a plain container on
the real host Docker daemon, sidesteps that entirely — standard, documented LocalStack Lambda
behavior, no extra networking. The in-cluster LocalStack keeps doing SQS/SNS, untouched.

## Prerequisites

- The k8s deployment up and healthy: `infrastructure/k8s/README.md` steps 1-5 done
  (`kubectl -n ticketing get pods` all `Running`).
- Docker (for the host-level LocalStack container and its Lambda executor).
- Terraform CLI (`terraform version` — this repo's root uses `~> 5.0` for the `aws` provider).
- A free LocalStack account token — same one already in
  `infrastructure/k8s/base/localstack/secret.yaml` works here too (LocalStack requires it even
  for local/community-tier use, DECISIONS.md D16).
- `aws` CLI, for the S3 upload step and for hand-debugging (`aws --endpoint-url=...`).

**Note on `tflocal`**: the plan for this called for HashiCorp's `tflocal` wrapper
(`pip install terraform-local`) to auto-point Terraform at LocalStack. It couldn't be installed in
the environment this was built in (blocked by a credential-leakage safety check on the `pip
install` itself — nothing to do with LocalStack). `provider.tf` in this directory uses the plain
Terraform equivalent instead — the exact `endpoints {}` override recipe already documented in
`infrastructure/LOCAL_AWS_SIMULATION.md` §6, just actually applied this time. Functionally
identical; install `tflocal` yourself if you want the wrapper's convenience.

## Steps

```bash
# 1. Backend services reachable on the host (LocalStack's API Gateway integrations run as
#    sibling Docker containers, not inside kind's pod network — they reach the backends via
#    host.docker.internal:<port>, which needs these on the host first).
./port-forward-backends.sh &

# 2. Host-level LocalStack (API Gateway + Lambda + S3).
export LOCALSTACK_AUTH_TOKEN="<same token as infrastructure/k8s/base/localstack/secret.yaml>"
docker compose up -d

# 3. Provision the API Gateway + Lambda authorizer + S3 bucket.
terraform init      # first time only
terraform apply

# 4. Build the frontend pointed at the API Gateway invoke URL, upload to the S3 bucket.
#    Both values come from `terraform output` (or the apply output above).
cd ../../apps/frontend
VITE_API_BASE_URL="$(terraform -chdir=../../infrastructure/aws-local output -raw invoke_url)" npm run build
aws --endpoint-url=http://localhost:4566 s3 sync dist s3://ticketing-frontend-local --delete
cd ../../infrastructure/aws-local
```

## Reach it

```
terraform output frontend_website_endpoint   # open this in a browser
terraform output invoke_url                  # the API Gateway invoke URL, for curl/debugging
```

Both are LocalStack's convenience DNS domains (`*.localhost.localstack.cloud`) — real public DNS
that resolves to `127.0.0.1`, so no `/etc/hosts` editing, and they look like real AWS URLs
(`{api-id}.execute-api.localhost.localstack.cloud`, matching the shape of a real
`{api-id}.execute-api.{region}.amazonaws.com`).

**Secure-context gotcha**: `*.s3-website.localhost.localstack.cloud` numerically resolves to
`127.0.0.1`, but browsers' `isSecureContext` check is on the origin string, not the resolved
IP — and this hostname doesn't literally end in `.localhost` (the last label is `.cloud`), so it
does **not** count as a secure context the way plain `localhost` does. `crypto.randomUUID()` is
gated behind `isSecureContext` and silently isn't a function here — the frontend now has a
fallback (`apps/frontend/src/lib/uuid.ts`, using `crypto.getRandomValues()` instead, which has no
such restriction) so this doesn't break anything, but it's worth knowing if you extend the
frontend and reach for `crypto.randomUUID()` again.

## Known gaps, honestly

Full write-up, including operational fragility beyond just these four and the S3-vs-container
reasoning: [`docs/ARCHITECTURE_GAPS.md`](../../docs/ARCHITECTURE_GAPS.md).

- **The Lambda authorizer doesn't actually get invoked by LocalStack.** Verified, not guessed:
  the Terraform wiring is correct (`aws_api_gateway_authorizer`, tried both `TOKEN` and `REQUEST`
  types), and the Lambda itself is correct and works when invoked directly
  (`aws lambda invoke --function-name ticketing-local-jwt-authorizer ...` correctly rejects a bad
  token). But debug logs show LocalStack's request-handling chain — under both its default
  ("next_gen") API Gateway provider and `PROVIDER_OVERRIDE_APIGATEWAY=legacy` — never reaches an
  authorizer step for `HTTP_PROXY` `{proxy+}` methods; every request reaches the backend
  regardless of the `Authorization` header. This is a LocalStack emulation gap in this build
  (`2026.8.4`, pro edition) — the same Terraform should enforce correctly against real AWS
  unchanged, since the AWS API contract being used here (`authorization = "CUSTOM"`,
  `identity_source`, `authorizer_uri`) is the real one, not something LocalStack-specific.
- **Per-IP rate limiting doesn't carry over.** YARP's `SlidingWindowLimiter` was per-source-IP;
  API Gateway has no equivalent for a public frontend with no API keys. Stage-level throttle
  settings are a coarser, global approximation. Real per-IP limiting on AWS is a WAF rate-based
  rule (`infrastructure/terraform/modules/cloudfront_waf` already exists for the real-AWS
  target) — out of scope here.
- **The Redis-backed waiting room doesn't carry over.** It was already documented as a
  "PoC scope-cut" that fails open by design and is non-load-bearing for correctness (real
  seat-exclusivity is Ticketing's own Postgres CAS) — dropping it for this path doesn't weaken
  anything the system actually guarantees.
- **SignalR (live seat availability) doesn't work through this path.** `HTTP_PROXY` REST API
  integrations don't support WebSocket upgrade (that's a distinct "WebSocket API" resource type
  in API Gateway). Already had a silent fallback in the frontend — degrades to no live updates,
  doesn't break browsing/reserving/buying.

## Troubleshooting

- **`docker compose up` fails with "required variable LOCALSTACK_AUTH_TOKEN is missing"**: export
  it in your shell first (see step 2) — the `${LOCALSTACK_AUTH_TOKEN:?...}` in
  `docker-compose.yaml` is deliberate, same reasoning as `infrastructure/k8s/base/localstack`
  never shipping a real token.
- **API Gateway integration calls time out / connection refused**: `port-forward-backends.sh` not
  running, or one of its 5 `kubectl port-forward`s died silently (they do when a pod restarts —
  Ctrl+C and rerun the script).
- **`terraform apply` reuses a stale LocalStack state** (e.g. after `docker compose down` +
  `up` recreated the container fresh, wiping LocalStack's in-memory resources but not Terraform's
  state file): `terraform apply -replace='module.api_gateway.aws_api_gateway_rest_api.this'` to
  force everything to recreate against the fresh instance.
- **CORS errors in the browser console for a route that returns 200 to curl**: check the failing
  route actually has both a `{proxy+}` child resource AND its own exact-path method on the parent
  service resource (`main.tf`'s `aws_api_gateway_method.exact`) — a bare
  `POST /api/orders` (no trailing segment) doesn't match `/api/orders/{proxy+}` at all, so it 404s
  at the API Gateway framework level before ever reaching the custom CORS OPTIONS handler. This
  bit exactly one route in practice (Orders' `POST /orders`) — every other service's HTTP surface
  happens to always have at least one path segment after the service prefix.
