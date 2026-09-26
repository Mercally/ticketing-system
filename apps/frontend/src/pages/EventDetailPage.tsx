import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { apiClient } from '../lib/apiClient';
import { getErrorMessage } from '../lib/errors';
import { useSeatAvailabilityHub } from '../hooks/useSeatAvailabilityHub';
import { useAuthStore } from '../stores/authStore';
import { useCheckoutStore } from '../stores/checkoutStore';
import { generateUuid } from '../lib/uuid';
import type {
  EventDetail,
  ReserveSeatResponse,
  Seat,
  SeatStatusChangedPayload,
} from '../types/api';

interface TrafficSpikeResult {
  seatLabel: string;
  requestCount: number;
  succeeded: number;
  conflicted: number;
  failed: number;
  elapsedMs: number;
}

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
  const [spikeSize, setSpikeSize] = useState(20);

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
      const idempotencyKey = generateUuid();
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

  // Demo lab: fires `count` concurrent reservation attempts at the SAME seat from the
  // browser, no backend changes — proves the seat CAS (ARCHITECTURE.md §5.1) live, since
  // the seat map above already re-renders from real SignalR pushes as the winner lands.
  const spikeMutation = useMutation({
    mutationFn: async ({ seat, count }: { seat: Seat; count: number }): Promise<TrafficSpikeResult> => {
      const startedAt = performance.now();
      const attempts = Array.from({ length: count }, () =>
        apiClient.post<ReserveSeatResponse>(
          '/api/ticketing/reservations',
          { eventId, seatId: seat.id, buyerId },
          { headers: { 'Idempotency-Key': generateUuid() } },
        ),
      );
      const settled = await Promise.allSettled(attempts);
      const elapsedMs = Math.round(performance.now() - startedAt);

      let succeeded = 0;
      let conflicted = 0;
      let failed = 0;
      for (const outcome of settled) {
        if (outcome.status === 'fulfilled') {
          succeeded += 1;
        } else if (axios.isAxiosError(outcome.reason) && outcome.reason.response?.status === 409) {
          conflicted += 1;
        } else {
          failed += 1;
        }
      }

      return { seatLabel: seat.label, requestCount: count, succeeded, conflicted, failed, elapsedMs };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: seatsQueryKey });
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

  const spikeTargetSeat = seatsQuery.data?.find((seat) => seat.status === 'AVAILABLE');
  let spikeButtonLabel = 'No available seat to target';
  if (spikeTargetSeat) {
    spikeButtonLabel = `Simulate spike on seat ${spikeTargetSeat.label}`;
  }
  if (spikeMutation.isPending) {
    spikeButtonLabel = 'Simulating…';
  }

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

      {seatsQuery.data && (
        <section className="demo-lab">
          <h2>Demo lab: simulate a traffic spike</h2>
          <p className="demo-lab-hint">
            Fires many concurrent reservation attempts at the same seat, straight from this
            browser tab — no backend or infra changes. Watch the seat above flip once via live
            SignalR while every other attempt gets a 409, proving the seat CAS (ARCHITECTURE.md
            §5.1) really does let exactly one buyer win.
          </p>

          <form
            className="form demo-lab-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (spikeTargetSeat) {
                spikeMutation.mutate({ seat: spikeTargetSeat, count: spikeSize });
              }
            }}
          >
            <label className="field">
              <span>Concurrent buyers</span>
              <input
                type="number"
                min={2}
                max={200}
                value={spikeSize}
                onChange={(event) => setSpikeSize(Number(event.target.value))}
              />
            </label>

            <button type="submit" disabled={!spikeTargetSeat || spikeMutation.isPending}>
              {spikeButtonLabel}
            </button>
          </form>

          {spikeMutation.isError && (
            <p className="form-error">{getErrorMessage(spikeMutation.error)}</p>
          )}

          {spikeMutation.data && (
            <p className="demo-lab-result">
              Seat {spikeMutation.data.seatLabel}: <strong>{spikeMutation.data.succeeded} succeeded</strong>{' '}
              · {spikeMutation.data.conflicted} conflicted (409)
              {spikeMutation.data.failed > 0 && ` · ${spikeMutation.data.failed} errored`} · took{' '}
              {spikeMutation.data.elapsedMs}ms for {spikeMutation.data.requestCount} requests
            </p>
          )}
        </section>
      )}
    </div>
  );
}
