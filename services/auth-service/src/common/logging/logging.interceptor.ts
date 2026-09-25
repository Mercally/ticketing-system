import { HttpException, HttpStatus, Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

/**
 * Logs one line per request (method, path, status, duration) after it
 * completes. Deliberately logs only metadata — never the request body,
 * headers, or response payload, so passwords/tokens can never leak through
 * this path (ARCHITECTURE.md §10).
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.logCompletion(request, response.statusCode, start),
        // At this point Nest's exception filter hasn't run yet, so
        // response.statusCode still holds the pre-handler value (e.g. the
        // route's @HttpCode) rather than the status the client will actually
        // receive — derive the real one from the thrown error instead.
        error: (error: unknown) =>
          this.logCompletion(request, error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR, start),
      }),
    );
  }

  private logCompletion(request: Request, statusCode: number, start: number): void {
    const durationMs = Date.now() - start;
    this.logger.log(`${request.method} ${request.originalUrl} ${statusCode} ${durationMs}ms`);
  }
}
