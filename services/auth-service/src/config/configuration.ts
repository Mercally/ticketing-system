export interface AppConfig {
  port: number;
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
