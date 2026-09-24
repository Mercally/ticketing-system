import { Injectable } from '@nestjs/common';
import type { OrderConfirmedV1 } from '../dto/consumed-events.js';
import { createOutboundNotification, type OutboundNotification } from '../../domain/outbound-notification.js';

@Injectable()
export class HandleOrderConfirmedUseCase {
  handle(payload: OrderConfirmedV1): OutboundNotification {
    return createOutboundNotification({
      type: 'order.confirmed',
      correlationId: payload.CorrelationId,
      orderId: payload.OrderId,
      message: 'Your order has been confirmed',
      occurredAtUtc: payload.ConfirmedAtUtc,
    });
  }
}
