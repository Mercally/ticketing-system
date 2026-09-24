import { Injectable } from '@nestjs/common';
import type { PaymentSucceededV1 } from '../dto/consumed-events.js';
import { createOutboundNotification, type OutboundNotification } from '../../domain/outbound-notification.js';

@Injectable()
export class HandlePaymentSucceededUseCase {
  handle(payload: PaymentSucceededV1): OutboundNotification {
    return createOutboundNotification({
      type: 'payment.succeeded',
      correlationId: payload.CorrelationId,
      orderId: payload.OrderId,
      message: 'Your payment was processed successfully',
      occurredAtUtc: payload.ProcessedAtUtc,
    });
  }
}
