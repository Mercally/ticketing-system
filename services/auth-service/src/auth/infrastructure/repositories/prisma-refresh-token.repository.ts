import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { RefreshToken } from '../../domain/entities/refresh-token.entity.js';
import {
  type CreateRefreshTokenData,
  type RefreshTokenRepositoryPort,
} from '../../domain/ports/refresh-token-repository.port.js';

interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  family: string;
  revokedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

@Injectable()
export class PrismaRefreshTokenRepository implements RefreshTokenRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateRefreshTokenData): Promise<RefreshToken> {
    const record = await this.prisma.refreshToken.create({
      data: { ...data, revokedAt: null },
    });
    return this.toDomain(record);
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    return record ? this.toDomain(record) : null;
  }

  async revoke(id: string, revokedAt: Date): Promise<void> {
    // Guard on revokedAt: null so an already-revoked row is never re-touched —
    // mirrors the atomic-conditional-UPDATE philosophy used for seat CAS
    // elsewhere in this system (ARCHITECTURE.md §5.1), scaled down to a
    // single-row idempotency guard here.
    await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt },
    });
  }

  async revokeFamily(family: string, revokedAt: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt },
    });
  }

  private toDomain(record: RefreshTokenRecord): RefreshToken {
    return RefreshToken.create(record);
  }
}
