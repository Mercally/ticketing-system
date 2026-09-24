import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { apiClient } from '../lib/apiClient';
import { getErrorMessage } from '../lib/errors';
import { useSeatAvailabilityHub } from '../hooks/useSeatAvailabilityHub';
import { useAuthStore } from '../stores/authStore';
import { useCheckoutStore } from '../stores/checkoutStore';
import type {
  EventDetail,
  ReserveSeatResponse,
  Seat,
  SeatStatusChangedPayload,
} from '../types/api';

async function fetchEvent(eventId: string): Promise<EventDetail> {
  const response = await apiClient.get<EventDetail>(`/api/catalog/events/${eventId}`);
  return response.data;
}

async function fetchSeats(eventId: string): Promise<Seat[]> {
  const response = await apiClient.get<Seat[]>(`/api/ticketing/events/${eventId}/seats`);
  return response.data;
}

const SEAT_STATUS_LABEL: Record<Seat['status'], string> = {
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  SOLD: 'Sold',
};

export function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const buyerId = useAuthStore((state) => state.user?.userId);
  const startCheckout = useCheckoutStore((state) => state.startCheckout);
  const setReservation = useCheckoutStore((state) => state.setReservation);
  const [conflictSeatId, setConflictSeatId] = useState<string | null>(null);

  // A fresh checkout flow (and correlation id) begins the moment the buyer opens
  // this seat map — per docs/CONTRACTS.md §2 / the checkout store contract.
  useEffect(() => {
    startCheckout();
  }, [startCheckout, eventId]);

  const eventQuery = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => fetchEvent(eventId!),
    enabled: Boolean(eventId),
  });

  const seatsQueryKey = useMemo(() => ['seats', eventId] as const, [eventId]);
  const seatsQuery = useQuery({
    queryKey: seatsQueryKey,
    queryFn: () => fetchSeats(eventId!),
    enabled: Boolean(eventId),
  });

  // Best-effort live updates (ADR-0007) patched directly into the query cache.
  // Never treated as authoritative — the reserve mutation below always re-validates
  // server-side regardless of what this shows.
  useSeatAvailabilityHub(eventId, (payload: SeatStatusChangedPayload) => {
    queryClient.setQueryData<Seat[]>(seatsQueryKey, (current) =>
      current?.map((seat) =>
        seat.id === payload.seatId ? { ...seat, status: payload.status } : seat,
      ),
    );
  });

  const reserveMutation = useMutation({
    mutationFn: async (seat: Seat) => {
      // Fresh Idempotency-Key per reserve click (not reused across separate clicks).
      const idempotencyKey = crypto.randomUUID();
      const response = await apiClient.post<ReserveSeatResponse>(
        '/api/ticketing/reservations',
        { eventId, seatId: seat.id, buyerId },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      );
      return { seat, reservation: response.data };
    },
    onSuccess: ({ seat, reservation }) => {
      setConflictSeatId(null);
      setReservation({
        reservationId: reservation.reservationId,
        eventId: eventId!,
        eventName: eventQuery.data?.name ?? '',
        seatId: seat.id,
        seatLabel: seat.label,
        expiresAtUtc: reservation.expiresAtUtc,
      });
      navigate(`/checkout/${reservation.reservationId}`);
    },
    onError: (error, seat) => {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        setConflictSeatId(seat.id);
        void queryClient.invalidateQueries({ queryKey: seatsQueryKey });
      }
    },
  });

  const seatsByRow = useMemo(() => {
    const groups = new Map<string, Seat[]>();
    for (const seat of seatsQuery.data ?? []) {
      const key = `${seat.section} · Row ${seat.row}`;
      const group = groups.get(key);
      if (group) {
        group.push(seat);
      } else {
        groups.set(key, [seat]);
      }
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [seatsQuery.data]);

  if (!eventId) {
    return <p className="form-error">Missing event id.</p>;
  }

  if (eventQuery.isError) {
    return <p className="form-error">{getErrorMessage(eventQuery.error)}</p>;
  }

  return (
    <div>
      {eventQuery.isPending ? (
        <p>Loading event…</p>
      ) : (
        <>
          <h1>{eventQuery.data.name}</h1>
          <p>{eventQuery.data.venue}</p>
          <p className="event-date">
            {new Date(eventQuery.data.startsAtUtc).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </p>
          <p>{eventQuery.data.description}</p>
        </>
      )}

      <h2>Seat map</h2>
      <div className="seat-legend">
        <span className="seat-legend-item">
          <span className="seat-swatch seat-available" /> Available
        </span>
        <span className="seat-legend-item">
          <span className="seat-swatch seat-reserved" /> Reserved
        </span>
        <span className="seat-legend-item">
          <span className="seat-swatch seat-sold" /> Sold
        </span>
      </div>

      {conflictSeatId && (
        <p className="form-error">Seat no longer available — please pick another seat.</p>
      )}
      {reserveMutation.isError && !conflictSeatId && (
        <p className="form-error">{getErrorMessage(reserveMutation.error)}</p>
      )}

      {seatsQuery.isPending && (
        <p>
          Loading seats
          {eventQuery.data ? ` (${eventQuery.data.seatMapRows} × ${eventQuery.data.seatMapCols})` : ''}
          …
        </p>
      )}
      {seatsQuery.isError && <p className="form-error">{getErrorMessage(seatsQuery.error)}</p>}

      {seatsQuery.data && (
        <div className="seat-map">
          {seatsByRow.map(([rowKey, seats]) => (
            <div key={rowKey} className="seat-row">
              <span className="seat-row-label">{rowKey}</span>
              <div className="seat-row-seats">
                {seats.map((seat) => (
                  <button
                    key={seat.id}
                    type="button"
                    title={`${seat.label} — ${SEAT_STATUS_LABEL[seat.status]}`}
                    disabled={seat.status !== 'AVAILABLE' || reserveMutation.isPending}
                    className={`seat seat-${seat.status.toLowerCase()}`}
                    onClick={() => reserveMutation.mutate(seat)}
                  >
                    {seat.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
