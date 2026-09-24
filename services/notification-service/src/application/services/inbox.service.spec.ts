import { InboxService } from './inbox.service.js';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service.js';

function buildPrismaMock() {
  return {
    processedMessage: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  };
}

describe('InboxService', () => {
  it('isAlreadyProcessed returns false when no row exists', async () => {
    const prisma = buildPrismaMock();
    prisma.processedMessage.findUnique.mockResolvedValue(null);
    const inbox = new InboxService(prisma as any, new StructuredLoggerService());

    await expect(inbox.isAlreadyProcessed('msg-1')).resolves.toBe(false);
  });

  it('isAlreadyProcessed returns true when a row exists', async () => {
    const prisma = buildPrismaMock();
    prisma.processedMessage.findUnique.mockResolvedValue({ messageId: 'msg-1', processedAt: new Date() });
    const inbox = new InboxService(prisma as any, new StructuredLoggerService());

    await expect(inbox.isAlreadyProcessed('msg-1')).resolves.toBe(true);
  });

  it('markProcessed inserts and reports "inserted" on the first call', async () => {
    const prisma = buildPrismaMock();
    prisma.processedMessage.create.mockResolvedValue({ messageId: 'msg-1', processedAt: new Date() });
    const inbox = new InboxService(prisma as any, new StructuredLoggerService());

    await expect(inbox.markProcessed('msg-1')).resolves.toBe('inserted');
    expect(prisma.processedMessage.create).toHaveBeenCalledWith({ data: { messageId: 'msg-1' } });
  });

  it('markProcessed treats a UNIQUE-constraint violation (P2002) as "already-processed", not an error', async () => {
    const prisma = buildPrismaMock();
    const uniqueViolation = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    prisma.processedMessage.create.mockRejectedValue(uniqueViolation);
    const inbox = new InboxService(prisma as any, new StructuredLoggerService());

    await expect(inbox.markProcessed('msg-1')).resolves.toBe('already-processed');
  });

  it('markProcessed rethrows any error that is not a unique-constraint violation', async () => {
    const prisma = buildPrismaMock();
    prisma.processedMessage.create.mockRejectedValue(new Error('connection refused'));
    const inbox = new InboxService(prisma as any, new StructuredLoggerService());

    await expect(inbox.markProcessed('msg-1')).rejects.toThrow('connection refused');
  });
});
