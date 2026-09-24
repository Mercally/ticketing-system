import { Injectable } from '@nestjs/common';
import type { TicketConfirmedV1 } from '../dto/consumed-events.js';
import { createOutboundNotification, type OutboundNotification } from '../../domain/outbound-notification.js';

@Injectable()
export class HandleTicketConfirmedUseCase {
  handle(payload: TicketConfirmedV1): OutboundNotification {
    return createOutboundNotification({
      type: 'ticket.confirmed',
      correlationId: payload.CorrelationId,
      orderId: payload.OrderId,
      message: 'Your ticket has been confirmed',
      occurredAtUtc: payload.ConfirmedAtUtc,
    });
  }
}
