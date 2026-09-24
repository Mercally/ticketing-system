/**
 * Port over password hashing so use-cases don't depend on bcrypt directly.
 * `BcryptPasswordHasher` (infrastructure) is the real implementation.
 */
export interface PasswordHasherPort {
  hash(plainTextPassword: string): Promise<string>;
  verify(plainTextPassword: string, passwordHash: string): Promise<boolean>;
}

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
