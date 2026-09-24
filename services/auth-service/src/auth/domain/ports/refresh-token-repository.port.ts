import type { RefreshToken } from '../entities/refresh-token.entity.js';

export interface CreateRefreshTokenData {
  id: string;
  userId: string;
  tokenHash: string;
  family: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Port for refresh-token persistence. `revoke` and `revokeFamily` are the
 * two operations the rotation/reuse-detection policy in
 * `RefreshTokenUseCase` relies on — kept narrow and specific rather than a
 * generic `update`, so the use-case's intent stays obvious at the call site.
 */
export interface RefreshTokenRepositoryPort {
  create(data: CreateRefreshTokenData): Promise<RefreshToken>;
  findByTokenHash(tokenHash: string): Promise<RefreshToken | null>;
  revoke(id: string, revokedAt: Date): Promise<void>;
  revokeFamily(family: string, revokedAt: Date): Promise<void>;
}

export const REFRESH_TOKEN_REPOSITORY = Symbol('REFRESH_TOKEN_REPOSITORY');
