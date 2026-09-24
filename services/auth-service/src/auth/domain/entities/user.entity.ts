import { InvalidUserDataError } from '../errors/auth.errors.js';

export interface UserProps {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  createdAt: Date;
}

/**
 * The Auth Service's User concept. Deliberately independent of the Prisma
 * model — repositories translate between the two — so domain/application
 * code never depends on the ORM (ARCHITECTURE.md layering, requirement 4).
 */
export class User {
  private constructor(private readonly props: UserProps) {}

  static create(props: UserProps): User {
    if (!props.email || !props.email.includes('@')) {
      throw new InvalidUserDataError('email must be a valid address');
    }
    if (!props.displayName || props.displayName.trim().length === 0) {
      throw new InvalidUserDataError('displayName must not be empty');
    }
    if (!props.passwordHash) {
      throw new InvalidUserDataError('passwordHash is required');
    }
    return new User(props);
  }

  get id(): string {
    return this.props.id;
  }

  get email(): string {
    return this.props.email;
  }

  get passwordHash(): string {
    return this.props.passwordHash;
  }

  get displayName(): string {
    return this.props.displayName;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }
}
