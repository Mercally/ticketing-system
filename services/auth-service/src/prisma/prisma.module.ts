import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * Global so any feature module can inject PrismaService without re-importing
 * this module everywhere — there's only ever one Postgres connection pool
 * for this service's own `auth-db`.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
