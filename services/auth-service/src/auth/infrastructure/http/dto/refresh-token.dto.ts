import { IsString, MinLength } from 'class-validator';

/** POST /refresh and POST /logout share this body shape (docs/CONTRACTS.md §3). */
export class RefreshTokenDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}
