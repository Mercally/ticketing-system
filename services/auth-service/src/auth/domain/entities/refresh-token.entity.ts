export interface RefreshTokenProps {
  id: string;
  userId: string;
  tokenHash: string;
  family: string;
  revokedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * A single row in the refresh token rotation chain. `family` groups every
 * token descended from one login; rotation and reuse-detection (see
 * RefreshTokenUseCase) are expressed entirely in terms of this entity's
 * `isRevoked`/`isExpired` predicates so the policy is unit-testable without
 * Postgres.
 */
export class RefreshToken {
  private constructor(private readonly props: RefreshTokenProps) {}

  static create(props: RefreshTokenProps): RefreshToken {
    return new RefreshToken(props);
  }

  get id(): string {
    return this.props.id;
  }

  get userId(): string {
    return this.props.userId;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get family(): string {
    return this.props.family;
  }

  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  isRevoked(): boolean {
    return this.props.revokedAt !== null;
  }

  isExpired(now: Date = new Date()): boolean {
    return this.props.expiresAt.getTime() <= now.getTime();
  }
}
