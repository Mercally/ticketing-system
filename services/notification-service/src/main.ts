import './tracing.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Ensures OnModuleDestroy (SqsConsumerService's graceful poll-loop
  // shutdown, PrismaService's $disconnect) runs on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  const port = process.env.PORT ? Number(process.env.PORT) : 5007;
  await app.listen(port);
}
await bootstrap();
