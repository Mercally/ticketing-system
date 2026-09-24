import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { RegisterUseCase } from '../../application/use-cases/register.use-case.js';
import { LoginUseCase } from '../../application/use-cases/login.use-case.js';
import { RefreshTokenUseCase } from '../../application/use-cases/refresh-token.use-case.js';
import { LogoutUseCase } from '../../application/use-cases/logout.use-case.js';
import { GetCurrentUserUseCase } from '../../application/use-cases/get-current-user.use-case.js';
import { LocalAuthGuard } from '../passport/local-auth.guard.js';
import { JwtAuthGuard } from '../passport/jwt-auth.guard.js';
import { CurrentUser } from '../passport/current-user.decorator.js';
import type { User } from '../../domain/entities/user.entity.js';
import type { JwtPayload } from '../passport/jwt-payload.js';
import { RegisterDto } from './dto/register.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';

// Mounted at root by design — the Gateway strips the "/api/auth" prefix
// before proxying here (docs/CONTRACTS.md §1/§3).
@Controller()
export class AuthController {
  constructor(
    private readonly registerUseCase: RegisterUseCase,
    private readonly loginUseCase: LoginUseCase,
    private readonly refreshTokenUseCase: RefreshTokenUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly getCurrentUserUseCase: GetCurrentUserUseCase,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto) {
    return this.registerUseCase.execute(dto);
  }

  // LocalAuthGuard runs LocalStrategy, which validates email/password (from
  // the body) via LoginUseCase.validateCredentials and attaches the User to
  // req.user — the actual token issuance happens here, not in the guard.
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@CurrentUser() user: User) {
    return this.loginUseCase.login(user);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.refreshTokenUseCase.execute(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.logoutUseCase.execute(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.getCurrentUserUseCase.execute(user.sub);
  }
}
