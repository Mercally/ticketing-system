import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { EmailAlreadyRegisteredError } from '../../domain/errors/auth.errors.js';
import { PASSWORD_HASHER, type PasswordHasherPort } from '../../domain/ports/password-hasher.port.js';
import { USER_REPOSITORY, type UserRepositoryPort } from '../../domain/ports/user-repository.port.js';

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
}

export interface RegisterResult {
  userId: string;
}

@Injectable()
export class RegisterUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepositoryPort,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasherPort,
  ) {}

  async execute(input: RegisterInput): Promise<RegisterResult> {
    const normalizedEmail = input.email.trim().toLowerCase();

    const existing = await this.userRepository.findByEmail(normalizedEmail);
    if (existing) {
      throw new EmailAlreadyRegisteredError();
    }

    const passwordHash = await this.passwordHasher.hash(input.password);
    const user = await this.userRepository.create({
      id: randomUUID(),
      email: normalizedEmail,
      passwordHash,
      displayName: input.displayName.trim(),
      createdAt: new Date(),
    });

    return { userId: user.id };
  }
}
