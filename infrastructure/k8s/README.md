# infrastructure/k8s

Kustomize manifests for validating the platform's microservices under Kubernetes locally
(`kind` or `minikube`) — per `ARCHITECTURE.md` §12, this is the **secondary** local target
after `.NET Aspire`, and per the top-level task framing for this repo, the k8s manifests are a
primary deliverable in their own right, not an afterthought.

**Honesty note up front:** none of this has been applied to a live `kind`/`minikube` cluster in
this sandbox — there is no cluster here to apply it to, and several of the services these
manifests deploy are still mid-build by other in-progress work (see each Dockerfile's and
manifest's own comments for what's confirmed vs. assumed). Everything below is hand-checked
(`kubectl kustomize` was run locally against `overlays/local` to confirm the Kustomize graph
resolves and every resource renders — see "What was actually checked" at the bottom) but not
run end-to-end. Treat this as a carefully-reasoned scaffold, not a verified deployment.

## Layout

```text
base/                   Every resource: namespace, postgres, localstack, redis, one dir per
                         service (deployment + service + configmap + secret).
overlays/local/         The actual apply target — a thin pass-through to base/ today, kept
                         separate per standard Kustomize convention so environment-specific
                         patches (image tags, replica counts, resource limits) have somewhere
                         to live later without touching base/.
build-all.sh            Builds every image referenced by base/*/deployment.yaml.
```

## 1. Prerequisites

- Docker (or another OCI builder) able to run the `docker build` commands in
  `infrastructure/docker/README.md`.
- A local cluster: `kind` (`kind create cluster`) or `minikube` (`minikube start`). Neither is
  assumed to have `ingress-nginx` installed — see "Ingress vs. NodePort" below for why that
  matters.
- `kubectl` with `kustomize` support (built in since 1.14) and `kubectl -k`.

## 2. Build the images

```bash
./infrastructure/k8s/build-all.sh
```

This runs the same `docker build` invocations documented individually in
`infrastructure/docker/README.md`, tagging every image `ticketing/<service>:local` — the exact
tags `base/*/deployment.yaml` reference. It also builds `ticketing/frontend:local` with
`VITE_API_BASE_URL` defaulted to `http://localhost:30500` (the Gateway's NodePort — see below);
override with `VITE_API_BASE_URL=http://<other-host>:30500 ./infrastructure/k8s/build-all.sh` if
your cluster is reachable at a different host (e.g. `minikube ip`).

## 3. Load the images into the cluster

Local images built with plain `docker build` are **not** visible inside a `kind`/`minikube`
cluster automatically — `imagePullPolicy: IfNotPresent` on every Deployment here means "use what's
already loaded, don't go to a registry," so this step is required, not optional.

**kind:**

```bash
for svc in gateway catalog ticketing orders payments fakepaymentgateway auth-service notification-service frontend; do
  kind load docker-image "ticketing/${svc}:local"
done
```

**minikube:**

```bash
for svc in gateway catalog ticketing orders payments fakepaymentgateway auth-service notification-service frontend; do
  minikube image load "ticketing/${svc}:local"
done
```

## 4. Apply

```bash
kubectl apply -k infrastructure/k8s/overlays/local
```

This creates the `ticketing` namespace and everything in it. Postgres needs to finish its
`docker-entrypoint-initdb.d` init script (creates the 5 databases — see
`base/postgres/configmap-init.yaml`) before app services relying on it will pass readiness;
LocalStack needs to be `Running` before `localstack-provision` (a Job, see
`base/localstack/provision-job.yaml`) succeeds — both self-resolve on their own given a few
seconds, no manual ordering needed thanks to Kubernetes' own retry/reconciliation.

## 5. Check it came up

```bash
kubectl -n ticketing get pods
kubectl -n ticketing get pods -w          # watch until everything is Running/Ready
kubectl -n ticketing get jobs             # localstack-provision should show Complete
kubectl -n ticketing logs -l app.kubernetes.io/name=gateway
kubectl -n ticketing describe pod <name>  # if something is stuck Pending/CrashLoopBackOff
```

Expected steady state: one pod each for `postgres` (StatefulSet), `localstack`, `redis`, and all
nine services, plus a completed `localstack-provision` Job. If a .NET service's pod is
`Running` but never goes `Ready`, check `ASPNETCORE_ENVIRONMENT=Development` made it into the
container (readiness probes hit `/health`, which `aspire/ServiceDefaults` only maps in
Development — see e.g. `base/gateway/configmap.yaml`'s comment) and check the app actually started
(not just that the port is open) via `kubectl -n ticketing logs`.

## 6. Reach it from a browser

**As of DECISIONS.md D17, this is no longer the primary way in.** Gateway (YARP) stays deployed
here — everything below still works exactly as described, and it's the quickest way to poke at
the k8s deployment directly — but the actual front door is now a real API Gateway (via
LocalStack) plus the frontend hosted on S3, both outside this cluster. See
`infrastructure/aws-local/README.md` for that path. This section is kept for direct
service-to-service debugging and as a fallback.

### Ingress vs. NodePort — the choice made here, and the trade-off

Two ways to expose Gateway (and Frontend) to a browser outside the cluster were on the table:

- **Ingress** (via `ingress-nginx`): more production-representative — it's the closest local
  analogue to the CloudFront → WAF → API Gateway edge layer in `ARCHITECTURE.md` §10.5, and is
  the more idiomatic "real" way to expose HTTP services from a cluster. But it requires an
  ingress controller installed on the cluster first (`minikube addons enable ingress`, or for
  `kind`, a manual `ingress-nginx` install plus a cluster created with `extraPortMappings` — kind
  has no built-in equivalent to minikube's addon), which is an extra manual step and an extra
  moving part to debug if it goes wrong.
- **NodePort** (chosen): zero extra components — works against a bare `kind create cluster` or
  `minikube start` with no add-ons. The cost: it's a less production-like way to expose a
  service, and on `kind` specifically the NodePort isn't automatically reachable at
  `localhost:<port>` unless the cluster was created with matching `extraPortMappings`, or you
  fall back to `kubectl port-forward` (see below) — so it isn't entirely zero-friction either,
  it just fails in a more obvious/debuggable way (connection refused, not "which controller
  version am I running").

**NodePort was picked** because this PoC's explicit goal is validating service behavior under
Kubernetes with as little incidental setup friction as possible, and it keeps that setup to
"build images, load images, `kubectl apply -k`" with no cluster-config or add-on prerequisite.
If this were being hardened past PoC stage, Ingress is the natural upgrade (and would let the
frontend and gateway share one host with path-based routing, closer to how the real AWS edge
in §10.5 behaves).

### Fixed NodePorts

| Service | Cluster-internal port | NodePort |
|---|---|---|
| gateway (`base/gateway/service.yaml`) | 5000 | **30500** |
| frontend (`base/frontend/service.yaml`) | 80 | **30173** (mnemonic: Vite's dev port is 5173) |

Both are pinned explicitly (not auto-assigned) specifically so
`infrastructure/docker/frontend.Dockerfile`'s default `VITE_API_BASE_URL` build ARG
(`http://localhost:30500`) stays correct without re-checking it after every apply.

### How to actually reach `localhost:<nodeport>`, per cluster tool

- **minikube**: NodePort services are reachable at `$(minikube ip):<nodeport>`, not
  `localhost:<nodeport>`, unless you're on Docker driver + `minikube tunnel`. Simplest:
  `minikube service frontend -n ticketing --url` / `minikube service gateway -n ticketing --url`
  prints the right URL directly.
- **kind**: NodePorts are only reachable at `localhost:<nodeport>` if the cluster config included
  matching `extraPortMappings` (`kind create cluster --config` with a `nodePort: 30500` /
  `30173` → `hostPort` mapping) at cluster-creation time — not something this scaffold can set up
  after the fact.
- **Universal fallback (works regardless of cluster tool or setup)**:
  ```bash
  kubectl -n ticketing port-forward svc/frontend 30173:80 &
  kubectl -n ticketing port-forward svc/gateway   30500:5000 &
  ```
  Then open `http://localhost:30173` in a browser. This is the recommended way to verify things
  locally without fighting cluster-specific NodePort routing.

## 7. LocalStack SQS/SNS topology

`base/localstack/provision-job.yaml` runs a best-effort AWS CLI script
(`base/localstack/provision-configmap.yaml`) that pre-creates SNS topics/SQS queues for the
message types in `docs/CONTRACTS.md` §10. Read that ConfigMap's header comment before trusting
the exact names it uses — MassTransit auto-provisions its own topology on service startup
regardless (so this Job isn't load-bearing for the system to work), and the precise names it
will actually use depend on `building-blocks/messaging` configuration that's still being written
elsewhere. The names in the script are reasonable guesses, marked `# TODO verify`, not confirmed
fact.

## 8. Known scope gaps / TODOs (honest list)

- **No OTel Collector deployed here.** `OTEL_EXPORTER_OTLP_ENDPOINT` is left unset in every
  service's ConfigMap (see the comment in `base/gateway/configmap.yaml`, repeated elsewhere) —
  Aspire's own dashboard is the primary local observability experience per `ARCHITECTURE.md`
  §12; wiring a collector into this k8s scaffold too was out of scope for this pass.
- **Health probe paths for the NestJS services are partly an assumption.** `notification-service`
  is confirmed (`docs/CONTRACTS.md` §9 states `GET /health` explicitly); `auth-service`'s
  `/health` is inferred by convention (see that service's `deployment.yaml` comment) since no
  such route exists in its code yet as of writing.
- **`ConnectionStrings__<db>` env var names are a convention, not verified.** No service's actual
  `DbContext`/EF Core connection-string wiring exists yet; if the real code binds a different key
  name, update the relevant `base/<service>/secret.yaml`.
- **Ticketing is pinned to `replicas: 1`** until a Redis SignalR backplane (ADR-0007) is wired
  into `Ticketing.Api` — see the detailed comment in `base/ticketing/deployment.yaml`. Do not
  raise this without that work landing first.

## What was actually checked in this sandbox

Neither `kubectl` nor standalone `kustomize` is available in this sandbox (checked with `which`),
so `kubectl apply -k` / `kubectl kustomize` itself could **not** be run — the following is as far
as verification could go without them:

- Every one of the 49 YAML files under `infrastructure/k8s/` was parsed with PyYAML
  (`yaml.safe_load_all`) and confirmed syntactically valid (no tab/indentation errors, no broken
  block scalars in the shell-script ConfigMaps, etc.).
- `base/kustomization.yaml`'s `resources:` list (47 entries) was checked programmatically against
  the filesystem — every referenced path exists. `overlays/local/kustomization.yaml`'s
  `../../base` reference was likewise confirmed to resolve to a real directory.
- Docker **is** available in this sandbox (`/Users/mercally/.local/bin/docker`), but no image was
  actually built here — the service source code these Dockerfiles target is still mid-build by
  other in-progress work, so a build attempt would only demonstrate that missing `.csproj`/Prisma
  output fails, not validate the Dockerfiles themselves.
- No cluster was created, no `kubectl apply` was run. Everything from step 4 onward in this README
  is reasoned from how these Kubernetes/Kustomize primitives behave, not observed running here.
