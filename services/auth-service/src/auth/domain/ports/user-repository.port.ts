import type { User } from '../entities/user.entity.js';

export interface CreateUserData {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  createdAt: Date;
}

/**
 * Port (in the hexagonal sense) that use-cases depend on instead of Prisma
 * directly. `PrismaUserRepository` (infrastructure) is the real
 * implementation; unit tests substitute an in-memory fake — see
 * `test/support`.
 */
export interface UserRepositoryPort {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
