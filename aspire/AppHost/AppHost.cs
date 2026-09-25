// Local orchestration for the whole platform (ARCHITECTURE.md §12). `dotnet run` here starts
// every Postgres instance, LocalStack, Redis, all .NET services, both NestJS services, and the
// frontend, wired with service discovery + OTLP export to the Aspire dashboard.
//
// NOTE: this sandbox has no Docker daemon available, so this file's wiring could not be verified
// by an actual `aspire run` in this environment (every resource below except the plain .NET
// projects is container-backed). It's been checked for compile-time correctness
// (`dotnet build aspire/AppHost`) but not exercised end-to-end — see DECISIONS.md.
var builder = DistributedApplication.CreateBuilder(args);

// --- PostgreSQL: one container per service (ARCHITECTURE.md §11/§12, DECISIONS.md D5 — this is
// the "closest to production topology" environment; local k8s instead shares one instance). ---
var catalogPg = builder.AddPostgres("catalog-postgres").WithDataVolume();
var catalogDb = catalogPg.AddDatabase("catalogdb");

var ticketingPg = builder.AddPostgres("ticketing-postgres").WithDataVolume();
var ticketingDb = ticketingPg.AddDatabase("ticketingdb");

var ordersPg = builder.AddPostgres("orders-postgres").WithDataVolume();
var ordersDb = ordersPg.AddDatabase("ordersdb");

var paymentsPg = builder.AddPostgres("payments-postgres").WithDataVolume();
var paymentsDb = paymentsPg.AddDatabase("paymentsdb");

var authPg = builder.AddPostgres("auth-postgres").WithDataVolume();
var authDb = authPg.AddDatabase("authdb");

var notificationPg = builder.AddPostgres("notification-postgres").WithDataVolume();
var notificationDb = notificationPg.AddDatabase("notificationdb");

// --- Messaging: LocalStack stands in for AWS SQS/SNS locally (ADR-0004, DECISIONS.md D4) — the
// exact same MassTransit.AmazonSQS transport code path runs against it as against real AWS.
//
// Requires a LOCALSTACK_AUTH_TOKEN (DECISIONS.md D16) — the container refuses to start at all
// without one, even for community/free services like SQS/SNS. Get a free token at
// https://app.localstack.cloud and provide it via `dotnet user-secrets set Parameters:localstack-auth-token
// <token>` (run from aspire/AppHost) so it's never committed — this parameter is intentionally
// left unset by default rather than given a placeholder that would silently fail the same way. ---
var localstackAuthToken = builder.AddParameter("localstack-auth-token", secret: true);

var localstack = builder.AddContainer("localstack", "localstack/localstack")
    .WithEnvironment("SERVICES", "sqs,sns")
    .WithEnvironment("LOCALSTACK_AUTH_TOKEN", localstackAuthToken)
    .WithHttpEndpoint(port: 4566, targetPort: 4566, name: "http");

var localstackEndpoint = localstack.GetEndpoint("http");

// --- Redis: waiting-room/rate-limit counters ONLY (DECISIONS.md D11) — never seat/order/payment
// state. Also backs SignalR's cross-replica backplane if Ticketing is ever scaled beyond 1
// replica locally (ADR-0007) — not wired by default, single replica is the local dev default. ---
var redis = builder.AddRedis("redis");

// --- .NET services (Clean Architecture, MassTransit + AWS SQS/SNS transport) ---
var catalog = builder.AddProject<Projects.Catalog_Api>("catalog")
    .WithReference(catalogDb)
    .WaitFor(catalogDb);

// Not wired to Redis: Ticketing runs single-replica locally (ADR-0007 notes a SignalR backplane
// would be needed before scaling it out; not required at replicas:1).
var ticketing = builder.AddProject<Projects.Ticketing_Api>("ticketing")
    .WithReference(ticketingDb)
    .WaitFor(ticketingDb)
    .WithEnvironment("Messaging__Aws__ServiceUrl", localstackEndpoint)
    .WaitFor(localstack);

var orders = builder.AddProject<Projects.Orders_Api>("orders")
    .WithReference(ordersDb)
    .WaitFor(ordersDb)
    .WithEnvironment("Messaging__Aws__ServiceUrl", localstackEndpoint)
    .WaitFor(localstack);

var fakePaymentGateway = builder.AddProject<Projects.FakePaymentGateway_Api>("fakepaymentgateway");

var payments = builder.AddProject<Projects.Payments_Api>("payments")
    .WithReference(paymentsDb)
    .WaitFor(paymentsDb)
    .WithEnvironment("Messaging__Aws__ServiceUrl", localstackEndpoint)
    .WaitFor(localstack)
    .WithReference(fakePaymentGateway)
    .WithEnvironment("FakePaymentGateway__BaseUrl", fakePaymentGateway.GetEndpoint("http"))
    .WithEnvironment("PaymentService__WebhookUrl", "http://localhost:5005/webhook");

// --- Gateway: routes to every service above by env-var-configured address (docs/CONTRACTS.md §1
// — the same AUTH_SERVICE_URL/etc names infrastructure/k8s/base/gateway/configmap.yaml sets). ---
var gateway = builder.AddProject<Projects.Gateway_Api>("gateway")
    .WithReference(redis)
    .WaitFor(redis)
    .WithEnvironment("CATALOG_SERVICE_URL", catalog.GetEndpoint("http"))
    .WithEnvironment("TICKETING_SERVICE_URL", ticketing.GetEndpoint("http"))
    .WithEnvironment("ORDERS_SERVICE_URL", orders.GetEndpoint("http"))
    .WithEnvironment("PAYMENTS_SERVICE_URL", payments.GetEndpoint("http"))
    .WaitFor(catalog)
    .WaitFor(ticketing)
    .WaitFor(orders)
    .WaitFor(payments);

// --- NestJS services. Prisma needs a postgresql://... URL, not Npgsql's keyword-list format
// WithReference(dbResource) would inject, so it's built directly via ReferenceExpression —
// interpolating the server's password parameter and TCP endpoint resolves them to their actual
// runtime values (Aspire's reference-expression interpolated-string handler), same mechanism
// WithReference itself uses internally, just shaped as a URL instead of a keyword list. ---
var authDbUrl = ReferenceExpression.Create($"postgresql://postgres:{authPg.Resource.PasswordParameter}@{authPg.GetEndpoint("tcp")}/authdb");
var notificationDbUrl = ReferenceExpression.Create($"postgresql://postgres:{notificationPg.Resource.PasswordParameter}@{notificationPg.GetEndpoint("tcp")}/notificationdb");

// No AWS/LocalStack wiring here on purpose — Auth Service is architecturally isolated from
// messaging (ARCHITECTURE.md §4: it publishes no events, has no MassTransit/AWS SDK dependency
// at all). It must never WaitFor(localstack): doing so previously made it block startup on
// LocalStack's health, which fails without a LOCALSTACK_AUTH_TOKEN (DECISIONS.md D16) — auth-service
// would then never actually start listening, Gateway would 502 proxying to it, and the frontend
// would surface that as a network error on login/register, even though Auth Service itself has
// nothing to do with LocalStack.
var authService = builder.AddNpmApp("auth-service", "../../services/auth-service", "start:dev")
    .WithHttpEndpoint(env: "PORT", port: 5001)
    .WithEnvironment("DATABASE_URL", authDbUrl)
    .WaitFor(authDb);

var notificationService = builder.AddNpmApp("notification-service", "../../services/notification-service", "start:dev")
    .WithHttpEndpoint(env: "PORT", port: 5007)
    .WithEnvironment("DATABASE_URL", notificationDbUrl)
    .WaitFor(notificationDb)
    .WithEnvironment("AWS_ENDPOINT_URL", localstackEndpoint)
    .WaitFor(localstack);

gateway
    .WithEnvironment("AUTH_SERVICE_URL", authService.GetEndpoint("http"))
    .WaitFor(authService);

// --- Frontend (Vite dev server) ---
builder.AddNpmApp("frontend", "../../apps/frontend", "dev")
    .WithHttpEndpoint(env: "PORT", port: 5173)
    .WithEnvironment("VITE_API_BASE_URL", gateway.GetEndpoint("http"))
    .WaitFor(gateway)
    .WithExternalHttpEndpoints();

await builder.Build().RunAsync();
