import { Injectable, type LoggerService, type LogLevel } from '@nestjs/common';
import { getCorrelationId } from '../context/request-context.js';

interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  context?: string;
  correlationId: string | null;
  message: string;
  trace?: string;
}

/**
 * Minimal structured JSON logger enriched with the request's correlation id.
 * Deliberately NOT built on nestjs-pino — a hand-rolled LoggerService
 * implementation is enough for this service's needs and keeps the
 * dependency surface small.
 *
 * Hard rule (ARCHITECTURE.md §10): never log passwords, tokens, refresh
 * tokens, or the JWT itself. Callers must only pass identifiers (userId,
 * correlationId) and event descriptions, never request bodies or headers.
 */
@Injectable()
export class AppLogger implements LoggerService {
  log(message: unknown, context?: string): void {
    this.write('log', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', message, context, trace);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }

  private write(level: LogLevel, message: unknown, context?: string, trace?: string): void {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      context,
      correlationId: getCorrelationId() ?? null,
      message: typeof message === 'string' ? message : JSON.stringify(message),
    };
    if (trace) {
      entry.trace = trace;
    }

    const line = JSON.stringify(entry);
    if (level === 'error') {
      // eslint-disable-next-line no-console
      console.error(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  }
}
