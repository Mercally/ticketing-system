import { RegisterUseCase } from './register.use-case.js';
import { User } from '../../domain/entities/user.entity.js';
import { EmailAlreadyRegisteredError } from '../../domain/errors/auth.errors.js';
import type { UserRepositoryPort } from '../../domain/ports/user-repository.port.js';
import type { PasswordHasherPort } from '../../domain/ports/password-hasher.port.js';

function buildUseCase(existingUser: User | null = null) {
  const userRepository: UserRepositoryPort = {
    findByEmail: vi.fn().mockResolvedValue(existingUser),
    findById: vi.fn(),
    create: vi.fn(async (data) => User.create(data)),
  };
  const passwordHasher: PasswordHasherPort = {
    hash: vi.fn().mockResolvedValue('bcrypt-hash-of-password'),
    verify: vi.fn(),
  };

  return { useCase: new RegisterUseCase(userRepository, passwordHasher), userRepository, passwordHasher };
}

describe('RegisterUseCase', () => {
  it('hashes the plaintext password before persisting — the raw password never reaches the repository', async () => {
    const { useCase, userRepository, passwordHasher } = buildUseCase();

    await useCase.execute({ email: 'new@example.com', password: 'plaintext-password', displayName: 'New Buyer' });

    expect(passwordHasher.hash).toHaveBeenCalledWith('plaintext-password');
    const createCall = (userRepository.create as any).mock.calls[0][0];
    expect(createCall.passwordHash).toBe('bcrypt-hash-of-password');
    expect(createCall).not.toHaveProperty('password');
  });

  it('normalizes email to lowercase/trimmed before checking for and storing it', async () => {
    const { useCase, userRepository } = buildUseCase();

    await useCase.execute({ email: '  New@Example.com  ', password: 'plaintext-password', displayName: 'New Buyer' });

    expect(userRepository.findByEmail).toHaveBeenCalledWith('new@example.com');
    const createCall = (userRepository.create as any).mock.calls[0][0];
    expect(createCall.email).toBe('new@example.com');
  });

  it('rejects registration when the email is already registered', async () => {
    const existing = User.create({
      id: 'existing-1',
      email: 'taken@example.com',
      passwordHash: 'x',
      displayName: 'Existing',
      createdAt: new Date(),
    });
    const { useCase, userRepository } = buildUseCase(existing);

    await expect(
      useCase.execute({ email: 'taken@example.com', password: 'whatever12345', displayName: 'New Name' }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
    expect(userRepository.create).not.toHaveBeenCalled();
  });
});
