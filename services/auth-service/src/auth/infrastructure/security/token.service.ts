import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { parseDurationToSeconds } from '../../../common/duration.js';

export interface AccessTokenClaims {
  sub: string;
  email: string;
  roles: string[];
}

/**
 * Everything token-shaped: signing the HS256 access token, minting opaque
 * refresh tokens, and hashing them for storage. Pure infrastructure — no
 * Prisma access here, callers (use-cases, via TokenIssuerService) own
 * persistence.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  signAccessToken(claims: AccessTokenClaims): string {
    return this.jwtService.sign(claims);
  }

  getAccessTokenTtlSeconds(): number {
    return parseDurationToSeconds(this.configService.get<string>('jwt.accessTtl', '15m'));
  }

  getRefreshTokenTtlDays(): number {
    return this.configService.get<number>('jwt.refreshTtlDays', 7);
  }

  /** 512 bits of randomness, base64url-encoded — opaque to clients on purpose. */
  generateOpaqueRefreshToken(): string {
    return randomBytes(64).toString('base64url');
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  newTokenId(): string {
    return randomUUID();
  }

  newFamilyId(): string {
    return randomUUID();
  }
}
