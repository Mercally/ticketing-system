import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_FILTER } from '@nestjs/core';
import { AuthController } from './infrastructure/http/auth.controller.js';
import { RegisterUseCase } from './application/use-cases/register.use-case.js';
import { LoginUseCase } from './application/use-cases/login.use-case.js';
import { RefreshTokenUseCase } from './application/use-cases/refresh-token.use-case.js';
import { LogoutUseCase } from './application/use-cases/logout.use-case.js';
import { GetCurrentUserUseCase } from './application/use-cases/get-current-user.use-case.js';
import { TokenIssuerService } from './application/services/token-issuer.service.js';
import { TokenService } from './infrastructure/security/token.service.js';
import { BcryptPasswordHasher } from './infrastructure/security/bcrypt-password-hasher.js';
import { PrismaUserRepository } from './infrastructure/repositories/prisma-user.repository.js';
import { PrismaRefreshTokenRepository } from './infrastructure/repositories/prisma-refresh-token.repository.js';
import { JwtStrategy } from './infrastructure/passport/jwt.strategy.js';
import { LocalStrategy } from './infrastructure/passport/local.strategy.js';
import { DomainExceptionFilter } from './infrastructure/filters/domain-exception.filter.js';
import { USER_REPOSITORY } from './domain/ports/user-repository.port.js';
import { REFRESH_TOKEN_REPOSITORY } from './domain/ports/refresh-token-repository.port.js';
import { PASSWORD_HASHER } from './domain/ports/password-hasher.port.js';
import type { AppConfig } from '../config/configuration.js';

/**
 * Wires the four layers together (Controllers / Application / Domain /
 * Infrastructure). Ports (USER_REPOSITORY etc) are bound to their Prisma
 * implementations here — the only place infrastructure and application meet.
 */
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        secret: config.get('jwt.secret', { infer: true }),
        signOptions: { expiresIn: config.get('jwt.accessTtl', { infer: true }) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    RegisterUseCase,
    LoginUseCase,
    RefreshTokenUseCase,
    LogoutUseCase,
    GetCurrentUserUseCase,
    TokenIssuerService,
    TokenService,
    JwtStrategy,
    LocalStrategy,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: REFRESH_TOKEN_REPOSITORY, useClass: PrismaRefreshTokenRepository },
    { provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AuthModule {}
