import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Protects `GET /me` — requires a valid Bearer access token. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
