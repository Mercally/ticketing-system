import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import type { User } from '../../domain/entities/user.entity.js';
import { DomainError } from '../../domain/errors/domain-error.js';
import { LoginUseCase } from '../../application/use-cases/login.use-case.js';

/**
 * Backs `POST /login`. Passport strategies sit at the HTTP adapter boundary,
 * so this is the one place allowed to translate a domain error into a
 * Nest/HTTP exception — the domain/application layers underneath stay
 * framework-agnostic.
 */
@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local') {
  constructor(private readonly loginUseCase: LoginUseCase) {
    super({ usernameField: 'email', passwordField: 'password' });
  }

  async validate(email: string, password: string): Promise<User> {
    try {
      return await this.loginUseCase.validateCredentials(email, password);
    } catch (error) {
      if (error instanceof DomainError) {
        throw new UnauthorizedException('Invalid email or password');
      }
      throw error;
    }
  }
}
