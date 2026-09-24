import { Controller, Get, HttpCode } from '@nestjs/common';

/**
 * Zero dependencies on purpose — k8s readiness/liveness probes hit this
 * (infrastructure/k8s/base/auth-service/deployment.yaml) and it must not
 * itself depend on Prisma/DB connectivity to answer, or a slow/unready DB
 * would flap the pod's readiness instead of just this endpoint being honest
 * about "the process is up."
 */
@Controller()
export class HealthController {
  @Get('health')
  @HttpCode(200)
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
