import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { requestContextStorage } from '../context/request-context.js';

const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Reads `X-Correlation-Id` from the incoming request (docs/CONTRACTS.md §2),
 * generating one if the caller didn't send it, echoes it back on the
 * response, and makes it available to the logger for the lifetime of the
 * request via AsyncLocalStorage.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(CORRELATION_ID_HEADER);
    const correlationId = incoming && incoming.trim().length > 0 ? incoming.trim() : randomUUID();

    res.setHeader('X-Correlation-Id', correlationId);
    requestContextStorage.run({ correlationId }, () => next());
  }
}
