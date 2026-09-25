# Architecture Gaps — k8s + API Gateway path (post DECISIONS.md D17)

Honest accounting of what the D17 change (API Gateway replacing YARP for the k8s path, plus the
Lambda authorizer and S3-hosted frontend — `infrastructure/aws-local`) left open, incomplete, or
weaker than the environment it replaced. Written the same day the change landed
(2026-09-25), from direct testing against a live LocalStack + `kind` deployment — not guessed at.
Aspire dev is unaffected by anything below; it still runs YARP exactly as before.

## Functional / security gaps

1. **The Lambda authorizer doesn't actually enforce anything against LocalStack.** Verified, not
   guessed: the Terraform (`aws_api_gateway_authorizer`, tried both `TOKEN` and `REQUEST` types)
   is wired correctly, and the Lambda itself is correct and rejects a bad token when invoked
   directly (`aws lambda invoke`). But LocalStack's request-handling pipeline — under both its
   default ("next_gen") API Gateway provider and `PROVIDER_OVERRIDE_APIGATEWAY=legacy` — never
   reaches an authorizer step for `HTTP_PROXY` `{proxy+}` methods; every request reaches the
   backend regardless of the `Authorization` header. As of today, JWT "protection" on
   catalog/ticketing/orders/payments in the k8s+API-Gateway path is theater — the Terraform
   should enforce correctly against real AWS unchanged, but hasn't been proven to, only reasoned
   about from the AWS API contract being used.
2. **Per-IP rate limiting is gone.** YARP's `SlidingWindowLimiter` throttled by source IP; API
   Gateway has no equivalent for a public frontend with no API keys (Usage Plans are built for
   API-key-identified clients, not anonymous public traffic). The real AWS-native answer is a WAF
   rate-based rule — `infrastructure/terraform/modules/cloudfront_waf` already exists for the
   real-AWS target but was never wired to this path. What's there instead (API Gateway stage
   throttle settings) is a coarse, global cap, not per-source protection.
3. **The Redis-backed waiting room (ADR-0008) has no equivalent in this path.** It was already
   documented as a "PoC scope-cut" that fails open by design and is explicitly non-load-bearing
   for correctness (real seat-exclusivity is Ticketing's own Postgres CAS, ADR-0002) — so this
   doesn't weaken any guarantee the system actually makes. It does mean the k8s+API-Gateway path
   has *zero* admission-control shaping under a traffic spike, where Aspire (still on YARP) has
   some. The CloudFront → WAF → Waiting Room → API Gateway pipeline this repo's own prompt asks
   for is now less represented locally than it was before this change, not more — we added a real
   API Gateway, but removed the one piece that was actually modeling "Waiting Room."
4. **Live seat availability (SignalR) doesn't work through this path.** `HTTP_PROXY` REST API
   integrations don't support WebSocket upgrade — that needs a separate WebSocket API resource
   type in API Gateway. Already had a silent client-side fallback (best-effort UX only), so
   browsing/reserving/buying are unaffected; the feature just never updates live here.
5. **Inconsistent auth posture across routes.** `payments`' `GET /{orderId}` still has no
   authorizer attached (by original design — its only surface is a status read and an internal
   webhook), which is now visually inconsistent with catalog/ticketing/orders showing
   `authorization = "CUSTOM"` in the API Gateway config, even though none of the four is actually
   enforced today (see #1).

## Operational fragility

6. **Five `kubectl port-forward` processes are a single point of failure with no supervision.**
   The API Gateway's HTTP_PROXY integrations reach the backends via
   `host.docker.internal:<port>` → `port-forward-backends.sh`'s five forwards. If one dies
   (already observed once, mid-session, when a backend pod restarted), that route silently starts
   502/timing out with no alert and no auto-restart. Real AWS has no equivalent failure mode here
   — API Gateway → VPC Link → ALB is a managed path with no host-side process to keep alive.
7. **Neither LocalStack instance persists state.** A container restart (recreate, not just
   `docker stop`/`start` — observed both behaviors during this work) wipes all
   Terraform-provisioned resources and the S3 bucket contents. Recovery is
   `terraform apply -replace=...` plus a full frontend rebuild+reupload — manual, undocumented-
   until-now (see `infrastructure/aws-local/README.md`'s troubleshooting section), and easy to
   forget. This cuts against "a reproducible local system": reproducible by re-running the setup
   script, yes; stable/durable across incidental restarts, no.
8. **CORS configuration is now duplicated five ways.** Previously one `ALLOWED_ORIGINS` value on
   the Gateway; now the same value is hardcoded into five separate k8s ConfigMaps
   (auth-service/catalog/ticketing/orders/payments), all pointing at the S3 bucket's URL. Renaming
   the bucket, moving to a custom domain, or adding CloudFront in front means five files to update
   in lockstep, with no single source of truth and no validation that they agree.
9. **`infrastructure/aws-local`'s Terraform has no remote backend.** Fine for a local/ephemeral
   exercise, but the stated intent (DECISIONS.md D17) is reapplying the same module against real
   AWS later — that will need an S3+DynamoDB (or Terraform Cloud) backend added first, the same
   gap `infrastructure/terraform/versions.tf` already calls out for the main skeleton but that
   note was never extended to this new root.

## What did *not* get worse

- The k8s YARP Gateway and the nginx-container frontend deployment were **not removed or
  modified in a breaking way** — both still exist, still work (`infrastructure/k8s/README.md` §6
  still describes reaching them directly). The API Gateway + S3 path is additive, not a
  destructive replacement; falling back to the NodePort/port-forward path costs nothing.
- Aspire dev is completely unaffected — same YARP, same rate limiting, same waiting room, same
  behavior as before this change, confirmed by a live regression run the same day.

## S3 vs. a container for the frontend — which is actually better

**For the real-AWS target specifically, S3 (+ CloudFront eventually) is the more correct choice,
not just a stylistic alternative.** The frontend is a pure static SPA build (Vite output — HTML/
JS/CSS, no server-side rendering, no runtime logic) — a nginx container serving static files in
AWS is reimplementing, at a running-24/7-container's cost, exactly what S3 + CloudFront already
does natively, at near-zero cost and with effectively unlimited scale and no ops (no replica
tuning, no health checks, no image rebuilds for a content-only change — `aws s3 sync` instead).
This is the standard industry pattern for deploying a static SPA to AWS; a Fargate/EKS pod
dedicated to serving static assets would be a legitimate finding in an architecture review.

**The tradeoff is portability.** S3 static hosting is AWS-specific — it doesn't exist on a
non-AWS Kubernetes cluster. The nginx container remains the right (only) choice for a
cloud-agnostic k8s deployment. This repo now has both, deliberately: the container-based frontend
Deployment in `infrastructure/k8s/base/frontend` is untouched and still the default for a plain
`kubectl apply -k`; S3 is the parallel, AWS-realistic path used only when driving traffic through
`infrastructure/aws-local`'s API Gateway. Neither was a strict replacement for the other.
