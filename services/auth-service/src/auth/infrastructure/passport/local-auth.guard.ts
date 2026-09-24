import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Protects `POST /login` — runs LocalStrategy to validate credentials. */
@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {}
