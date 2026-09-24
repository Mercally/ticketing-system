import { LoginUseCase } from './login.use-case.js';
import { User } from '../../domain/entities/user.entity.js';
import { InvalidCredentialsError } from '../../domain/errors/auth.errors.js';
import type { UserRepositoryPort } from '../../domain/ports/user-repository.port.js';
import type { PasswordHasherPort } from '../../domain/ports/password-hasher.port.js';
import type { TokenIssuerService } from '../services/token-issuer.service.js';

const existingUser = User.create({
  id: 'user-1',
  email: 'demo@example.com',
  passwordHash: 'bcrypt-hash',
  displayName: 'Demo Buyer',
  createdAt: new Date(),
});

function buildUseCase(options?: { userFound?: boolean; passwordMatches?: boolean }) {
  const userRepository: UserRepositoryPort = {
    findByEmail: vi.fn().mockResolvedValue(options?.userFound === false ? null : existingUser),
    findById: vi.fn(),
    create: vi.fn(),
  };
  const passwordHasher: PasswordHasherPort = {
    hash: vi.fn(),
    verify: vi.fn().mockResolvedValue(options?.passwordMatches ?? true),
  };
  const tokenIssuer = {
    issueForNewFamily: vi.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 }),
  } as unknown as TokenIssuerService;

  return { useCase: new LoginUseCase(userRepository, passwordHasher, tokenIssuer), tokenIssuer };
}

describe('LoginUseCase', () => {
  it('validateCredentials returns the user when email and password both match', async () => {
    const { useCase } = buildUseCase({ userFound: true, passwordMatches: true });
    await expect(useCase.validateCredentials('demo@example.com', 'correct-password')).resolves.toBe(existingUser);
  });

  it('validateCredentials throws the SAME error whether the email does not exist or the password is wrong — never reveals which', async () => {
    const { useCase: noSuchUser } = buildUseCase({ userFound: false });
    const { useCase: wrongPassword } = buildUseCase({ userFound: true, passwordMatches: false });

    await expect(noSuchUser.validateCredentials('nobody@example.com', 'x')).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(wrongPassword.validateCredentials('demo@example.com', 'wrong')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('login() issues a brand-new token family via TokenIssuerService', async () => {
    const { useCase, tokenIssuer } = buildUseCase();
    const result = await useCase.login(existingUser);

    expect(tokenIssuer.issueForNewFamily).toHaveBeenCalledWith(existingUser);
    expect(result).toEqual({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 });
  });
});
