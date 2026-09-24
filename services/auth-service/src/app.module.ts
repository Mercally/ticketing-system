import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { configuration } from './config/configuration.js';
import { validateEnv } from './config/env.validation.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware.js';
import { LoggingInterceptor } from './common/logging/logging.interceptor.js';
import { AppLogger } from './common/logging/app-logger.service.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    PrismaModule,
    AuthModule,
  ],
  controllers: [HealthController],
  providers: [AppLogger, { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
