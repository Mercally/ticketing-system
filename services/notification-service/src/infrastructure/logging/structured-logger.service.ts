import { Injectable } from '@nestjs/common';

export interface LogMeta {
  /**
   * Business correlation id (see DECISIONS.md D9) — distinct from the OTel
   * trace id, threaded explicitly through every log line for a message's
   * processing so "everything that happened for order X" can be
   * reconstructed even across the SQS-consume -> SNS-publish trace-boundary
   * hop.
   */
  correlationId?: string;
  /** MassTransit envelope messageId — our inbox dedupe key. */
  messageId?: string;
  [key: string]: unknown;
}

/**
 * Small structured JSON logger. Deliberately not a wrapper around Nest's
 * `Logger`/a logging library — this service has exactly one job (attach
 * `correlationId`/`messageId` to every line as real JSON fields, not
 * interpolated text) and a few lines of `console` calls do that without
 * adding a dependency. Separate from OTel spans on purpose (DECISIONS.md
 * D9): CorrelationId is a business concept, OTel TraceId is a transport
 * concept — they are logged independently, not merged into one id.
 */
@Injectable()
export class StructuredLoggerService {
  private write(level: 'info' | 'warn' | 'error', message: string, meta?: LogMeta): void {
    const line = {
      timestamp: new Date().toISOString(),
      level,
      service: 'notification-service',
      message,
      ...meta,
    };
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    sink(JSON.stringify(line));
  }

  log(message: string, meta?: LogMeta): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: LogMeta): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: LogMeta): void {
    this.write('error', message, meta);
  }
}
