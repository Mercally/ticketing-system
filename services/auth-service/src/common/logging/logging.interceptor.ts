import { Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
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
        next: () => this.logCompletion(request, response, start),
        error: () => this.logCompletion(request, response, start),
      }),
    );
  }

  private logCompletion(request: Request, response: Response, start: number): void {
    const durationMs = Date.now() - start;
    this.logger.log(`${request.method} ${request.originalUrl} ${response.statusCode} ${durationMs}ms`);
  }
}
