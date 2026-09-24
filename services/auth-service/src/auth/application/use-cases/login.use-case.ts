import { Inject, Injectable } from '@nestjs/common';
import type { User } from '../../domain/entities/user.entity.js';
import { InvalidCredentialsError } from '../../domain/errors/auth.errors.js';
import { PASSWORD_HASHER, type PasswordHasherPort } from '../../domain/ports/password-hasher.port.js';
import { USER_REPOSITORY, type UserRepositoryPort } from '../../domain/ports/user-repository.port.js';
import { TokenIssuerService, type AuthTokensResult } from '../services/token-issuer.service.js';

@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepositoryPort,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasherPort,
    private readonly tokenIssuer: TokenIssuerService,
  ) {}

  /** Used by LocalStrategy to back `POST /login`. */
  async validateCredentials(email: string, password: string): Promise<User> {
    const user = await this.userRepository.findByEmail(email.trim().toLowerCase());
    if (!user) {
      // Same error for "no such user" and "wrong password" — never reveal
      // which one it was.
      throw new InvalidCredentialsError();
    }

    const isValid = await this.passwordHasher.verify(password, user.passwordHash);
    if (!isValid) {
      throw new InvalidCredentialsError();
    }

    return user;
  }

  login(user: User): Promise<AuthTokensResult> {
    return this.tokenIssuer.issueForNewFamily(user);
  }
}
