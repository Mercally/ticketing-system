import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  RefreshTokenExpiredError,
  RefreshTokenInvalidError,
  RefreshTokenReuseDetectedError,
  UserNotFoundError,
} from '../../domain/errors/auth.errors.js';
import { DomainError } from '../../domain/errors/domain-error.js';

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const STATUS_BY_ERROR = new Map<Function, HttpStatus>([
  [EmailAlreadyRegisteredError, HttpStatus.CONFLICT],
  [InvalidCredentialsError, HttpStatus.UNAUTHORIZED],
  [RefreshTokenInvalidError, HttpStatus.UNAUTHORIZED],
  [RefreshTokenReuseDetectedError, HttpStatus.UNAUTHORIZED],
  [RefreshTokenExpiredError, HttpStatus.UNAUTHORIZED],
  [UserNotFoundError, HttpStatus.NOT_FOUND],
]);

/**
 * Maps the framework-agnostic `DomainError` hierarchy onto HTTP responses,
 * so use-cases can throw plain domain errors without knowing about status
 * codes, and controllers stay free of try/catch (requirement 4).
 */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = STATUS_BY_ERROR.get(exception.constructor) ?? HttpStatus.BAD_REQUEST;

    response.status(status).json({
      statusCode: status,
      error: exception.code,
      message: exception.message,
    });
  }
}
