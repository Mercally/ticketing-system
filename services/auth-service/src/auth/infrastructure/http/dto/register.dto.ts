import { IsEmail, IsString, MinLength } from 'class-validator';

/** POST /register body (docs/CONTRACTS.md §3). */
export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(1)
  displayName!: string;
}
