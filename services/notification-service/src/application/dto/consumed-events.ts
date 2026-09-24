/**
 * Local copies of the four integration event shapes this service consumes,
 * exactly as published by their owning .NET services (CONTRACTS.md §10).
 *
 * Per DECISIONS.md D3 (no shared Contracts/SharedKernel assembly), this is a
 * deliberate duplication: each consumer hand-writes the subset of an
 * event's shape it needs, rather than depending on a shared package. Field
 * names are PascalCase on purpose — that's the literal wire format
 * MassTransit's default JSON serializer produces from the C# records, and
 * we deserialize those exact names rather than remapping to camelCase.
 */

export interface OrderConfirmedV1 {
  OrderId: string;
  EventId: string;
  SeatId: string;
  BuyerId: string;
  Amount: number;
  ConfirmedAtUtc: string;
  CorrelationId: string;
}

export interface PaymentSucceededV1 {
  OrderId: string;
  PaymentId: string;
  Amount: number;
  ProcessedAtUtc: string;
  CorrelationId: string;
}

export interface PaymentFailedV1 {
  OrderId: string;
  Reason: string;
  FailedAtUtc: string;
  CorrelationId: string;
}

export interface TicketConfirmedV1 {
  OrderId: string;
  ReservationId: string;
  SeatId: string;
  EventId: string;
  ConfirmedAtUtc: string;
  CorrelationId: string;
}

export const SUPPORTED_EVENT_TYPES = [
  'OrderConfirmedV1',
  'PaymentSucceededV1',
  'PaymentFailedV1',
  'TicketConfirmedV1',
] as const;

export type SupportedEventType = (typeof SUPPORTED_EVENT_TYPES)[number];
