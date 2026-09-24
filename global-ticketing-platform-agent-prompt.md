# Prompt — Global Ticketing Platform

Actúa como **Principal Software Architect y Senior Full-Stack Engineer**.

Debes diseñar e implementar un sistema demostrativo de venta global de boletos para conciertos dentro de un **MONOREPO**.

Antes de escribir código, genera un archivo `ARCHITECTURE.md` con la arquitectura propuesta, decisiones principales, microservicios, responsabilidades, flujos, modelo de consistencia y estructura del monorepo. Después implementa la solución siguiendo esa arquitectura.

## Problemática

La plataforma tiene tráfico base bajo, pero cuando comienza la venta de un concierto popular puede recibir millones de solicitudes concurrentes en segundos.

Problemas principales:

- Picos masivos de tráfico.
- Evitar absolutamente la doble venta de un asiento.
- Disponibilidad de asientos cercana a tiempo real.
- Integración segura con una pasarela de pagos externa.
- Fallos parciales entre servicios.
- Operaciones duplicadas por retries.
- Necesidad de trazabilidad end-to-end.

## Arquitectura requerida

Utiliza arquitectura de microservicios dentro de un monorepo.

### Backend principal

- .NET 10
- ASP.NET Core Controllers
- Clean Architecture
- DDD cuando aporte valor
- EF Core
- PostgreSQL
- Una base de datos independiente por microservicio.

### Microservicios .NET

1. Catalog Service
2. Ticketing/Inventory Service
3. Order Service
4. Payment Service

### Authentication Service

Implementar como microservicio independiente utilizando **Node.js + NestJS**.

Usar:

- NestJS
- TypeScript
- Passport
- JWT
- Refresh Tokens
- Prisma
- PostgreSQL

El Auth Service debe ser independiente de los microservicios .NET.

### Notification Service

Implementar como microservicio independiente utilizando **Node.js + NestJS**.

Usar:

- NestJS
- TypeScript
- AWS SDK
- AWS SNS
- OpenTelemetry

Responsabilidades:

- Consumir eventos relevantes del sistema.
- Publicar notificaciones mediante AWS SNS.
- Mantenerse desacoplado del flujo transaccional principal.
- Propagar TraceId/CorrelationId.
- Procesar mensajes de forma idempotente.
- Manejar retries y errores sin afectar el proceso de compra.

Ejemplos de eventos:

- OrderConfirmed
- PaymentSucceeded
- PaymentFailed
- TicketConfirmed

No enviar notificaciones directamente desde Order, Payment o Ticketing Service.

## Frontend

React + TypeScript + Vite.

Usar:

- React Router
- TanStack Query
- Zustand únicamente para estado global del cliente cuando sea necesario.

Debe permitir:

- Login.
- Consultar conciertos.
- Consultar mapa/disponibilidad de asientos.
- Reservar asiento.
- Comprar.
- Visualizar estado de la orden.

## Consistencia de inventario

El Ticketing/Inventory Service es el único propietario del estado autoritativo de los asientos.

Estados mínimos:

```text
AVAILABLE
RESERVED
SOLD
```

Una reserva debe tener TTL.

PostgreSQL debe garantizar atómicamente que dos usuarios nunca puedan reservar/vender el mismo asiento.

Utiliza constraints, optimistic/pessimistic concurrency o atomic `UPDATE` según la solución que consideres más adecuada.

**NO utilices Redis como autoridad para garantizar exclusividad del asiento.**

Explica la estrategia seleccionada en un ADR.

## Distributed Transactions

NO utilizar transacciones distribuidas 2PC.

Implementar **Saga Pattern** para coordinar:

```text
Reserve Seat
→ Create Order
→ Process Payment
→ Confirm Seat/Ticket
```

En caso de fallo:

```text
Payment Failed
→ Cancel Order
→ Release Reservation
```

Implementar Saga mediante **MassTransit Saga State Machine**.

## Messaging

AWS:

- SQS
- SNS cuando sea apropiado.

Utilizar MassTransit en .NET.

Toda comunicación asíncrona debe considerar:

- retries
- dead-letter queues
- duplicate messages
- poison messages
- correlation IDs
- idempotent consumers.

Implementar **Transactional Outbox** donde sea necesario.

Implementar Inbox/idempotent consumer para evitar procesamiento duplicado.

Los mensajes deben ser versionables.

No compartir entidades de dominio entre microservicios.

## Idempotencia

Las operaciones críticas deben soportar:

```text
Idempotency-Key
```

Especialmente:

- Create Reservation
- Create Order
- Process Payment

Persistir los resultados necesarios para que repetir una solicitud no produzca una segunda operación.

Agregar `UNIQUE constraints` como última línea de defensa cuando corresponda.

## Real-time availability

Utilizar **SignalR** para actualizaciones de disponibilidad hacia React.

La UI puede mostrar información eventualmente consistente.

La operación final de reserva SIEMPRE debe ser validada por Ticketing Service contra PostgreSQL.

## Massive Traffic

Diseñar el sistema considerando millones de requests durante ticket drops.

Incluir:

```text
CloudFront
→ WAF
→ Waiting Room / Admission Control
→ API Gateway
→ Services
```

No asumir que auto-scaling por sí solo resuelve el problema.

Explicar mecanismos de:

- backpressure
- rate limiting
- load shedding
- caching
- queueing
- horizontal scaling.

## Observabilidad

Utilizar:

- .NET Aspire
- OpenTelemetry
- Serilog para servicios .NET
- OTEL tracing
- OTEL metrics
- OTEL logs.

Aspire debe funcionar como experiencia local de desarrollo y observabilidad.

Propagar:

```text
traceparent
TraceId
SpanId
CorrelationId
```

a través de:

```text
React
→ HTTP
→ API
→ PostgreSQL
→ SQS/SNS
→ Consumer
→ Payment API
→ Notification Service
→ SNS
```

Quiero poder seleccionar una compra en Aspire/OTEL y reconstruir visualmente toda la operación distribuida.

Agregar instrumentation para:

- ASP.NET Core
- HttpClient
- EF Core/Npgsql
- NestJS
- AWS SQS/SNS
- MassTransit

Nunca incluir passwords, JWTs, payment tokens o PII sensible en logs/spans.

## Payment Gateway

Crear una abstracción:

```csharp
IPaymentGateway
```

y una implementación `FakePaymentGateway` para desarrollo.

Debe poder simular:

- success
- decline
- timeout
- duplicate callback
- delayed response.

El Payment Service debe ser idempotente.

Nunca almacenar información completa de tarjetas.

## Resilience

Utilizar `Microsoft.Extensions.Resilience` / Polly donde corresponda.

Aplicar correctamente:

- timeout
- retry
- circuit breaker

No aplicar retries indiscriminadamente sobre operaciones no idempotentes.

## Monorepo

Estructura base:

```text
/apps
  /frontend

/services
  /auth-service
  /notification-service
  /catalog
  /ticketing
  /orders
  /payments

/building-blocks
  /messaging
  /observability
  /idempotency

/aspire
  /AppHost
  /ServiceDefaults

/infrastructure
  /terraform
  /docker

/tests
```

Cada microservicio .NET debe mantener conceptualmente:

```text
Api
Application
Domain
Infrastructure
```

Los servicios NestJS deben mantener una separación clara entre:

```text
Controllers
Application/Use Cases
Domain
Infrastructure
```

Evita abstracciones innecesarias.

No crear un SharedKernel que acople los dominios.

## Infrastructure

Target architecture en AWS:

- CloudFront
- WAF
- API Gateway
- ECS/Fargate o EKS
- SQS
- SNS
- RDS PostgreSQL
- Secrets Manager
- CloudWatch
- OpenTelemetry

Usar Terraform para IaC.

Aspire se utilizará principalmente para desarrollo/orquestación local.

## Testing

Agregar:

- Unit Tests
- Integration Tests
- concurrency tests
- idempotency tests
- Saga tests.

Crear específicamente una prueba que lance múltiples solicitudes concurrentes intentando reservar **EL MISMO asiento**.

El resultado esperado debe ser exactamente:

```text
1 reservation succeeds
N-1 reservations fail
```

Nunca dos reservas exitosas.

Agregar también pruebas para Notification Service que validen:

- consumo duplicado de eventos
- idempotencia
- publicación SNS
- propagación de TraceId/CorrelationId
- retries ante fallos temporales de SNS.

## Architecture Documentation

Crear:

```text
ARCHITECTURE.md
/docs/adr/
```

Como mínimo ADRs para:

1. Database per Service
2. Seat Consistency Strategy
3. Saga vs Distributed Transaction
4. SQS/SNS Messaging
5. Transactional Outbox
6. Idempotency Strategy
7. Real-Time Availability
8. Waiting Room / Admission Control
9. Notification Architecture with NestJS + SNS

También crear diagramas Mermaid:

- System Context
- Containers/Microservices
- Purchase Sequence
- Saga flow
- Notification flow
- Deployment AWS
- Observability trace flow

## Principios

Priorizar:

```text
Correctness > Reliability > Observability > Scalability > Convenience
```

No introducir tecnología únicamente porque sea popular.

Toda decisión arquitectónica importante debe explicar brevemente:

- problema
- decisión
- alternativas
- trade-offs.

El sistema debe poder ejecutarse localmente con una experiencia razonablemente simple mediante **.NET Aspire**.

Empieza generando `ARCHITECTURE.md` y la estructura del repositorio.

No implementes todos los microservicios simultáneamente. Construye primero el vertical slice crítico:

```text
Login
→ Browse Event
→ View Seats
→ Reserve Seat
→ Create Order
→ Payment
→ Confirm Ticket
→ Notification
```

Posteriormente completa capacidades secundarias.
