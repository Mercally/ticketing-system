# Publish the ticketing demo with AWS CLI and the existing Terraform

Reviewed **2026-09-28**. This is the terminal companion to [the AWS console guide](AWS-CONSOLE-DEPLOYMENT.md). Commands use Bash on macOS/Linux and run from the repository root unless stated otherwise.

**Recommended use: deploy for a demonstration and destroy the environment the same day.** Allow **$10–15 for 24 hours**, or **$240–300/month** for the completed ECS/RDS layout under light traffic. The full assumptions, unit-price calculations, cost controls and cheaper hosting comparison are in the [cost worksheet](AWS-CONSOLE-DEPLOYMENT.md#1-choose-the-budget-before-creating-resources). The worksheet assumes nine small Fargate tasks including Redis, six Single-AZ PostgreSQL databases, one NAT, one internal ALB, HTTP API, CloudFront/S3, WAF and short-retention logs. These are estimates before taxes and credits, not a spending limit.

An always-on **$45–60/month** Lightsail/container variant is a separate design, **not a `terraform.tfvars` option supported by this repository**. The $44/month 8 GB Lightsail base bundle is documented by [AWS](https://aws.amazon.com/lightsail/pricing/). Consolidating databases or moving to one VM needs explicit infrastructure work and changes the failure/isolation model. For the least implementation effort with the current architecture, use short-lived ECS deployments.

## 1. Understand what is ready and what is missing

Use [infrastructure/terraform](../infrastructure/terraform/) for real AWS. **Do not apply [infrastructure/aws-local](../infrastructure/aws-local/)** to a real account: it is a separate LocalStack root/state/provider.

The AWS root currently includes VPC/NAT, five RDS instances, SNS/SQS, Secrets Manager, eight ECS services, Cloud Map, an internal ALB, HTTP API and an API-only CloudFront/WAF distribution. Images are placeholder URIs. It has no remote backend, frontend hosting, Redis or notification database. Several task variables do not match the current application.

`terraform validate` passed during this documentation review. **No AWS plan, apply, image build, migration or end-to-end AWS deployment was run.** Validation does not detect runtime configuration mismatches or prove that AWS will accept the first plan. The steps below deliberately include a preparation gate before `apply`; the described patches/additions are instructions, not changes already installed by this documentation task.

## 2. Set up tools, identity and budget

Install AWS CLI v2, Terraform **1.10 or newer** (needed for S3-native state locking below; the repository itself permits 1.9), Docker/Buildx, Git, jq, Node.js compatible with the lockfiles, and .NET 10 SDK for application preparation. Keep the existing AWS provider `~> 5.0` lockfile unless intentionally testing an upgrade.

```bash
# Run these in Bash from the repository root.
aws --version
terraform version
docker buildx version
jq --version
node --version
dotnet --version

aws configure sso --profile ticketing-poc
aws sso login --profile ticketing-poc
export AWS_PROFILE=ticketing-poc
export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION="$AWS_REGION"

# Clear local emulation overrides/static credentials before choosing the SSO profile.
unset AWS_ENDPOINT_URL AWS_ENDPOINT_URL_SQS AWS_ENDPOINT_URL_SNS
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
aws sts get-caller-identity
export ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export PREFIX=ticketing-poc
export REGISTRY="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
```

Confirm the printed account is the dedicated sandbox, not production. Inspect the selected AWS profile for any additional LocalStack endpoint settings. Use the IAM permissions and quota checklist in [console prerequisites](AWS-CONSOLE-DEPLOYMENT.md#2-account-and-workstation-prerequisites). Steady state needs 2.25 Fargate vCPUs; allow deployment overlap (at least 6 vCPUs for this example). Use an assumed/SSO role, not root or committed access keys.

Create a cost budget through CLI, replacing the email before running:

```bash
export BUDGET_EMAIL='replace-with-your-email@example.com'
umask 077
mkdir -p /tmp/ticketing-poc-deploy
cat > /tmp/ticketing-poc-deploy/budget.json <<'JSON'
{
  "BudgetName": "ticketing-poc-monthly",
  "BudgetLimit": { "Amount": "25", "Unit": "USD" },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST"
}
JSON
jq -n --arg email "$BUDGET_EMAIL" '
  [50,80,100] | map({
    Notification: {NotificationType:"ACTUAL", ComparisonOperator:"GREATER_THAN",
      Threshold:., ThresholdType:"PERCENTAGE"},
    Subscribers:[{SubscriptionType:"EMAIL", Address:$email}]
  })' > /tmp/ticketing-poc-deploy/budget-notifications.json
aws budgets create-budget --account-id "$ACCOUNT_ID" \
  --budget file:///tmp/ticketing-poc-deploy/budget.json \
  --notifications-with-subscribers file:///tmp/ticketing-poc-deploy/budget-notifications.json
```

Use $300 instead of $25 if deliberately running the ECS layout for a month. This example budget measures the whole sandbox account; existing spending counts too. If the budget already exists, inspect/update it rather than creating duplicates. Alerts are delayed notifications, not an automatic shutdown.

## 3. Complete application preparation before building images

Follow every item in the [application preparation table](AWS-CONSOLE-DEPLOYMENT.md#3-required-application-preparation--do-this-before-paying-for-aws). In particular:

1. Fix real-AWS messaging credentials. In `building-blocks/messaging/MessagingExtensions.cs`, call `h.AccessKey`/`h.SecretKey` only for the LocalStack branch with a nonempty `ServiceUrl`; the real-AWS branch should leave credentials to the ECS task-role provider. Bind `Messaging__Aws__Region`; the options class does not read `AWS_REGION` directly. Never inject the default `test` credentials into real AWS.
2. Make the ALB's `/health` endpoint available in Production in `aspire/ServiceDefaults/Extensions.cs`.
3. Implement explicit demo bootstrap/migration behavior for the four EF services. A suggested `Demo__InitializeDatabase` flag is **new code to add**, not a currently supported setting. Keep the application in Production and leave OpenAPI/developer middleware out of that bootstrap condition. Node images already run Prisma migrations in their entrypoints.
4. Implement the documented SignalR Long Polling client option and 20-second server poll timeout for the HTTP API route. Without this, do not promise working live seat updates.
5. Capture actual MassTransit topic/queue names and subscriptions from a functioning local run, including error/skipped queues. Test a successful and failed checkout. Preserve that inventory for IAM and cleanup. The SNS names guessed in `modules/sqs_sns/variables.tf` are not verified runtime names.
6. Decide how to handle Node OTLP export defaults: CloudWatch stdout logs are sufficient for this demo, but a localhost collector is unavailable in ECS. Disable the unused export in application setup or provide a real endpoint and price it.

There is no universal AWS CLI command that fixes these application issues. Do not start paid infrastructure and attempt to mask them by setting every service to Development.

## 4. Prepare the existing Terraform root

Make these changes in a deployment branch, review them, then run `fmt`/`validate`. They retain the existing modules and fill their missing inputs. Do not add `.tfvars` variables that the root does not declare: most cost knobs currently exist only inside child modules.

### 4.1 Database, service and cost settings

In root `variables.tf`, declare a required `db_engine_version` string, and in root `main.tf` pass this explicit `databases` map to `module "rds"`:

```hcl
databases = {
  auth         = { engine_version = var.db_engine_version }
  catalog      = { engine_version = var.db_engine_version }
  ticketing    = { engine_version = var.db_engine_version }
  orders       = { engine_version = var.db_engine_version }
  payments     = { engine_version = var.db_engine_version }
  notification = { engine_version = var.db_engine_version }
}
```

This uses the module's 20 GB / `db.t4g.micro` defaults and adds the required sixth instance. Set `storage_type = "gp3"` explicitly on `aws_db_instance.this` if using the worksheet's gp3 estimate. Keep Single-AZ and review backups/deletion behavior: the current module sets `skip_final_snapshot=true` and `deletion_protection=false`, so destroy deletes database contents without a final snapshot.

In root `local.services`, make these exact changes:

| Entry | Change |
| --- | --- |
| `catalog.secretArns` | Rename `ConnectionStrings__catalog` to `ConnectionStrings__catalogdb` |
| `ticketing.secretArns` | Rename to `ConnectionStrings__ticketingdb` |
| `orders.secretArns` | Rename to `ConnectionStrings__ordersdb` |
| `payments.secretArns` | Rename to `ConnectionStrings__paymentsdb` |
| `payments.env` | Replace `FAKE_PAYMENT_GATEWAY_URL` with `FakePaymentGateway__BaseUrl`, keeping the private service URL |
| `notification-service.secretArns` | Add `DATABASE_URL = "${module.secrets.db_secret_arns["notification"]}:prismaUrl::"` |
| `gateway.env` | Add `REDIS_HOST = "redis.${local.internal_dns_suffix}"`, `REDIS_PORT = "6379"` |
| `common_env` | Add `Messaging__Aws__Region = var.aws_region`; do not add static AWS credentials or LocalStack endpoint overrides |

Add `SSL Mode=Require` to the Npgsql strings and `sslmode=require` to Prisma URLs generated in `modules/secrets/main.tf`; validate TLS against RDS. The current random alphanumeric passwords avoid URL escaping issues.

Add Redis to the same `local.services` map:

```hcl
redis = {
  image      = var.service_images["redis"]
  port       = 6379
  env        = {}
  secretArns = {}
}
```

The ECS module already creates DNS entries and task definitions from this map; this produces `redis.ticketing-poc.internal`. It uses the shared private task SG, which permits self-traffic. No database/Redis port should be publicly accessible. For tighter isolation use a dedicated Redis SG as described in the console guide.

Pass `log_retention_days = 3` into `module "ecs"`, change its cluster `containerInsights` setting to `disabled`, and explicitly pass `single_nat_gateway = true` into `module "vpc"`. Leave one task per service and default 256 CPU / 512 MB initially. Do not remove NAT while tasks depend on it for ECR, Secrets Manager, logs and AWS messaging APIs.

Add a root boolean `demo_initialize_database`, default false, and inject `Demo__InitializeDatabase = tostring(var.demo_initialize_database)` only into the four EF services after implementing the application flag. Set it true for first initialization and false after the initial deployment succeeds.

### 4.2 First-plan IAM attachment and ECS ordering fixes

`modules/ecs/main.tf` currently uses `for_each = toset(var.*_extra_policy_arns)`. Policy ARNs are unknown until the first apply, so Terraform cannot use them as set-instance keys. In **both** the execution and task extra-policy attachment resources, use stable keys instead, for example:

```hcl
# execution_extra
for_each = { for i, arn in var.execution_role_extra_policy_arns : tostring(i) => arn }
# task_extra uses the same form with var.task_role_extra_policy_arns.
# Keep policy_arn = each.value.
```

On `aws_ecs_service.this`, add explicit `depends_on` for `aws_lb_listener.gateway_http`, `aws_iam_role_policy_attachment.execution_managed`, `execution_extra`, and `task_extra`. This ensures the listener and role policies are provisioned before service startup. Add deployment circuit breaker `{ enable = true, rollback = true }`; set gateway health grace to 120 seconds (and zero for services without the ALB). Set an explicit Linux/X86_64 runtime platform in task definitions to match the builds.

### 4.3 Messaging ownership and permissions

Use **runtime-created .NET transport queues** for this PoC, and **Terraform-managed Notification queue/DLQ/subscriptions**. This follows the current `ConfigureEndpoints` application behavior and avoids pretending one guessed queue per service is sufficient. It means `terraform destroy` will not automatically delete every runtime-created queue/topic.

1. Declare root `notification_topics` as a map of four verified topic **names**, with keys `order_confirmed`, `payment_succeeded`, `payment_failed`, `ticket_confirmed`.
2. Override the existing messaging module's `topics` and `subscriptions` inputs:

```hcl
topics = distinct(concat(values(var.notification_topics), ["notifications-outbound"]))
subscriptions = {
  notification-service = { topics = values(var.notification_topics) }
}
```

3. Add Notification environment values:

```hcl
NOTIFICATION_QUEUE_NAME       = "${local.name_prefix}-notification-service"
SKIP_QUEUE_PROVISIONING       = "true"
TOPIC_ORDER_CONFIRMED         = module.sqs_sns.topic_arns[var.notification_topics["order_confirmed"]]
TOPIC_PAYMENT_SUCCEEDED       = module.sqs_sns.topic_arns[var.notification_topics["payment_succeeded"]]
TOPIC_PAYMENT_FAILED          = module.sqs_sns.topic_arns[var.notification_topics["payment_failed"]]
TOPIC_TICKET_CONFIRMED         = module.sqs_sns.topic_arns[var.notification_topics["ticket_confirmed"]]
TOPIC_NOTIFICATIONS_OUTBOUND   = module.sqs_sns.topic_arns["notifications-outbound"]
```

4. Expand root `messaging_access` to cover the topology/runtime APIs and actual .NET entities listed in [console IAM setup](AWS-CONSOLE-DEPLOYMENT.md#8-create-ecs-roles-logs-and-discovery). Its current restricted `module.sqs_sns.resource_arns` list does not cover runtime queues, other command/event topics or `_error`/`_skipped` entities. Use an inventoried ARN allowlist, or deliberately scope bootstrap permissions to SQS/SNS in this isolated account/region and tighten them after verification. Do not use AdministratorAccess on a task role.
5. Terraform and MassTransit can refer to the same already-existing event topics, but their names/attributes must agree. Do not let two owners change the same queue's subscriptions or redrive settings. Explicitly enumerate the resources Terraform owns versus runtime resources in your deployment inventory. See [MassTransit transport/IAM documentation](https://masstransit.io/documentation/configuration/transports/amazon-sqs).

### 4.4 Frontend and CloudFront additions

The current `cloudfront_waf` module forwards every request to API Gateway and has no frontend bucket. Extend **that module**, keeping its WAF resource, with these resources and behavior changes. This specification is required implementation work before the commands in section 9; it is not already present.

| Terraform resource/change | Required settings |
| --- | --- |
| `aws_s3_bucket.web` | Globally unique bucket or `bucket_prefix`; same region; use SSE-S3; do not enable website hosting |
| `aws_s3_bucket_public_access_block.web` | All four block/restrict booleans true |
| `aws_s3_bucket_ownership_controls.web` | `BucketOwnerEnforced` |
| `aws_cloudfront_origin_access_control.web` | Origin type `s3`, signing behavior `always`, protocol `sigv4` |
| Existing distribution's new `web` origin | Bucket `bucket_regional_domain_name`, OAC ID; retain its existing HTTPS API origin |
| Existing distribution's default behavior | S3 `web` origin, GET/HEAD, redirect HTTPS, managed `CachingOptimized`; default root object `index.html` |
| Ordered `/api/*` and `/health` behaviors | Existing API origin; all seven methods for `/api/*`; managed `CachingDisabled` and `AllViewerExceptHostHeader`; redirect HTTPS; no legacy `forwarded_values` in these managed-policy behaviors |
| S3 bucket policy | Principal `cloudfront.amazonaws.com`, action `s3:GetObject`, resource `${bucket.arn}/*`, `AWS:SourceArn` equals **this** distribution ARN |
| `aws_cloudfront_function.spa` | Runtime `cloudfront-js-2.0`, published; the viewer-request function from console section 11; associate **only with default S3 behavior** |
| Module outputs | Add `frontend_bucket_name` and `distribution_id`; retain `distribution_domain_name` |
| Root outputs | Expose `frontend_bucket_name = module.cloudfront_waf.frontend_bucket_name`, `cloudfront_distribution_id = module.cloudfront_waf.distribution_id` |

Use Terraform `aws_cloudfront_cache_policy` / `aws_cloudfront_origin_request_policy` data sources by names `Managed-CachingOptimized`, `Managed-CachingDisabled`, and `Managed-AllViewerExceptHostHeader`. The existing legacy header allowlist omits browser/CORS headers. The new managed policy forwards them and Authorization while excluding the viewer Host header expected to differ from API Gateway. [AWS policy documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html)

Use [the console guide's exact SPA function and OAC setup](AWS-CONSOLE-DEPLOYMENT.md#11-publish-the-frontend-and-https-edge) as the behavior reference. Do not add a global error-response rewrite that turns API 403/404 responses into the SPA.

Do **not** set `gateway.env.ALLOWED_ORIGINS` from a computed CloudFront output: ECS → CloudFront → ECS would create a Terraform dependency cycle. Instead declare a root `allowed_origins` string with empty default, pass it into Gateway, then fill it with the known CloudFront URL and apply again after initial creation. Use a literal variable value on the second apply.

Add modest HTTP API stage throttling (for example 20 requests/second, burst 40). With `$default` stage the current route avoids a named stage prefix; explicitly mapping integration `overwrite:path = "$request.path"` also prevents accidental stage-prefix forwarding if you later add named stages. The execute-api endpoint remains publicly reachable; WAF on CloudFront is not an origin-access restriction.

### 4.5 Preparation acceptance gate

Before continuing, the prepared root must have all of these properties:

- Six database keys and seven secrets; exact application environment keys; no LocalStack credentials/endpoints.
- Nine service keys including Redis; known real image references; migration/bootstrap behavior and Production health checks implemented.
- Stable IAM attachment `for_each` keys, runtime messaging IAM and explicitly owned messaging topology.
- Private S3 SPA origin/OAC, uncached `/api/*` behavior, published SPA routing function and the two new root outputs.
- Supported regional PostgreSQL version, one NAT, Single-AZ RDS, one task/service, short log retention, no Container Insights.
- No cyclic dependency from Gateway to CloudFront. No unsatisfied placeholders in any policy or image URI.

**Stop here if any item remains incomplete.** Applying the unchanged scaffold can create billable resources without a working demo.

## 5. Create ECR repositories and publish immutable images

Only after application preparation passes, build the eight application images from the repository root. `poc-001` must be new for an immutable repository; increment it for rebuilds.

```bash
export IMAGE_TAG=poc-001
services=(gateway auth-service catalog ticketing orders payments fakepaymentgateway notification-service)

aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin "$REGISTRY"

for service in "${services[@]}" redis; do
  aws ecr create-repository --repository-name "ticketing/$service" \
    --image-tag-mutability IMMUTABLE \
    --image-scanning-configuration scanOnPush=true
done

for service in "${services[@]}"; do
  docker buildx build --platform linux/amd64 \
    -f "infrastructure/docker/$service.Dockerfile" \
    -t "$REGISTRY/ticketing/$service:$IMAGE_TAG" --push . || break
done
```

On a repeat deployment skip creation of repositories that already exist after inspecting their configuration; do not hide authorization/network errors as “already exists.” A failed image build stops progress—verify all eight images, rather than assuming the loop finished. On Apple Silicon, `--platform linux/amd64` is intentional. [ECR push workflow](https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-push-ecr-image.html)

Choose an approved Redis 7 image tag/digest, then mirror it:

```bash
export REDIS_SOURCE='redis:7-alpine' # Resolve/review its digest; record it for reproducibility.
docker pull --platform linux/amd64 "$REDIS_SOURCE"
docker tag "$REDIS_SOURCE" "$REGISTRY/ticketing/redis:$IMAGE_TAG"
docker push "$REGISTRY/ticketing/redis:$IMAGE_TAG"

for service in "${services[@]}" redis; do
  aws ecr describe-images --repository-name "ticketing/$service" \
    --image-ids imageTag="$IMAGE_TAG" \
    --query 'imageDetails[0].{Digest:imageDigest,Size:imageSizeInBytes}'
done
```

Set an ECR lifecycle policy retaining a few previous images for rollback. ECR private storage is usage-based (AWS's example uses $0.10/GB-month); image storage remains after ECS teardown. [ECR pricing](https://aws.amazon.com/ecr/pricing/)

## 6. Configure a protected Terraform state backend

The root currently has **no backend block**; `-backend-config` alone does not add one. State contains generated database passwords/JWT values even when Terraform marks outputs sensitive. Keep it out of Git and CI logs. Do not reuse the LocalStack state.

For repeatable deployments use a separate state bucket, created once outside the app root so app destroy cannot delete it:

```bash
export STATE_BUCKET="ticketing-poc-tfstate-$ACCOUNT_ID-$AWS_REGION"
# This command shape is for us-east-1. Other regions require LocationConstraint.
aws s3api create-bucket --bucket "$STATE_BUCKET" --region "$AWS_REGION"
aws s3api put-public-access-block --bucket "$STATE_BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket "$STATE_BUCKET" \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$STATE_BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

If already created by this deployment, inspect/reuse it. Add `infrastructure/terraform/backend.tf` containing:

```hcl
terraform {
  backend "s3" {}
}
```

Create private backend settings outside the repository:

```bash
cat > /tmp/ticketing-poc-deploy/backend.hcl <<EOF
bucket       = "$STATE_BUCKET"
key          = "ticketing/poc/terraform.tfstate"
region       = "$AWS_REGION"
encrypt      = true
use_lockfile = true
EOF

terraform -chdir=infrastructure/terraform init \
  -backend-config=/tmp/ticketing-poc-deploy/backend.hcl
```

Grant the deployment role only the necessary access to this bucket/key and `.tflock` object. Use `init -migrate-state` if deliberately moving existing **real-AWS** local state after backing it up; do not use `-reconfigure` to abandon an existing deployment accidentally. Use Terraform 1.10+ for S3 locking; DynamoDB locking is deprecated. [HashiCorp S3 backend documentation](https://developer.hashicorp.com/terraform/language/backend/s3)

## 7. Create the deployment inputs

First query regional PostgreSQL availability:

```bash
aws rds describe-db-engine-versions --engine postgres \
  --query "DBEngineVersions[?starts_with(EngineVersion, '16.')].EngineVersion" --output table
export DB_ENGINE_VERSION='REPLACE_WITH_OFFERED_16_MINOR'
aws rds describe-orderable-db-instance-options --engine postgres \
  --engine-version "$DB_ENGINE_VERSION" --db-instance-class db.t4g.micro \
  --query 'OrderableDBInstanceOptions[].{Class:DBInstanceClass,Version:EngineVersion,Storage:StorageType}'
```

Use a version with orderable `db.t4g.micro`/selected storage options; do not rely on the scaffold's `16.4` default. Keep the AZ list in the same region.

Generate image inputs using **digests**, then add the preparation variables. This writes a `.tfvars.json` file; the repository's `*.tfvars` ignore rule does **not** cover `*.tfvars.json`, so keep this one outside the repository too:

```bash
images='{}'
for service in "${services[@]}" redis; do
  digest="$(aws ecr describe-images --repository-name "ticketing/$service" \
    --image-ids imageTag="$IMAGE_TAG" --query 'imageDetails[0].imageDigest' --output text)"
  [[ "$digest" == sha256:* ]] || { echo "Missing image for $service"; break; }
  images="$(jq --arg key "$service" --arg uri "$REGISTRY/ticketing/$service@$digest" \
    '. + {($key):$uri}' <<< "$images")"
done
[[ "$(jq 'length' <<< "$images")" -eq 9 ]] || { echo 'All 9 images are required'; exit 1; }

jq -n --arg region "$AWS_REGION" --arg version "$DB_ENGINE_VERSION" --argjson images "$images" '{
  aws_region:$region, name_prefix:"ticketing", environment:"poc",
  azs:["us-east-1a","us-east-1b"], service_images:$images,
  db_engine_version:$version, demo_initialize_database:true, allowed_origins:"",
  notification_topics:{
    order_confirmed:"REPLACE_WITH_VERIFIED_TOPIC_NAME",
    payment_succeeded:"REPLACE_WITH_VERIFIED_TOPIC_NAME",
    payment_failed:"REPLACE_WITH_VERIFIED_TOPIC_NAME",
    ticket_confirmed:"REPLACE_WITH_VERIFIED_TOPIC_NAME"
  },
  tags:{Project:"global-ticketing-platform", Environment:"poc"}
}' > /tmp/ticketing-poc-deploy/poc.tfvars.json
```

Edit the four topic names to the verified local inventory. `db_engine_version`, `notification_topics`, `demo_initialize_database` and `allowed_origins` are the **new root inputs you added in section 4**; they will not work on the unchanged root. Never place secret values in this file.

## 8. Validate, inspect the plan and apply

```bash
terraform -chdir=infrastructure/terraform fmt -check -recursive
terraform -chdir=infrastructure/terraform validate

terraform -chdir=infrastructure/terraform plan \
  -var-file=/tmp/ticketing-poc-deploy/poc.tfvars.json \
  -out=/tmp/ticketing-poc-deploy/create.tfplan
```

Inspect the plan, including additions caused by preparation. Expect six RDS instances, nine ECS services/tasks, one NAT/EIP, one internal ALB, one HTTP API/VPC link, one CloudFront distribution/WAF ACL, private S3 frontend hosting, seven secrets, and the verified Notification messaging resources. There should be no EKS cluster, unexpected public database, Multi-AZ RDS, duplicate NAT per AZ, unexplained replacement/destruction, or placeholder image.

Save/review an [AWS Pricing Calculator](https://calculator.aws/) estimate using the [cost worksheet](AWS-CONSOLE-DEPLOYMENT.md#1-choose-the-budget-before-creating-resources). Terraform's plan does not show the bill. Only after the plan and cost match your intent:

```bash
terraform -chdir=infrastructure/terraform apply /tmp/ticketing-poc-deploy/create.tfplan
terraform -chdir=infrastructure/terraform output
```

Allow time for RDS, VPC link and CloudFront creation. Do not mark the deployment healthy merely because apply exits successfully; the existing ECS resource does not by itself prove the checkout works.

If apply partially fails, retain the state and inspect the error. Fix the cause and make a fresh full plan, or destroy the partially created environment. Avoid routinely applying with `-target`: it can omit dependencies and leave an incomplete billable environment. A first-plan “unknown for_each keys” failure points to section 4.2, not a reason to bypass the graph.

## 9. Upload the SPA and finalize runtime configuration

After the frontend resources and outputs described in section 4.4 exist:

```bash
export WEB_BUCKET="$(terraform -chdir=infrastructure/terraform output -raw frontend_bucket_name)"
export DISTRIBUTION_ID="$(terraform -chdir=infrastructure/terraform output -raw cloudfront_distribution_id)"
export EDGE_HOST="$(terraform -chdir=infrastructure/terraform output -raw cloudfront_domain_name)"
export APP_URL="https://$EDGE_HOST"

npm --prefix apps/frontend ci
VITE_API_BASE_URL='' npm --prefix apps/frontend run build

# Upload assets first, then the entry point. Preserve previous hashed assets for rollback.
aws s3 sync apps/frontend/dist/ "s3://$WEB_BUCKET/" --exclude index.html \
  --cache-control 'public,max-age=31536000,immutable'
aws s3 cp apps/frontend/dist/index.html "s3://$WEB_BUCKET/index.html" \
  --content-type text/html --cache-control 'no-cache'

aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths '/index.html'
aws cloudfront wait distribution-deployed --id "$DISTRIBUTION_ID"
```

Vite substitutes `VITE_API_BASE_URL` **at build time**. The empty string intentionally produces same-origin `/api/...` calls through the CloudFront API behavior; a runtime container variable would not fix an already built bundle. Never set a browser URL to a Cloud Map/private hostname.

After checking database initialization logs/data, update the input file atomically to set the literal browser origin and disable the newly implemented bootstrap flag:

```bash
jq --arg origin "$APP_URL" \
  '.allowed_origins=$origin | .demo_initialize_database=false' \
  /tmp/ticketing-poc-deploy/poc.tfvars.json > /tmp/ticketing-poc-deploy/next.tfvars.json
mv /tmp/ticketing-poc-deploy/next.tfvars.json /tmp/ticketing-poc-deploy/poc.tfvars.json

terraform -chdir=infrastructure/terraform plan \
  -var-file=/tmp/ticketing-poc-deploy/poc.tfvars.json \
  -out=/tmp/ticketing-poc-deploy/finalize.tfplan
terraform -chdir=infrastructure/terraform apply /tmp/ticketing-poc-deploy/finalize.tfplan
```

Do not disable bootstrap until schema creation and catalog/seat seeding succeeded. Restarting/redeploying tasks is required to refresh injected environment/secrets. Keep Node's automatic committed migration deployment behavior.

## 10. Verify the running deployment

```bash
export CLUSTER="$(terraform -chdir=infrastructure/terraform output -raw ecs_cluster_id)"
service_arns="$(aws ecs list-services --cluster "$CLUSTER" --query serviceArns --output text)"
# Deliberate word splitting: the API takes up to 10 ARNs and this layout has 9 services.
aws ecs wait services-stable --cluster "$CLUSTER" --services $service_arns
aws ecs describe-services --cluster "$CLUSTER" --services $service_arns \
  --query 'services[].{Name:serviceName,Desired:desiredCount,Running:runningCount,Events:events[0:3]}'

curl --fail-with-body "$APP_URL/health"
curl --fail-with-body "$APP_URL/api/catalog/events"
aws logs tail /ecs/ticketing-poc/gateway --since 10m
aws logs tail /ecs/ticketing-poc/orders --since 10m
aws logs tail /ecs/ticketing-poc/notification-service --since 10m
```

If `services-stable` times out, inspect service events and stopped task reasons before retrying. Look for secret injection, ECR pull, architecture, database, IAM and ALB health failures. An empty service list is a deployment problem, not a successful wait.

Run **all** [end-to-end acceptance checks](AWS-CONSOLE-DEPLOYMENT.md#12-prove-that-the-demo-works): browser signup/login, seeded events/seats, successful order through `Completed`, conflict/idempotency behavior, failed payment compensation, notification consumption, and live seat updates in two sessions. Verify the browser uses HTTPS/same-origin requests and refreshes deep links correctly.

Record AWS runtime-created messaging resources now:

```bash
aws sns list-topics > /tmp/ticketing-poc-deploy/topics-after.json
aws sqs list-queues > /tmp/ticketing-poc-deploy/queues-after.json
```

Compare against an account inventory captured before deployment if the sandbox was not empty. Record exact ARNs/URLs and ownership; do not infer ownership solely from names because current MassTransit names are not environment-prefixed. Check Notification receives real events and that error/DLQ queues are empty. Use the console guide's troubleshooting table for common failures.

## 11. Update, rollback and stop costs

For a release, build new immutable tags, update the image digest map, review/apply a fresh plan, upload frontend assets then `index.html`, and invalidate the entry point. To roll back application code, restore previous image digests and compatible frontend assets and apply again. Database migrations require a separate compatibility/restore decision; an ECS rollback does not undo schema/data changes.

For a **brief pause only**, scaling tasks to zero reduces Fargate charges but leaves NAT, ALB, RDS/storage and other resources billable. The module currently hardcodes desired count 1, so a subsequent apply can restart services you manually scaled down. Stopping RDS also retains storage/backups and it automatically restarts after seven days. [AWS RDS stop semantics](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html)

For a finished disposable demo, destroy the environment:

1. Export any data you need or take intentional snapshots. The RDS module skips final snapshots. Destroy is destructive; retained snapshots cost money.
2. Empty the **frontend bucket only**; the example does not enable its versioning. If you enabled versioning, remove all object versions/delete markers too, or Terraform cannot delete it. Do not empty the state bucket.
3. Review/apply a destroy plan using the same state, account, region and input file:

```bash
aws sts get-caller-identity
printf 'Frontend bucket to empty: %s\n' "$WEB_BUCKET"
# This deletes only this disposable deployment's uploaded frontend objects.
aws s3 rm "s3://$WEB_BUCKET/" --recursive

terraform -chdir=infrastructure/terraform plan -destroy \
  -var-file=/tmp/ticketing-poc-deploy/poc.tfvars.json \
  -out=/tmp/ticketing-poc-deploy/destroy.tfplan
terraform -chdir=infrastructure/terraform apply /tmp/ticketing-poc-deploy/destroy.tfplan
terraform -chdir=infrastructure/terraform state list
```

4. Wait for deletion to finish. CloudFront and RDS can take time. If a dependency is still deleting, retry with a fresh destroy plan; do not erase the state to conceal leftover resources.
5. Remove **runtime-created messaging resources** from your verified inventory. Terraform will delete only its own managed topics, notification queue/DLQ/subscriptions. For each remaining demo queue/topic, inspect its ARN/URL, then run `aws sqs delete-queue --queue-url EXACT_DEMO_QUEUE_URL` or `aws sns delete-topic --topic-arn EXACT_DEMO_TOPIC_ARN`. Include `_error` and `_skipped` queues and any runtime-created transport topics; never delete all account queues blindly.
6. ECR repositories were created outside Terraform. After deciding rollback images are no longer needed, remove this demo's repositories/images:

```bash
for service in "${services[@]}" redis; do
  aws ecr delete-repository --repository-name "ticketing/$service" --force
done
```

Run this only if those repositories are dedicated to this demo; otherwise delete only this deployment's unused images. `--force` deletes every image in each named repository.

7. Keep the small encrypted/versioned state bucket for audit/redeployment until deletion is verified. Its historical versions contain secrets. If retiring it, use a deliberate separate version-aware deletion after all resources are gone; `aws s3 rm --recursive` alone does not remove noncurrent versions. Retain/delete the budget separately as appropriate.
8. Check for residual NAT gateways/EIPs, ALBs, RDS snapshots/retained backups, ECS tasks, Cloud Map namespaces, logs, SNS/SQS, Secrets Manager entries pending deletion, S3 versions and ECR images. A secret pending recovery can prevent immediate reuse of its name; wait, restore deliberately, or use a new environment prefix rather than bypassing state.
9. Check Billing/Cost Explorer the following day; costs may arrive late. Securely dispose of local plan/input/inventory files when no longer needed. Saved plans and historical state can contain credentials even when normal CLI output redacts them.

## Completion checklist

- [ ] Source preparation and Terraform additions are implemented and reviewed.
- [ ] Cost estimate and budget alerts are in place; intended teardown date is recorded.
- [ ] Production image/configuration checks, migrations and messaging topology checks pass.
- [ ] Plan contains only the intended resources, sizes and account/region.
- [ ] SPA, authentication, reservation, payment saga, notifications and live updates pass through the AWS edge.
- [ ] Previous release artifacts and any required data backup are available for rollback.
- [ ] Demo is destroyed afterward; unmanaged resources and delayed billing are checked separately.
