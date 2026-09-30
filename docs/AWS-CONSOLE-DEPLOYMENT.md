# Publish the ticketing demo through the AWS Management Console

Reviewed against this repository and AWS documentation on **2026-09-28**. Companion: [AWS CLI and Terraform guide](AWS-TERRAFORM-DEPLOYMENT.md).

## 1. Choose the budget before creating resources

**Recommendation for reusing this project's architecture: create the environment for the demonstration, then delete it the same day.** Budget **$10–15 for a 24-hour session**, or **$240–300/month** if left running with very light traffic. These are planning estimates, not a spending cap or a validated load-test result.

An always-on prototype below $50/month needs a different hosting layout. An **8 GB Linux Lightsail server is $44/month**, including its public IPv4 bundle; allow roughly **$45–60/month** with small messaging, registry, and backup usage. Running the services, one PostgreSQL process with separate databases, and Redis on that server would sacrifice host-level isolation and availability. The current Terraform does **not** implement that layout, and this repository has no complete AWS Docker Compose deployment for it. The $24/month, 4 GB plan is a possible experiment, not a proven size for all these services. [Lightsail prices](https://aws.amazon.com/lightsail/pricing/)

This guide uses the ECS/RDS architecture already modeled in the repository, with the missing pieces identified below. It is a **conditional deployment runbook**: the preparation work in section 3 must be completed before it can produce a working application. Writing this guide did not deploy or modify application/infrastructure code.

### Cost worksheet

Assumptions: `us-east-1`, USD, 730 hours/month, Linux/x86 Fargate on demand, one task per service, six Single-AZ PostgreSQL databases, no paid support, no custom domain, and small demo traffic. No credits or Free Tier discounts are subtracted. Use [AWS Pricing Calculator](https://calculator.aws/) to save an estimate for your account before proceeding.

| Item | Calculation / allowance | Monthly estimate |
| --- | --- | ---: |
| Eight application Fargate tasks | Each 0.25 vCPU, 0.5 GB: `8 × 730 × (0.25 × 0.04048 + 0.5 × 0.004445)` | $72.08 |
| Redis in a ninth Fargate task | Same minimum task size; disposable counters only | $9.01 |
| Six RDS PostgreSQL instances | Budget assumption: `6 × 730 × $0.016/hour`, `db.t4g.micro` | $70.08 |
| RDS general-purpose storage | Budget assumption: six × 20 GB × $0.115/GB-month | $13.80 |
| One zonal NAT gateway | `730 × $0.045` | $32.85 |
| NAT public IPv4 | `730 × $0.005` | $3.65 |
| Internal ALB | `730 × $0.0225`, plus actual LCUs at $0.008/LCU-hour | $16.43 + usage |
| WAF | One ACL and two rules, excluding request fees | $7.00 |
| Secrets Manager | Six DB secrets + one JWT secret × $0.40 | $2.80 + API calls |
| Cloud Map / private DNS | Nine registrations, one private hosted zone, DNS queries | About $1.40 + queries |
| Everything usage-dependent | ECR, S3, CloudFront, API Gateway, SNS/SQS, logs, ALB LCUs, NAT data processing and cross-AZ traffic | Allow $10–30 initially |
| **Planning total** | Fixed baseline approximately $229; round up for activity and uncertainty | **$240–300** |

The RDS unit rates above are estimating inputs: confirm the selected engine version, storage type and instance price in the regional calculator; the public pricing page uses a dynamic selector. Prices checked against [Fargate](https://aws.amazon.com/fargate/pricing/), [RDS PostgreSQL](https://aws.amazon.com/rds/postgresql/pricing/), [VPC/NAT/IPv4](https://aws.amazon.com/vpc/pricing/), [ALB](https://aws.amazon.com/elasticloadbalancing/pricing/), [WAF](https://aws.amazon.com/waf/pricing/), [Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/), and [Cloud Map](https://aws.amazon.com/cloud-map/pricing/).

The unmodified Terraform has only five RDS instances and eight tasks, so its apparent baseline is about $23/month lower—but it omits required notification storage and Redis. This worksheet includes those omissions. Increasing all eight application tasks from 0.5 GB to 1 GB adds about $13/month; increase individual tasks if memory measurements require it.

At the baseline, 24 hours of provisioned capacity is approximately `$229 / 730 × 24 = $7.53`; $10–15 allows for deployment time, image transfers, activity and retained objects. Eight hours is approximately $2.51 before those extras; budget $5–10. Repeated rehearsals are additional sessions. Monthly line items and storage do not all prorate identically.

Cost traps: idle tasks still cost money; a NAT gateway and ALB still cost money when tasks stop; RDS storage/backups remain billable while stopped; RDS restarts automatically after seven days. Burstable RDS CPU credits, retained snapshots, enhanced monitoring, Container Insights, verbose logs, traffic and taxes can exceed these estimates. [RDS stopping behavior](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html)

## 2. Account and workstation prerequisites

1. Use a dedicated sandbox AWS account. Sign in with an IAM Identity Center/assumed deployment role and MFA. Do not use root for deployment.
2. Select **US East (N. Virginia), `us-east-1`**. Keep all regional resources there; CloudFront-scoped WAF also uses `us-east-1`.
3. The deployment role needs create/read/update/delete permissions for VPC/EC2 networking, ECS, ECR, ELB, Cloud Map/Route 53 private DNS, RDS, Secrets Manager, SNS/SQS, API Gateway, CloudFront, WAF, CloudWatch Logs and S3, plus IAM role/policy creation and `iam:PassRole` for the ECS roles. Service-linked role creation may be needed on first use. Budget creation needs Billing/Budgets access. Runtime tasks receive separate roles in section 8.
4. Check **Service Quotas → Amazon ECS → Fargate On-Demand vCPU resource count**. Nine tasks need 2.25 vCPUs at steady state, plus deployment overlap; request at least 6 vCPUs for this layout. Check RDS instance, VPC, NAT and Elastic IP quotas too.
5. On the build machine install Git, Docker with Buildx, AWS CLI v2, Node.js compatible with the lockfiles (the Dockerfiles use Node 22), and .NET 10 SDK if preparing/building source locally. Docker must be running. Use committed lockfiles.
6. In **Billing and Cost Management → Budgets → Create budget**, make a monthly cost budget: $25 for a short-lived demo, or $300 for the always-on ECS version. Configure actual spend alerts at 50%, 80%, 100% and a forecast alert at 100%; confirm the notification email. Budget alerts can be delayed and do not automatically stop resources.
7. Tag resources `Project=global-ticketing-platform`, `Environment=poc`, and an owner/expiry date. Activate the cost-allocation tags in Billing if you want tag-based reports. Record every resource ID in a deployment note.

Infrastructure creation below is by console clicks. **The console cannot compile source or upload a local Docker image directly into ECR**: image preparation/push and the frontend build still require a terminal or a separately configured build pipeline. There is no ready-made CodeBuild pipeline in this repository.

## 3. Required application preparation — do this before paying for AWS

The Terraform under [infrastructure/terraform](../infrastructure/terraform/) describes an unapplied target architecture. [infrastructure/aws-local](../infrastructure/aws-local/) targets LocalStack and must not be used as the real-AWS root.

| Finding in the current repository | Required action and acceptance check |
| --- | --- |
| `AddNpgsqlDbContext` uses `catalogdb`, `ticketingdb`, `ordersdb`, `paymentsdb`; Terraform injects names without `db` | Use the exact environment keys in section 9. Each service must connect to its own database. |
| `MessagingExtensions.cs` always supplies access/secret keys; defaults are `test` | In real AWS use the SDK credential chain/ECS task role. Supply explicit test credentials only inside the LocalStack `ServiceUrl` branch. Set `Messaging__Aws__Region=us-east-1`; `AWS_REGION` alone does not bind this options class. No `AWS_ENDPOINT_URL`, `Messaging__Aws__ServiceUrl` or static AWS credentials in ECS. |
| Terraform's guessed SNS topic/queue names differ from notification defaults; MassTransit uses `ConfigureEndpoints` | Verify actual runtime topology locally, record the names and subscriptions, and choose an owner for each resource. Section 7 uses runtime provisioning for .NET endpoints and manual provisioning for the notification queue. Endpoint-name formatting does not prove SNS message entity names. |
| Runtime IAM policy currently permits only a few messaging operations | Allow the APIs needed for creating/configuring topology, receiving and extending message visibility, in addition to publishing. See section 8. |
| Notification service has Prisma migrations but no AWS database or `DATABASE_URL` | Add a sixth database named `notification`, its credentials/secret, and its `DATABASE_URL`. |
| Gateway defaults to Redis on `localhost`; no Redis is provisioned | Add a private Redis task and set `REDIS_HOST` / `REDIS_PORT`. The gateway's fail-open behavior is not proof that the waiting room works. |
| Shared `/health` and `/alive` endpoints are Development-only | Make the health endpoint used by the ALB available in Production. Keep detailed health information private; do not enable the developer exception page. |
| EF migrations and catalog/seat seeding run only in Development | Add an explicit demo bootstrap/migration command or opt-in `Demo:InitializeDatabase` setting around the existing migration/seeder calls, outside the Development-only OpenAPI block. Run once with one replica per service, then disable it. Keep `ASPNETCORE_ENVIRONMENT=Production`. |
| Payments reads `FakePaymentGateway:BaseUrl`, not `FAKE_PAYMENT_GATEWAY_URL` | Set `FakePaymentGateway__BaseUrl` as shown below. |
| Frontend is absent from the AWS root | Build the SPA and host it in private S3 through CloudFront (section 11). |
| API Gateway HTTP API does not transparently proxy a SignalR WebSocket connection | For this topology, explicitly select SignalR Long Polling and shorten its server poll timeout, as below. A direct ALB WebSocket path is an alternative architecture change. |

Relevant source: [messaging options](../building-blocks/messaging/AwsMessagingOptions.cs), [messaging registration](../building-blocks/messaging/MessagingExtensions.cs), [health endpoints](../aspire/ServiceDefaults/Extensions.cs), [notification configuration](../services/notification-service/src/infrastructure/config/configuration.ts).

For a demo bootstrap flag, move only each service's existing migration/seeding work into a condition equivalent to `app.Environment.IsDevelopment() || builder.Configuration.GetValue<bool>("Demo:InitializeDatabase")`. Do not move `MapOpenApi()` or developer middleware into that condition. `Demo__InitializeDatabase=true` is a **new setting to implement**, not something the current app already understands. Catalog and Ticketing seed matching fixed event IDs; Orders and Payments need their EF schemas; Auth and Notification Docker entrypoints already run `prisma migrate deploy`.

For Long Polling, add `transport: signalR.HttpTransportType.LongPolling` to the existing `.withUrl(..., { ... })` options in [useSeatAvailabilityHub.ts](../apps/frontend/src/hooks/useSeatAvailabilityHub.ts). Replace Ticketing's hub mapping with an options overload setting `options.LongPolling.PollTimeout = TimeSpan.FromSeconds(20)`. Keep the hub path unchanged and keep one Ticketing replica for this demo. API Gateway HTTP API has a 30-second integration timeout; test negotiation and polling through the deployed edge. [HTTP API quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html), [SignalR options](https://learn.microsoft.com/en-us/aspnet/core/signalr/configuration?view=aspnetcore-10.0)

**Preparation exit check:** containers build for Linux/amd64; all services boot with Production configuration; migrations/seed data exist; health checks succeed; a local end-to-end checkout completes; topic/queue names and required IAM actions are recorded. These fixes are prerequisite work, not changes already delivered by these documentation files.

## 4. Create the network

1. Open **VPC → Create VPC → VPC and more**. Name prefix: `ticketing-poc`; IPv4 CIDR: `10.20.0.0/16`; no IPv6 for this walkthrough.
2. Select two AZs (`us-east-1a`, `us-east-1b`), two public subnets, two private subnets, and **one NAT gateway in one AZ**. Avoid the wizard's NAT-per-AZ option for this demo.
3. Use public CIDRs `10.20.0.0/24`, `10.20.1.0/24`; private CIDRs `10.20.10.0/24`, `10.20.11.0/24`. Enable DNS resolution and DNS hostnames.
4. Public route table: `0.0.0.0/0 → internet gateway`. Each private route table: `0.0.0.0/0 → the single NAT`. An S3 gateway endpoint is optional; it can reduce NAT data processing for S3 traffic without an endpoint hourly charge. It does not replace ECR API/Logs/Secrets internet access.
5. Create security groups with outbound traffic allowed for the demo:

| Group | Inbound rules |
| --- | --- |
| `ticketing-poc-vpclink` | None required for initiating the API integration |
| `ticketing-poc-alb` | TCP 80 from `ticketing-poc-vpclink` |
| `ticketing-poc-tasks` | TCP 5000 from ALB group; TCP 5000–5007 from itself |
| `ticketing-poc-redis` | TCP 6379 from tasks group |
| `ticketing-poc-db` | TCP 5432 from tasks group |

All task and database addresses stay private. Never open 5432/6379 to the internet. The current Terraform uses broader VPC/self security-group rules; this console layout narrows them while keeping the same connectivity.

## 5. Build and publish container images

1. Open **ECR → Private repositories → Create repository**. Create these eight names: `ticketing/gateway`, `ticketing/auth-service`, `ticketing/catalog`, `ticketing/ticketing`, `ticketing/orders`, `ticketing/payments`, `ticketing/fakepaymentgateway`, `ticketing/notification-service`.
2. Select immutable tags, encryption at rest and basic scan-on-push if available. Avoid enabling a paid enhanced-scanning service unintentionally. Add an ECR lifecycle rule retaining only a few previous demo builds.
3. Select each repository → **View push commands**. Authenticate AWS CLI with the same sandbox account; follow the login command. From the **repository root**, build and push, substituting the copied repository URI:

```bash
docker buildx build --platform linux/amd64 \
  -f infrastructure/docker/gateway.Dockerfile \
  -t ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/ticketing/gateway:poc-001 \
  --push .
```

4. Repeat with each matching Dockerfile/service name. Linux/amd64 avoids accidentally publishing an Apple Silicon ARM image to an x86 task. Record the image digest; use digest references or a new immutable tag for updates. [ECR push instructions](https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-push-ecr-image.html)
5. Redis can use a pinned Redis 7 image mirrored into another private ECR repository (`ticketing/redis`); scan and record its digest. This avoids relying on anonymous Docker Hub pulls during deployment. Redis stores only temporary waiting-room counters, so this guide uses no persistent volume.

## 6. Create databases and secrets

1. **RDS → Subnet groups → Create DB subnet group**: `ticketing-poc-db-subnets`, this VPC, both private subnets.
2. **RDS → Databases → Create database → Standard create → PostgreSQL → Dev/Test**. Choose a currently offered PostgreSQL 16 minor version supporting `db.t4g.micro` in this region; do not assume the Terraform default `16.4` remains creatable.
3. Choose **Single DB instance / Single-AZ**, `db.t4g.micro`, 20 GiB general-purpose SSD (gp3 where supported), encryption enabled, public access **No**, the subnet group and DB security group above. Do not select Multi-AZ, Aurora, Provisioned IOPS or paid database monitoring for this PoC.
4. Create six instances, each with its own generated strong password and initial database name:

| Identifier | Initial DB name | Suggested username |
| --- | --- | --- |
| `ticketing-poc-auth-db` | `auth` | `app_user` |
| `ticketing-poc-catalog-db` | `catalog` | `app_user` |
| `ticketing-poc-ticketing-db` | `ticketing` | `app_user` |
| `ticketing-poc-orders-db` | `orders` | `app_user` |
| `ticketing-poc-payments-db` | `payments` | `app_user` |
| `ticketing-poc-notification-db` | `notification` | `app_user` |

5. Seven-day automated backups match the scaffold. Leave deletion protection off only for disposable demo data. Record endpoints after status becomes **Available**. Do not expose RDS publicly to run migrations.
6. **Secrets Manager → Store a new secret → Other type of secret**. Create `ticketing-poc/<database>-db` for each database. Use JSON keys `connectionString` and `prismaUrl` matching the module's format. For example, replacing placeholders:

```json
{
  "connectionString": "Host=DB_HOST;Port=5432;Database=catalog;Username=app_user;Password=DB_PASSWORD;SSL Mode=Require",
  "prismaUrl": "postgresql://app_user:URL_ENCODED_PASSWORD@DB_HOST:5432/catalog?schema=public&sslmode=require"
}
```

7. Use a 32+ character random alphanumeric password to simplify URL escaping, or correctly percent-encode the Prisma password. These are illustrative placeholders, never credentials to reuse. For stronger certificate validation, include the RDS CA bundle and verify the hostname in the client; do not bypass validation to fix a TLS error.
8. Store a separate random, at least 32-byte JWT signing value as a **plain text secret** named `ticketing-poc/jwt-signing-secret`. Auth, Ticketing and Orders must receive the same value. Never place passwords/JWT secrets in images, build arguments or plaintext task environment variables.

For this disposable demo the database master accounts simplify migrations, matching the Terraform design. Longer-lived hosting should separate schema-migration credentials from restricted application users.

## 7. Prepare messaging without guessing topic names

Use one demo environment in this isolated account/region: the current application does not apply an environment prefix to every MassTransit entity.

1. Start the corrected .NET images locally against LocalStack using the established local workflow. Inspect SNS topics, SQS queues, subscriptions and startup logs. Record the actual entities for Orders' saga, Ticketing's two consumers and Payments' two consumers. Do not infer them from the Terraform's `orders-service`/`payments-service` queue names.
2. In AWS, allow these .NET services to create their transport topology when they start (section 8). Terraform/manual resources must not compete with them to configure those same queues. After starting the services in section 10, return here and select the four **actual event topics**: `OrderConfirmedV1`, `PaymentSucceededV1`, `PaymentFailedV1`, `TicketConfirmedV1`. Confirm the namespace/type with the local inventory and application logs.
3. **SNS → Topics → Create topic**: Standard topic `notifications-outbound`. No email or SMS delivery is provided by this app; this topic is its notification output. An optional confirmed email subscription receives demo messages and has separate usage costs.
4. **SQS → Create queue**: Standard `ticketing-poc-notification-service-dlq`, 14-day retention. Then create Standard `ticketing-poc-notification-service`, visibility 60 seconds, retention 4 days, receive wait 20 seconds, DLQ redrive after 5 receives.
5. For each of the four inbound event topics, **Create subscription → Amazon SQS**, choose the notification queue ARN, and enable **Raw message delivery**.
6. On the notification queue's **Access policy**, allow `sns.amazonaws.com` to call `sqs:SendMessage`, limited to this queue ARN and the four topic ARNs using `aws:SourceArn`. IAM task permissions alone do not authorize SNS delivery.
7. Set `SKIP_QUEUE_PROVISIONING=true`, the exact queue name and all five full topic ARNs in the notification task. Deploy that service only after subscriptions and its database exist.

See [MassTransit SQS/SNS configuration and IAM example](https://masstransit.io/documentation/configuration/transports/amazon-sqs). Test an actual published event reaching the consumer; an existing queue alone proves nothing.

## 8. Create ECS roles, logs and discovery

1. **IAM → Roles → Create role → AWS service → Elastic Container Service → Elastic Container Service Task**. Create execution role `ticketing-poc-ecs-execution-role`, trusted by `ecs-tasks.amazonaws.com`. Attach `AmazonECSTaskExecutionRolePolicy`, then an inline `secretsmanager:GetSecretValue` policy limited to the seven demo secret ARNs. Add `kms:Decrypt` only if using a customer-managed KMS key, scoped to it.
2. Create task role `ticketing-poc-ecs-task-role` with the same ECS trust principal. Grant the needed SQS and SNS topology/runtime actions to this sandbox's verified resources. Typical SQS actions include `CreateQueue`, `GetQueueUrl`, `GetQueueAttributes`, `SetQueueAttributes`, `ReceiveMessage`, `DeleteMessage`, `SendMessage`, `ChangeMessageVisibility`, `TagQueue`; SNS includes `CreateTopic`, `GetTopicAttributes`, `SetTopicAttributes`, `Subscribe`, `GetSubscriptionAttributes`, `SetSubscriptionAttributes`, `ListSubscriptionsByTopic`, `Publish`, `TagResource`. Check the installed MassTransit version's requirements and logged denials. Actions requiring `Resource: "*"` need separate statements; do not solve denials with account administrator access.
3. For an isolated, single-environment PoC, ARN scope `arn:aws:sqs:us-east-1:ACCOUNT:*` and `arn:aws:sns:us-east-1:ACCOUNT:*` can bootstrap unknown runtime names; this deliberately grants messaging access across that account/region. Replace with inventoried names/prefixes after verification. Prefer a separate, narrower role for Notification (`GetQueueUrl`, `GetQueueAttributes`, `ReceiveMessage`, `DeleteMessage`, `ChangeMessageVisibility`, and publish to its outbound topic).
4. **CloudWatch → Log groups → Create** `/ecs/ticketing-poc/<service>` for each application and Redis. Set retention to **3 days**. Use standard logs; leave Container Insights disabled initially.
5. **Cloud Map → Create namespace**: private DNS namespace `ticketing-poc.internal`, associated with the VPC. Services will register A records with 10-second TTL.
6. **ECS → Clusters → Create cluster**: `ticketing-poc-cluster`, Fargate; no EC2 capacity provider or EKS cluster required.

## 9. Register task definitions

For each application: **ECS → Task definitions → Create new task definition**. Choose Fargate, Linux/x86_64, `awsvpc`, 0.25 vCPU, 0.5 GB, execution/task roles above, one essential container, its ECR digest/tag, TCP port below, and the matching `awslogs` group/region/stream prefix. Keep the included 20 GB ephemeral storage. Start with one replica and increase memory only if logs/metrics show pressure.

Set `ASPNETCORE_ENVIRONMENT=Production` and `ASPNETCORE_HTTP_PORTS=<port>` for .NET services; `NODE_ENV=production` and `PORT=<port>` for Node services. All AWS clients use `AWS_REGION=us-east-1`; .NET messaging services also need `Messaging__Aws__Region=us-east-1`. Keep LocalStack URLs and test AWS credentials unset.

| Service / port | Additional configuration (case and spelling matter) |
| --- | --- |
| `gateway` / 5000 | `AUTH_SERVICE_URL=http://auth-service.ticketing-poc.internal:5001`; corresponding `CATALOG_SERVICE_URL` :5002, `TICKETING_SERVICE_URL` :5003, `ORDERS_SERVICE_URL` :5004, `PAYMENTS_SERVICE_URL` :5005; `REDIS_HOST=redis.ticketing-poc.internal`; `REDIS_PORT=6379`; `ALLOWED_ORIGINS=https://YOUR_DISTRIBUTION.cloudfront.net` once known |
| `auth-service` / 5001 | Secret `DATABASE_URL` from auth secret's `prismaUrl`; shared plain-text `JWT_SECRET` |
| `catalog` / 5002 | Secret `ConnectionStrings__catalogdb` from catalog secret's `connectionString` |
| `ticketing` / 5003 | Secret `ConnectionStrings__ticketingdb`; shared `JWT_SECRET` |
| `orders` / 5004 | Secret `ConnectionStrings__ordersdb`; shared `JWT_SECRET` |
| `payments` / 5005 | Secret `ConnectionStrings__paymentsdb`; `FakePaymentGateway__BaseUrl=http://fakepaymentgateway.ticketing-poc.internal:5006` |
| `fakepaymentgateway` / 5006 | No DB; keep it private; all payments here are simulated |
| `notification-service` / 5007 | Secret `DATABASE_URL` from notification secret's `prismaUrl`; `NOTIFICATION_QUEUE_NAME=ticketing-poc-notification-service`; `SKIP_QUEUE_PROVISIONING=true`; `TOPIC_ORDER_CONFIRMED`, `TOPIC_PAYMENT_SUCCEEDED`, `TOPIC_PAYMENT_FAILED`, `TOPIC_TICKET_CONFIRMED`, `TOPIC_NOTIFICATIONS_OUTBOUND` = their full SNS ARNs |
| `redis` / 6379 | Pinned Redis image; no published internet port; Redis SG; one task; no persistence required for counters |

In the container definition's **secrets**, a JSON key uses `arn:aws:secretsmanager:...:secret:NAME-SUFFIX:prismaUrl::` or `:connectionString::`. JWT uses the plain secret ARN. Use Fargate Linux platform **1.4.0 or later / LATEST** for JSON-key secret injection. A changed secret requires replacement tasks to load its new value.

Set the newly implemented `Demo__InitializeDatabase=true` for the first start of Catalog, Ticketing, Orders and Payments. After migrations and matching catalog/seat data are confirmed, register revisions setting it false and redeploy. Node entrypoints apply their committed Prisma migrations automatically. Migration failure is a deployment failure; inspect the log before retrying.

CloudWatch stdout logs are enough for this PoC. No OTLP collector is deployed here: do not point AWS containers at a laptop or `localhost:4318`. If the Node telemetry initialization continues attempting its localhost default, disable/export-configure that code before deployment or supply a reachable collector and price it separately.

## 10. Start backend services and connect the API

1. **EC2 → Target groups → Create**: target type **IP**, HTTP 5000, this VPC, health path `/health`, success 200. Leave targets empty; ECS registers task IPs.
2. **EC2 → Load balancers → Create Application Load Balancer**: name `ticketing-poc-internal-alb`, scheme **Internal**, both private subnets, ALB security group. Listener HTTP 80 forwards to the gateway target group.
3. For each service, **ECS → Cluster → Services → Create**: Fargate on demand, its task definition, desired tasks **1**, private subnets, public IP **Off**, task SG (Redis uses Redis SG), service discovery in `ticketing-poc.internal` with its exact short service name. Enable deployment failure detection/rollback. Attach the ALB/target group only to `gateway`, container port 5000; allow 120 seconds startup health grace.
4. Start Redis, Auth, Catalog, Ticketing, Orders, Payments and FakePaymentGateway. Start Gateway when dependencies are ready. Complete section 7's notification subscriptions and then start Notification. Wait for services to stabilize, migrations to finish and the ALB target to become healthy. Use [ECS console deployment guidance](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/create-service-console-v2.html).
5. **API Gateway → VPC links → Create** a link for **HTTP APIs**, both private subnets, VPC-link SG. Wait for **Available**.
6. **API Gateway → Create API → HTTP API**. Add a **private integration** using the VPC link and the ALB's **listener ARN**. Create `$default` route to it, `$default` stage, auto deploy. Map/overwrite the integration request path to `$request.path` if a named stage would otherwise be forwarded. Keep `/api/<service>/...` intact; YARP strips the prefix once. [Private integration instructions](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-private.html)
7. Add conservative stage throttles, for example rate 20 requests/second, burst 40. Use API access logs with short retention; do not log authorization headers or request bodies containing credentials. A throttle is not a billing cap.
8. Record the invoke URL. `/health` should respond 200 and `/api/catalog/events` should return the seeded events. The default execute-api URL is public: CloudFront WAF alone does not protect direct calls to it. Treat this as a controlled demo; before a public release implement origin restriction/authorization rather than claiming WAF cannot be bypassed.

## 11. Publish the frontend and HTTPS edge

Use **one CloudFront domain** for both the SPA and `/api/*` to simplify browser routing.

1. Build the frontend locally from repo root:

```bash
npm --prefix apps/frontend ci
VITE_API_BASE_URL='' npm --prefix apps/frontend run build
```

2. **S3 → Create bucket**: unique name such as `ticketing-poc-web-ACCOUNT-REGION`, same region, Block Public Access **On**, ACLs disabled, SSE-S3 encryption. Keep static website hosting **off**. Upload the **contents** of `apps/frontend/dist/` at bucket root, including `index.html` and `assets/`.
3. **CloudFront → Create distribution**: choose standard/pay-as-you-go pricing for this worksheet, S3 **REST** origin, **Origin Access Control**, sign requests. After creation, copy the generated bucket policy into **S3 → Permissions → Bucket policy**; it must allow only this distribution's ARN to read objects. Do not make the bucket public. [S3/OAC instructions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
4. Default root object `index.html`; default behavior goes to S3, GET/HEAD, redirect HTTP to HTTPS. Use the included `*.cloudfront.net` hostname/certificate; a domain purchase and ACM setup are unnecessary for a demo.
5. Add a second custom origin: API Gateway hostname **without** `https://`, path or trailing slash; origin protocol HTTPS only.
6. Add behavior `/api/*` **above default**: API origin; all seven HTTP methods; managed cache policy **CachingDisabled**; managed origin request policy **AllViewerExceptHostHeader**. This forwards authorization, idempotency, correlation, query strings and browser headers while letting API Gateway receive its own Host header. Add `/health` behavior with the same origin/no-cache policy for diagnostics. [Managed origin request policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html)
7. For SPA deep links, **CloudFront → Functions → Create function**, JavaScript runtime 2.0, paste this, save, test, publish, and associate **viewer request on the S3 default behavior only**:

```javascript
function handler(event) {
  var request = event.request;
  if (request.uri.indexOf('.') === -1) request.uri = '/index.html';
  return request;
}
```

8. Do not use distribution-wide 403/404 → 200 SPA error rewrites; they can hide legitimate API errors. Test refreshing `/login` and an event detail route while invalid API routes still return errors.
9. **WAF → Web ACLs → Create**, scope **CloudFront (Global)** in `us-east-1`; add AWS managed Common Rule Set and an IP rate rule (for example 2,000/5 minutes); associate it with the distribution. Avoid paid Bot Control/Marketplace groups for this estimate. Test login and JSON checkout bodies for false positives before the demo.
10. Register a new Gateway task revision with the actual `ALLOWED_ORIGINS=https://DISTRIBUTION.cloudfront.net`, redeploy, and wait for CloudFront status **Deployed**. If cross-origin hosting is chosen instead, explicitly allow the frontend origin and forward CORS headers; do not use wildcard origins with credentials.

CloudFront now also offers flat-rate plans; this worksheet uses separately billed resources to match the existing modules. Re-estimate if choosing a plan that bundles WAF/S3/other services, rather than adding bundled and standalone prices together. [CloudFront plans](https://aws.amazon.com/cloudfront/pricing/)

## 12. Prove that the demo works

1. Open the CloudFront HTTPS URL, refresh a deep link and inspect the browser Network tab. No requests should target localhost, private Cloud Map names or HTTP mixed-content URLs.
2. Register/login with a synthetic user. Confirm catalog events and seats appear for `11111111-1111-1111-1111-111111111111` and the second seeded event.
3. Reserve a seat, submit an order with the UI's idempotency keys and use simulated successful payment. The order should reach the saga's `Completed` state. Follow the same correlation ID in Orders, Payments, Ticketing and Notification logs.
4. Confirm the notification queue drains and its `processed_messages` table records the event. A subscriber on `notifications-outbound` is optional; this demo is not a real email/payment integration.
5. In two browser sessions, reserve the same seat: one succeeds and the other receives a conflict. Retry a request with the same idempotency key; it must not create another reservation/payment.
6. Exercise simulated declined/timeout payment and reservation release; confirm the compensation path and `Cancelled` outcome where expected. Verify notification/DLQ behavior without leaving deliberately poisoned messages behind.
7. Keep two event pages open: long-poll requests should return/reconnect and seat updates should arrive. A successful checkout does not prove live updates work.
8. Confirm all nine tasks are stable, RDS CPU/memory are reasonable, no `_error`/DLQ backlog grows, and logs do not contain `test` credential failures, repeated migration errors or localhost telemetry spam.

| Symptom | Check first |
| --- | --- |
| `CannotPullContainerError` / `exec format error` | ECR URI/digest, execution role, NAT routes, Linux/amd64 image |
| Secret initialization failure | Execution role, full secret ARN including JSON key, KMS access, networking |
| ALB unhealthy / API 503 | Production `/health`, container port 5000, SGs, startup logs |
| Missing connection string / relation not found | `ConnectionStrings__...db`, DB creation and Production migration step |
| AWS invalid token / messages never arrive | Static `test` credentials, actual topology names, task IAM, SNS queue policy/raw delivery |
| Payment tries localhost | `FakePaymentGateway__BaseUrl` spelling |
| Frontend 403 / deep-link failure | OAC bucket policy, `index.html`, function association |
| Browser CORS / 401 | Exact origin, forwarded Authorization, same JWT secret, expired token |
| Checkout works but live updates fail | Explicit Long Polling, 20-second poll timeout, `/api/*` query/header forwarding |

## 13. Update, roll back and delete

For a new release, publish new immutable image tags/digests, register task revisions and update the ECS services. Keep the previous revision/image for rollback. Upload frontend assets before `index.html`; invalidate `/index.html` in CloudFront. A database migration may be incompatible with an old image: review migration compatibility and take a snapshot before changes to data you need to keep.

After a disposable demonstration, use this deletion order:

1. Save only logs/data you need. Deleting RDS without a final snapshot loses the demo data. Retained snapshots cost money.
2. Disable CloudFront, wait for deployment, then delete it; remove its WAF association/ACL and function/OAC when no longer referenced.
3. Delete the API/stages and VPC link. Scale ECS services to zero, delete services, wait for tasks/ENIs to disappear, and delete the cluster. Deregister obsolete task definitions.
4. Delete the internal ALB, listener and target group.
5. Delete all six RDS instances, choosing deliberately whether to retain automated backups/final snapshots, then delete subnet groups once free.
6. Delete demo SNS subscriptions/topics and SQS queues **including runtime-created MassTransit `_error`/`_skipped` queues**. Use your inventory; never delete another environment's resources.
7. Delete Cloud Map services after instances deregister, then its namespace. Empty/delete frontend S3 bucket (including versions if enabled). Delete ECR repositories/images, logs and unneeded secrets; scheduled-deletion secrets can prevent immediate name reuse.
8. Delete the NAT gateway and **release its Elastic IP**, then delete residual endpoints/ENIs, security groups, route tables, subnets, internet gateway and VPC. Remove the demo IAM roles/policies after tasks stop.
9. Review **Billing → Bills / Cost Explorer** by service and region the next day, and inspect remaining RDS snapshots, S3 versions, ECR images, public IPv4 addresses and CloudWatch logs. Billing data is delayed; an empty ECS cluster is not proof of zero spend.

If you deployed with Terraform, use the companion guide's destroy flow instead of manually deleting Terraform-managed resources.
