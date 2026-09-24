import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { App } from 'supertest/types';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// DATABASE_URL/JWT_SECRET are supplied via vitest.config.e2e.ts's `test.env`
// (required by env.validation before ConfigModule.forRoot will construct
// AppModule at all) — no live Postgres is used in this suite; PrismaService
// is overridden with an in-memory fake below.

function buildPrismaMock() {
  const users = new Map<string, { id: string; email: string; passwordHash: string; displayName: string; createdAt: Date }>();

  return {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        if (where.email) return [...users.values()].find((u) => u.email === where.email) ?? null;
        if (where.id) return users.get(where.id) ?? null;
        return null;
      }),
      create: vi.fn(async ({ data }: { data: { id: string; email: string; passwordHash: string; displayName: string; createdAt: Date } }) => {
        users.set(data.id, data);
        return data;
      }),
    },
    refreshToken: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  } as unknown as PrismaClient;
}

/**
 * A full-DI-graph smoke test: every provider in the module tree (including
 * the passport strategies, the JwtModule factory, and every use-case) must
 * resolve without error. This is the cheapest way to catch a broken wiring
 * (a missing @Inject token, a module that forgot to export a provider
 * another module needs) without requiring a live Postgres — PrismaService
 * is overridden with an in-memory fake rather than connecting to `auth-db`.
 */
describe('Auth Service (e2e, DI wiring + register/login/me flow)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(buildPrismaMock())
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers, logs in, and fetches the current user through the real HTTP surface', async () => {
    const server = app.getHttpServer();

    const registerRes = await request(server)
      .post('/register')
      .send({ email: 'demo@example.com', password: 'correct horse battery staple', displayName: 'Demo Buyer' })
      .expect(201);
    expect(registerRes.body.userId).toEqual(expect.any(String));

    const loginRes = await request(server)
      .post('/login')
      .send({ email: 'demo@example.com', password: 'correct horse battery staple' })
      .expect(200);
    expect(loginRes.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      expiresIn: expect.any(Number),
    });

    const meRes = await request(server)
      .get('/me')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .expect(200);
    expect(meRes.body).toMatchObject({ email: 'demo@example.com', displayName: 'Demo Buyer' });
  });

  it('rejects login with the wrong password', async () => {
    await request(app.getHttpServer())
      .post('/login')
      .send({ email: 'demo@example.com', password: 'wrong password entirely' })
      .expect(401);
  });

  it('rejects a request to /me with no Authorization header', async () => {
    await request(app.getHttpServer()).get('/me').expect(401);
  });

  it('rejects a malformed registration body (extra/unknown fields, per whitelist validation)', async () => {
    await request(app.getHttpServer())
      .post('/register')
      .send({ email: 'not-an-email', password: 'short', displayName: '', isAdmin: true })
      .expect(400);
  });
});
