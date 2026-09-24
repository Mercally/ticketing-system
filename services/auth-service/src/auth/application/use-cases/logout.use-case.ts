import { Inject, Injectable } from '@nestjs/common';
import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepositoryPort,
} from '../../domain/ports/refresh-token-repository.port.js';
import { TokenService } from '../../infrastructure/security/token.service.js';

@Injectable()
export class LogoutUseCase {
  constructor(
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokenRepository: RefreshTokenRepositoryPort,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * Revokes only the presented refresh token (not the whole family — that's
   * reserved for reuse-detection). Idempotent and deliberately silent about
   * whether the token existed, so a repeated logout call can't be used to
   * probe token validity.
   */
  async execute(rawRefreshToken: string): Promise<void> {
    const tokenHash = this.tokenService.hashRefreshToken(rawRefreshToken);
    const existing = await this.refreshTokenRepository.findByTokenHash(tokenHash);

    if (!existing || existing.isRevoked()) {
      return;
    }

    await this.refreshTokenRepository.revoke(existing.id, new Date());
  }
}
