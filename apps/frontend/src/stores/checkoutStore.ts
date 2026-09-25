import { create } from 'zustand';
import { generateUuid } from '../lib/uuid';

/**
 * Short-lived info about the buyer's current in-flight reservation, carried from
 * the seat map (POST /reservations success) to the checkout page. Route state
 * (`navigate(..., { state })`) carries the same payload on the happy path; this
 * store is the fallback so a checkout page remount (e.g. React Router internals)
 * doesn't lose it. It is NOT meant to survive a full page reload — that's an
 * accepted demo limitation given the API has no "GET reservation by id" endpoint.
 */
export interface ActiveReservation {
  reservationId: string;
  eventId: string;
  eventName: string;
  seatId: string;
  seatLabel: string;
  expiresAtUtc: string;
}

interface CheckoutState {
  /**
   * Business correlation id (X-Correlation-Id), per docs/CONTRACTS.md §2: minted
   * once per checkout flow (from opening a seat map through order completion),
   * then becomes the OrderId once POST /orders succeeds.
   */
  correlationId: string | null;
  reservation: ActiveReservation | null;
  /** Mints a fresh correlation id for a newly opened seat map and clears any stale reservation. */
  startCheckout: () => string;
  setReservation: (reservation: ActiveReservation) => void;
  /** Called once POST /orders succeeds — from then on the correlation id IS the order id. */
  setCorrelationId: (id: string) => void;
  clear: () => void;
}

// Deliberately NOT persisted: a correlation id/in-flight reservation is scoped to
// one browser session's checkout attempt, not durable client state.
export const useCheckoutStore = create<CheckoutState>((set) => ({
  correlationId: null,
  reservation: null,
  startCheckout: () => {
    const id = generateUuid();
    set({ correlationId: id, reservation: null });
    return id;
  },
  setReservation: (reservation) => set({ reservation }),
  setCorrelationId: (id) => set({ correlationId: id }),
  clear: () => set({ correlationId: null, reservation: null }),
}));
