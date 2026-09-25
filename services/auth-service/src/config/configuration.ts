export interface AppConfig {
  port: number;
  allowedOrigins: string[];
  database: {
    url: string;
  };
  jwt: {
    secret: string;
    accessTtl: string;
    refreshTtlDays: number;
  };
  otel: {
    exporterOtlpEndpoint: string;
    serviceName: string;
  };
}

/**
 * Loaded by `ConfigModule.forRoot({ load: [configuration] })`. Env vars are
 * validated separately in `env.validation.ts` before this factory runs, so
 * defaults here only apply to genuinely optional settings.
 */
export function configuration(): AppConfig {
  return {
    port: parseInt(process.env.PORT ?? '5001', 10),
    // Needed as of DECISIONS.md D17 (k8s: API Gateway calls this service directly, no YARP hop
    // doing CORS in front anymore). Harmless in Aspire dev, where YARP still fronts this service.
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    database: {
      url: process.env.DATABASE_URL ?? '',
    },
    jwt: {
      secret: process.env.JWT_SECRET ?? '',
      accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
      refreshTtlDays: parseInt(process.env.JWT_REFRESH_TTL_DAYS ?? '7', 10),
    },
    otel: {
      exporterOtlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
      serviceName: process.env.OTEL_SERVICE_NAME ?? 'auth-service',
    },
  };
}
