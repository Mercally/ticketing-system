import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service.js';

export type MarkProcessedOutcome = 'inserted' | 'already-processed';

/** Prisma's "unique constraint failed" error code. Duck-typed rather than
 * importing `Prisma.PrismaClientKnownRequestError` so this check is robust
 * across Prisma client versions and trivially mockable in tests. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/**
 * Inbox pattern (ADR-0009's Node-side equivalent of MassTransit's built-in
 * Inbox for .NET). Reusable across all four consumed event types.
 *
 * Usage contract (see InboundMessageProcessor): call `isAlreadyProcessed`
 * BEFORE doing any work, and call `markProcessed` AFTER processing
 * succeeds — never before. The `ProcessedMessage.messageId` primary key's
 * UNIQUE constraint is the actual race-safety mechanism: two concurrent
 * redeliveries of the same message can both pass `isAlreadyProcessed`
 * (both see "not yet processed") and both do the processing work, but only
 * one of their `markProcessed` inserts can win — the loser's insert throws
 * a unique-constraint violation, which is treated here as "someone else
 * already recorded this," not as an error.
 */
@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: StructuredLoggerService,
  ) {}

  async isAlreadyProcessed(messageId: string): Promise<boolean> {
    const existing = await this.prisma.processedMessage.findUnique({ where: { messageId } });
    return existing !== null;
  }

  async markProcessed(messageId: string): Promise<MarkProcessedOutcome> {
    try {
      await this.prisma.processedMessage.create({ data: { messageId } });
      return 'inserted';
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        this.logger.warn('Inbox insert lost a race to a concurrent delivery of the same message; already recorded', {
          messageId,
        });
        return 'already-processed';
      }
      throw error;
    }
  }
}
