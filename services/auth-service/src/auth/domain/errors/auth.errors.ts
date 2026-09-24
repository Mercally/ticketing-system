import { DomainError } from './domain-error.js';

export class EmailAlreadyRegisteredError extends DomainError {
  readonly code = 'EMAIL_ALREADY_REGISTERED';

  constructor() {
    super('Email is already registered');
  }
}

export class InvalidCredentialsError extends DomainError {
  readonly code = 'INVALID_CREDENTIALS';

  constructor() {
    super('Invalid email or password');
  }
}

export class RefreshTokenInvalidError extends DomainError {
  readonly code = 'REFRESH_TOKEN_INVALID';

  constructor() {
    super('Refresh token is invalid');
  }
}

/**
 * Raised when a refresh token that was already rotated away (revokedAt set)
 * is presented again — the reuse-detection / token-family-compromise path
 * required by docs/CONTRACTS.md §3.
 */
export class RefreshTokenReuseDetectedError extends DomainError {
  readonly code = 'REFRESH_TOKEN_REUSE_DETECTED';

  constructor() {
    super('Refresh token reuse detected; the entire token family has been revoked');
  }
}

export class RefreshTokenExpiredError extends DomainError {
  readonly code = 'REFRESH_TOKEN_EXPIRED';

  constructor() {
    super('Refresh token has expired');
  }
}

export class UserNotFoundError extends DomainError {
  readonly code = 'USER_NOT_FOUND';

  constructor() {
    super('User not found');
  }
}

export class InvalidUserDataError extends DomainError {
  readonly code = 'INVALID_USER_DATA';

  constructor(message: string) {
    super(message);
  }
}
