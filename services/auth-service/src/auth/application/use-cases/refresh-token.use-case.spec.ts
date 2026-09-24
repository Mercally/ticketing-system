import { RefreshTokenUseCase } from './refresh-token.use-case.js';
import { RefreshToken } from '../../domain/entities/refresh-token.entity.js';
import { User } from '../../domain/entities/user.entity.js';
import {
  RefreshTokenExpiredError,
  RefreshTokenInvalidError,
  RefreshTokenReuseDetectedError,
} from '../../domain/errors/auth.errors.js';
import type { RefreshTokenRepositoryPort } from '../../domain/ports/refresh-token-repository.port.js';
import type { UserRepositoryPort } from '../../domain/ports/user-repository.port.js';
import type { TokenService } from '../../infrastructure/security/token.service.js';
import type { TokenIssuerService } from '../services/token-issuer.service.js';

const user = User.create({
  id: 'user-1',
  email: 'demo@example.com',
  passwordHash: 'hashed',
  displayName: 'Demo Buyer',
  createdAt: new Date('2026-01-01T00:00:00Z'),
});

function buildRow(overrides: Partial<Parameters<typeof RefreshToken.create>[0]> = {}) {
  return RefreshToken.create({
    id: 'token-1',
    userId: user.id,
    tokenHash: 'hash-of-raw-token',
    family: 'family-1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    ...overrides,
  });
}

function buildUseCase(row: RefreshToken | null) {
  const refreshTokenRepository: RefreshTokenRepositoryPort = {
    create: vi.fn(),
    findByTokenHash: vi.fn().mockResolvedValue(row),
    revoke: vi.fn().mockResolvedValue(undefined),
    revokeFamily: vi.fn().mockResolvedValue(undefined),
  };

  const userRepository: UserRepositoryPort = {
    findByEmail: vi.fn(),
    findById: vi.fn().mockResolvedValue(user),
    create: vi.fn(),
  };

  const tokenService = { hashRefreshToken: vi.fn().mockReturnValue('hash-of-raw-token') } as unknown as TokenService;

  const tokenIssuer = {
    issueForExistingFamily: vi.fn().mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 900 }),
  } as unknown as TokenIssuerService;

  const useCase = new RefreshTokenUseCase(refreshTokenRepository, userRepository, tokenService, tokenIssuer);
  return { useCase, refreshTokenRepository, tokenIssuer };
}

describe('RefreshTokenUseCase — rotation and reuse-detection (docs/CONTRACTS.md §3)', () => {
  it('a never-seen token hash is rejected as invalid', async () => {
    const { useCase } = buildUseCase(null);
    await expect(useCase.execute('some-raw-token')).rejects.toBeInstanceOf(RefreshTokenInvalidError);
  });

  it('a live, non-expired token rotates: the old row is revoked and a new token pair is issued in the SAME family', async () => {
    const row = buildRow({ family: 'family-42' });
    const { useCase, refreshTokenRepository, tokenIssuer } = buildUseCase(row);

    const result = await useCase.execute('raw-token');

    expect(refreshTokenRepository.revoke).toHaveBeenCalledWith(row.id, expect.any(Date));
    expect(refreshTokenRepository.revokeFamily).not.toHaveBeenCalled();
    expect(tokenIssuer.issueForExistingFamily).toHaveBeenCalledWith(user, 'family-42');
    expect(result).toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 900 });
  });

  it('presenting an ALREADY-ROTATED (revoked) token is treated as reuse: the ENTIRE family is revoked, not just the row', async () => {
    const row = buildRow({ family: 'family-99', revokedAt: new Date() });
    const { useCase, refreshTokenRepository, tokenIssuer } = buildUseCase(row);

    await expect(useCase.execute('stolen-raw-token')).rejects.toBeInstanceOf(RefreshTokenReuseDetectedError);

    expect(refreshTokenRepository.revokeFamily).toHaveBeenCalledWith('family-99', expect.any(Date));
    expect(refreshTokenRepository.revoke).not.toHaveBeenCalled();
    expect(tokenIssuer.issueForExistingFamily).not.toHaveBeenCalled();
  });

  it('a live but expired token is rejected as expired, and is left alone (not rotated, not revoked)', async () => {
    const row = buildRow({ expiresAt: new Date(Date.now() - 1000) });
    const { useCase, refreshTokenRepository } = buildUseCase(row);

    await expect(useCase.execute('expired-raw-token')).rejects.toBeInstanceOf(RefreshTokenExpiredError);

    expect(refreshTokenRepository.revoke).not.toHaveBeenCalled();
    expect(refreshTokenRepository.revokeFamily).not.toHaveBeenCalled();
  });
});
