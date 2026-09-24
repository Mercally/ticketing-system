/**
 * OpenTelemetry bootstrap. Imported for its side effect as the very first
 * line of `main.ts`, before Nest (or anything it transitively imports) is
 * loaded — auto-instrumentation patches modules at require/import time, so
 * it must be registered before those modules are first imported.
 *
 * Deliberately separate from business CorrelationId propagation
 * (AppLogger / CorrelationIdMiddleware) — see DECISIONS.md D9: OTel
 * trace/span ids and the business CorrelationId are two different concepts
 * propagated two different ways. This file only wires the former.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const otlpBaseUrl = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'auth-service',
  }),
  traceExporter: new OTLPTraceExporter({ url: `${otlpBaseUrl}/v1/traces` }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

async function shutdown(): Promise<void> {
  try {
    await sdk.shutdown();
  } catch {
    // Best-effort flush on shutdown; never block process exit on it.
  }
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
