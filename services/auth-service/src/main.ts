import './tracing.js';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { AppLogger } from './common/logging/app-logger.service.js';
import type { AppConfig } from './config/configuration.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(AppLogger));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = app.get(ConfigService<AppConfig, true>);

  // Needed as of DECISIONS.md D17 (k8s: API Gateway calls this service directly, no YARP hop
  // doing CORS in front anymore). Harmless in Aspire dev, where YARP still fronts this service.
  app.enableCors({ origin: config.get('allowedOrigins', { infer: true }) });

  await app.listen(config.get('port', { infer: true }));
}

await bootstrap();
