/**
 * Base type for every error the Auth Service's domain/application layers
 * raise. Framework-agnostic on purpose — no NestJS/HTTP concepts leak into
 * `domain`/`application` (requirement 4). `DomainExceptionFilter` is the one
 * place that maps `code` to an HTTP status.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
