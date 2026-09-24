import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { HealthController } from '../src/health/health.controller.js';

/**
 * Deliberately boots only HealthController rather than the full AppModule:
 * AppModule wires SqsConsumerService/PrismaService, whose OnModuleInit
 * hooks talk to real AWS/Postgres. Per the test requirements for this
 * service ("don't require live infrastructure for these tests to pass"),
 * this e2e test covers the one thing Notification Service exposes over
 * HTTP (CONTRACTS.md §9: no public write API, just `GET /health`) without
 * needing LocalStack or a database.
 */
describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });

  afterEach(async () => {
    await app.close();
  });
});
