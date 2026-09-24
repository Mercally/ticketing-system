import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  RefreshTokenExpiredError,
  RefreshTokenInvalidError,
  RefreshTokenReuseDetectedError,
} from '../../domain/errors/auth.errors.js';
import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepositoryPort,
} from '../../domain/ports/refresh-token-repository.port.js';
import { USER_REPOSITORY, type UserRepositoryPort } from '../../domain/ports/user-repository.port.js';
import { TokenService } from '../../infrastructure/security/token.service.js';
import { TokenIssuerService, type AuthTokensResult } from '../services/token-issuer.service.js';

/**
 * Rotation + reuse-detection policy for `POST /refresh` (docs/CONTRACTS.md
 * §3). This is the trickiest correctness bit in the service:
 *
 *  - A never-seen token hash            -> 401, invalid.
 *  - A hash that matches an ALREADY-     -> the token was replayed after
 *    revoked row                           being rotated away; treat as
 *                                           theft and revoke the WHOLE
 *                                           family, then 401.
 *  - A hash that matches a live but      -> 401, expired. Left alone
 *    expired row                           (not rotated, not revoked)
 *                                           so it simply falls out of use.
 *  - A hash that matches a live, non-    -> rotate: revoke this row,
 *    expired row                           mint a new row in the SAME
 *                                           family, return new tokens.
 */
@Injectable()
export class RefreshTokenUseCase {
  private readonly logger = new Logger(RefreshTokenUseCase.name);

  constructor(
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokenRepository: RefreshTokenRepositoryPort,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepositoryPort,
    private readonly tokenService: TokenService,
    private readonly tokenIssuer: TokenIssuerService,
  ) {}

  async execute(rawRefreshToken: string): Promise<AuthTokensResult> {
    const tokenHash = this.tokenService.hashRefreshToken(rawRefreshToken);
    const existing = await this.refreshTokenRepository.findByTokenHash(tokenHash);

    if (!existing) {
      throw new RefreshTokenInvalidError();
    }

    if (existing.isRevoked()) {
      this.logger.warn(`Refresh token reuse detected; revoking token family ${existing.family}`);
      await this.refreshTokenRepository.revokeFamily(existing.family, new Date());
      throw new RefreshTokenReuseDetectedError();
    }

    if (existing.isExpired()) {
      throw new RefreshTokenExpiredError();
    }

    const user = await this.userRepository.findById(existing.userId);
    if (!user) {
      throw new RefreshTokenInvalidError();
    }

    await this.refreshTokenRepository.revoke(existing.id, new Date());

    return this.tokenIssuer.issueForExistingFamily(user, existing.family);
  }
}
