import { Inject, Injectable } from '@nestjs/common';
import { UserNotFoundError } from '../../domain/errors/auth.errors.js';
import { USER_REPOSITORY, type UserRepositoryPort } from '../../domain/ports/user-repository.port.js';

export interface CurrentUserResult {
  userId: string;
  email: string;
  displayName: string;
}

/** Backs `GET /me`. The JWT only carries `sub`/`email`/`roles`, so this still needs a lookup to return `displayName`. */
@Injectable()
export class GetCurrentUserUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly userRepository: UserRepositoryPort) {}

  async execute(userId: string): Promise<CurrentUserResult> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UserNotFoundError();
    }

    return { userId: user.id, email: user.email, displayName: user.displayName };
  }
}
