// Types mirroring docs/CONTRACTS.md exactly (§3-8, §11, §12).
// Kept as plain shapes matching the wire JSON — no client-side business logic here.

// ---- Auth (§3) ----

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface RegisterResponse {
  userId: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface MeResponse {
  userId: string;
  email: string;
  displayName: string;
}

// ---- Catalog (§4) ----

export interface EventSummary {
  id: string;
  name: string;
  venue: string;
  startsAtUtc: string;
  imageUrl: string | null;
}

export interface EventDetail {
  id: string;
  name: string;
  venue: string;
  startsAtUtc: string;
  description: string;
  seatMapRows: number;
  seatMapCols: number;
}

// ---- Ticketing (§5, §11) ----

export type SeatStatus = 'AVAILABLE' | 'RESERVED' | 'SOLD';

export interface Seat {
  id: string;
  label: string;
  section: string;
  row: string;
  status: SeatStatus;
}

export interface ReserveSeatRequest {
  eventId: string;
  seatId: string;
  buyerId: string;
}

export interface ReserveSeatResponse {
  reservationId: string;
  seatId: string;
  expiresAtUtc: string;
}

export interface SeatUnavailableError {
  error: 'SeatUnavailable';
}

export interface SeatStatusChangedPayload {
  seatId: string;
  status: SeatStatus;
}

// ---- Orders (§6, §12) ----

export type OrderStatus =
  | 'Submitted'
  | 'AwaitingPayment'
  | 'Confirming'
  | 'Completed'
  | 'Cancelling'
  | 'Cancelled';

export type PaymentSimulationMode =
  | 'Success'
  | 'Decline'
  | 'Timeout'
  | 'DuplicateCallback'
  | 'DelayedResponse';

export const PAYMENT_SIMULATION_MODES: PaymentSimulationMode[] = [
  'Success',
  'Decline',
  'Timeout',
  'DuplicateCallback',
  'DelayedResponse',
];

export interface CreateOrderRequest {
  reservationId: string;
  eventId: string;
  seatId: string;
  buyerId: string;
  amount: number;
  currency: string;
  paymentSimulationMode?: PaymentSimulationMode;
}

export interface CreateOrderResponse {
  orderId: string;
  status: 'Submitted';
}

export interface OrderDetail {
  orderId: string;
  status: OrderStatus;
  eventId: string;
  seatId: string;
  amount: number;
  currency: string;
  createdAtUtc: string;
  updatedAtUtc: string;
}
