import { Inject, Injectable } from '@nestjs/common';
import type { User } from '../../domain/entities/user.entity.js';
import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepositoryPort,
} from '../../domain/ports/refresh-token-repository.port.js';
import { TokenService } from '../../infrastructure/security/token.service.js';

export interface AuthTokensResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * The one place that actually mints a token pair and persists the refresh
 * token row. Shared by LoginUseCase (new family) and RefreshTokenUseCase
 * (existing family) so the "how" of issuing tokens lives in exactly one
 * spot, while each use-case owns its own policy for *when* to call it.
 */
@Injectable()
export class TokenIssuerService {
  constructor(
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokenRepository: RefreshTokenRepositoryPort,
    private readonly tokenService: TokenService,
  ) {}

  issueForNewFamily(user: User): Promise<AuthTokensResult> {
    return this.issue(user, this.tokenService.newFamilyId());
  }

  issueForExistingFamily(user: User, family: string): Promise<AuthTokensResult> {
    return this.issue(user, family);
  }

  private async issue(user: User, family: string): Promise<AuthTokensResult> {
    const now = new Date();
    const rawRefreshToken = this.tokenService.generateOpaqueRefreshToken();
    const refreshTtlDays = this.tokenService.getRefreshTokenTtlDays();
    const expiresAt = new Date(now.getTime() + refreshTtlDays * 24 * 60 * 60 * 1000);

    await this.refreshTokenRepository.create({
      id: this.tokenService.newTokenId(),
      userId: user.id,
      tokenHash: this.tokenService.hashRefreshToken(rawRefreshToken),
      family,
      expiresAt,
      createdAt: now,
    });

    const accessToken = this.tokenService.signAccessToken({
      sub: user.id,
      email: user.email,
      roles: ['buyer'],
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: this.tokenService.getAccessTokenTtlSeconds(),
    };
  }
}
