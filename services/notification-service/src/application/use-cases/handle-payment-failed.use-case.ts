import { Injectable } from '@nestjs/common';
import type { PaymentFailedV1 } from '../dto/consumed-events.js';
import { createOutboundNotification, type OutboundNotification } from '../../domain/outbound-notification.js';

@Injectable()
export class HandlePaymentFailedUseCase {
  handle(payload: PaymentFailedV1): OutboundNotification {
    return createOutboundNotification({
      type: 'payment.failed',
      correlationId: payload.CorrelationId,
      orderId: payload.OrderId,
      message: `Payment failed: ${payload.Reason}`,
      occurredAtUtc: payload.FailedAtUtc,
    });
  }
}
