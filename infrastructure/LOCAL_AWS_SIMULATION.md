# Local AWS Simulation — testing against a remote Docker host

This is for testing the full platform against a **simulated AWS** locally — EKS via `kind`, SNS/SQS (and optionally S3) via LocalStack — using a remote Docker engine (e.g. a "Floci" instance on a remote server) instead of a local Docker Desktop. It builds directly on `infrastructure/k8s/README.md` and `infrastructure/docker/README.md`; read this alongside those, not instead of them — this file covers only what's specific to a **remote** Docker host and to the **AWS-simulation** framing.

## 1. What maps to what

| Real AWS (target, `infrastructure/terraform`) | Local simulation (this guide) |
|---|---|
| EKS | `kind` (Kubernetes-in-Docker) — a real Kubernetes API, real Deployments/Services, just running as containers instead of EC2/Fargate nodes |
| SNS + SQS | LocalStack (`infrastructure/k8s/base/localstack`) — MassTransit's `MassTransit.AmazonSQS` transport runs the **exact same code path** against it as against real AWS (ADR-0004); only the endpoint URL differs |
| S3 | Also serves the frontend's static site for the k8s+API Gateway path — see `infrastructure/aws-local/README.md`. Otherwise, no service in this codebase calls S3 directly (the only other reference is `infrastructure/terraform/modules/cloudfront_waf`'s access-log bucket). |
| RDS (5 independent instances) | The single Postgres `StatefulSet` in `infrastructure/k8s/base/postgres` (5 databases, one instance — DECISIONS.md D5's local-k8s compromise) |
| Secrets Manager | Plain Kubernetes `Secret` objects in `infrastructure/k8s/base/*/secret.yaml` (placeholder values — never real secrets) |
| API Gateway | **Simulated for real as of DECISIONS.md D17** — a second, host-level LocalStack instance (`infrastructure/aws-local`) runs it (plus a Lambda JWT authorizer), replacing YARP entirely for the k8s path. Aspire dev still uses YARP as the stand-in, unchanged. |
| CloudFront / WAF | Still not simulated locally in either environment — YARP (Aspire) / API Gateway's own CORS+throttling (k8s) approximate the pieces of their role that matter for local validation; see `ARCHITECTURE.md` §9 |

## 2. The remote-Docker-host caveat (read this before anything else)

`kind` is **not designed to run against a Docker daemon on a different machine than the one running the `kind`/`kubectl` CLI**. It needs to compute the address the generated kubeconfig should point at, and it assumes "the Docker host" and "the machine I'm running on" are the same box. Pointing a local `kind` CLI at a remote daemon via `DOCKER_HOST`/`docker context` is a known source of flaky, hard-to-debug failures (wrong API server address in the kubeconfig, node containers that can't reach each other correctly).

**Two ways to work with this, in order of how reliable they are:**

### Option A — recommended: run everything ON the remote server

SSH into the box hosting Floci and run `kind`, `docker build`, and `kubectl` **locally on that machine**, exactly as `infrastructure/k8s/README.md` describes, with no remote-Docker complexity at all. You then reach the cluster from your own machine via **SSH port forwarding** layered on top of `kubectl port-forward` running on the remote side.

```bash
# 1. Get the repo onto the remote box (once)
ssh you@remote-server 'git clone <this-repo-url> ~/ticketing-system'
# or, if you're iterating locally and want to sync changes:
rsync -avz --exclude node_modules --exclude bin --exclude obj \
  "/Volumes/Mac External/Code/github/ticketing-system/" you@remote-server:~/ticketing-system/

# 2. SSH in and do the normal k8s README flow, on the remote box
ssh you@remote-server
cd ~/ticketing-system
kind create cluster --name ticketing
./infrastructure/k8s/build-all.sh
for svc in gateway catalog ticketing orders payments fakepaymentgateway auth-service notification-service frontend; do
  kind load docker-image "ticketing/${svc}:local" --name ticketing
done
kubectl apply -k infrastructure/k8s/overlays/local
kubectl -n ticketing get pods -w   # wait for everything Running/Ready

# 3. From the remote box, forward the two services you need to reach
kubectl -n ticketing port-forward svc/gateway   30500:5000 &
kubectl -n ticketing port-forward svc/frontend  30173:80   &
```

Then, from **your own machine**, open a second SSH connection that tunnels those two ports to your laptop:

```bash
ssh -N -L 30500:localhost:30500 -L 30173:localhost:30173 you@remote-server
```

Now `http://localhost:30173` in your browser reaches the frontend exactly as if everything were local, with the frontend's `VITE_API_BASE_URL` pointing at `http://localhost:30500` (the Gateway) unchanged. This is the same NodePort numbering `infrastructure/k8s/README.md` already documents — nothing to reconfigure.

### Option B — advanced/fallback: point your local Docker CLI at the remote daemon

Use this only if you can't get an interactive shell on the remote box (e.g. Floci only exposes a raw Docker socket/API, no SSH shell access to that user). It gets `docker build`/`docker run` working remotely, but **skip `kind` in this mode** — build images and run LocalStack as plain containers instead, and either fall back to `docker compose`-style manual container wiring or accept Option A's SSH-shell requirement for the actual Kubernetes layer.

```bash
# If Floci exposes an SSH-based Docker context:
docker context create floci --docker "host=ssh://you@remote-server"
docker context use floci
docker build -f infrastructure/docker/catalog.Dockerfile -t ticketing/catalog:local .
# ... works exactly like local docker build, just executing on the remote daemon

# If Floci exposes a raw TCP Docker socket instead:
export DOCKER_HOST=tcp://remote-server:2375   # or 2376 for TLS — use TLS if this is anything but a fully trusted private network
docker build -f infrastructure/docker/catalog.Dockerfile -t ticketing/catalog:local .
```

An unauthenticated `tcp://` Docker socket is equivalent to root on that host for anyone who can reach it — only do this on a private network you trust, and prefer the `ssh://` context form (it reuses your normal SSH auth) whenever Floci supports it.

## 3. Deploying LocalStack for the AWS simulation

**Before you apply anything — LocalStack needs a free account token, or it won't start at all** (DECISIONS.md D16). If you see this on `kubectl -n ticketing logs -l app.kubernetes.io/name=localstack`:

```text
License activation failed! 🔑❌
Reason: No credentials were found in the environment. Please make sure to either set the
LOCALSTACK_AUTH_TOKEN variable to a valid auth token...
```

that's exactly this — and it's not a misconfiguration on your end, and not something to work around by changing `SERVICES` or anything else in this repo: as of whatever version `localstack/localstack:latest` currently resolves to, even the community/free services this platform actually uses (SQS, SNS) require the container itself to authenticate. Fix: sign up free at <https://app.localstack.cloud>, copy your auth token from the account page, and put it in `infrastructure/k8s/base/localstack/secret.yaml`'s `LOCALSTACK_AUTH_TOKEN` (it ships with an obvious placeholder — never a real token committed) before `kubectl apply -k`. If you already applied with the placeholder, update the Secret and restart the pod: `kubectl -n ticketing rollout restart deployment/localstack`.

Once that's sorted, LocalStack is already part of `infrastructure/k8s/base/localstack` — no extra step needed for SNS/SQS. Two more things worth knowing:

- **MassTransit auto-provisions its own topics/queues** against LocalStack the moment each .NET service boots (ADR-0004) — the `localstack-provision` Job (`infrastructure/k8s/base/localstack/provision-job.yaml`) is a best-effort convenience for pre-creating things before any service is running, not a requirement. If you see it fail or its topic names look wrong, it's safe to ignore/delete — the real topology comes from the services themselves. Confirm what MassTransit actually created with:
  ```bash
  kubectl -n ticketing port-forward svc/localstack 4566:4566 &
  aws --endpoint-url=http://localhost:4566 --region=us-east-1 sns list-topics
  aws --endpoint-url=http://localhost:4566 --region=us-east-1 sqs list-queues
  ```
- **To add S3** (only if you're specifically testing the `cloudfront_waf` Terraform module against LocalStack, §6 — not needed to run the app): edit `infrastructure/k8s/base/localstack/deployment.yaml`'s `SERVICES` env var from `"sqs,sns"` to `"sqs,sns,s3"` and re-apply (`kubectl apply -k infrastructure/k8s/overlays/local`).

## 4. Verifying the AWS-shaped parts actually work

Beyond the general health-check steps in `infrastructure/k8s/README.md` §5, specifically for the "is this really behaving like it would on AWS" question:

```bash
# Confirm the .NET services actually connected to LocalStack, not fallen back to nothing
kubectl -n ticketing logs -l app.kubernetes.io/name=orders | grep -i "sqs\|sns\|localstack\|connected"

# Watch a real message flow: reserve + buy a seat through the frontend (or curl the API directly),
# then check a queue actually received something
aws --endpoint-url=http://localhost:4566 --region=us-east-1 sqs receive-message \
  --queue-url "$(aws --endpoint-url=http://localhost:4566 --region=us-east-1 sqs list-queues --query 'QueueUrls[0]' --output text)"
```

If a .NET service's logs show connection errors to `localstack:4566` instead of `localhost:4566` when run from *inside* the cluster — that's expected and correct: in-cluster, services reach LocalStack via its Service DNS name (`localstack`), not `localhost`. `localhost:4566` is only right for `aws` CLI commands run from your own machine through the `port-forward` in §3.

## 5. Known gap this exposed (already fixed)

While preparing this guide, `auth-service` was found to have **no `/health` endpoint** despite its k8s readiness/liveness probes targeting `GET /health` — the pod would have sat `NotReady` forever on a real deploy. This has been fixed (a `HealthController` mirroring `notification-service`'s, zero dependencies so DB unavailability can't flap process-level readiness) — pull the latest commit before deploying, or you'll see exactly this symptom.

## 6. Testing the AWS Terraform module locally against LocalStack (optional, advanced)

Separate from the k8s simulation above: if you want to validate `infrastructure/terraform` itself (not just the app) without a real AWS account, point the AWS provider at LocalStack instead of real AWS. This is genuinely a different exercise from running the platform — it tests the *infrastructure-as-code*, not the *application*.

```hcl
# infrastructure/terraform/localstack-override.tf (don't commit this — it's a local testing override)
provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true

  endpoints {
    sqs = "http://localhost:4566"
    sns = "http://localhost:4566"
    s3  = "http://localhost:4566"
    rds = "http://localhost:4566"
    # add other services' endpoints here as you exercise more modules
  }
}
```

`terraform init && terraform plan` against this would validate the module graph end-to-end; `terraform apply` would actually provision (fake) resources into LocalStack. This wasn't run as part of building this repo (see `DECISIONS.md` D4/D15) — treat it as a starting point, not a verified recipe, and delete the override file before ever running Terraform against real AWS.

## 7. Troubleshooting

- **`localstack` pod `CrashLoopBackOff`, logs say "License activation failed"**: see §3 — you need a free `LOCALSTACK_AUTH_TOKEN`.
- **Pods stuck `Pending`**: usually resource requests exceeding what the remote host actually has free (`kubectl -n ticketing describe pod <name>` shows why). This platform's default resource requests assume a reasonably provisioned dev machine; lower them in the relevant `deployment.yaml` if the remote box is small.
- **Frontend loads but every API call fails**: check the SSH tunnel in Option A is actually up (`ssh -N -L ...` must keep running in its own terminal/tmux pane), and that `kubectl port-forward` on the remote side didn't die silently (it does when a pod restarts — re-run it).
- **A .NET service is `Running` but never `Ready`**: check `ASPNETCORE_ENVIRONMENT=Development` made it into the container — `aspire/ServiceDefaults` only maps `/health` in Development (see `infrastructure/k8s/base/*/configmap.yaml` comments), consistent with `infrastructure/k8s/README.md` §5's note on this.
- **`kind create cluster` hangs or the API server is unreachable** even after following Option A exactly: confirm you're not accidentally still pointed at a remote `DOCKER_HOST`/`docker context` from a previous session (`docker context ls`, `echo $DOCKER_HOST`) — Option A requires plain local Docker on the box you're running `kind` from.
