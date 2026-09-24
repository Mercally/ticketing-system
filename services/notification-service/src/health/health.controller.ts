import { Controller, Get, HttpCode } from '@nestjs/common';

/**
 * No public write API per CONTRACTS.md §9 — this is the entire HTTP
 * surface of Notification Service. Deliberately has zero dependencies so
 * it can be exercised in tests without booting SQS/SNS/Prisma.
 */
@Controller()
export class HealthController {
  @Get('health')
  @HttpCode(200)
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
