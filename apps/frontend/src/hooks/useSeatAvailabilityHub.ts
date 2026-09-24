import { useEffect, useRef } from 'react';
import * as signalR from '@microsoft/signalr';
import { API_BASE_URL } from '../lib/apiClient';
import { useAuthStore } from '../stores/authStore';
import type { SeatStatusChangedPayload } from '../types/api';

/**
 * Connects to Ticketing's SignalR hub for live seat availability, per
 * docs/adr/0007-real-time-availability.md: this is a best-effort UX layer only.
 * Ticketing's hub lives at /hubs/seat-availability on the service itself; through
 * the gateway that's /api/ticketing/hubs/seat-availability (docs/CONTRACTS.md §1).
 *
 * A failed or dropped connection never blocks browsing or reserving — the actual
 * reserve action always re-validates against Postgres server-side regardless of
 * what this hook's last-seen state shows.
 */
export function useSeatAvailabilityHub(
  eventId: string | undefined,
  onSeatStatusChanged: (payload: SeatStatusChangedPayload) => void,
): void {
  const handlerRef = useRef(onSeatStatusChanged);
  handlerRef.current = onSeatStatusChanged;

  useEffect(() => {
    if (!eventId) {
      return;
    }

    const connection = new signalR.HubConnectionBuilder()
      .withUrl(`${API_BASE_URL}/api/ticketing/hubs/seat-availability`, {
        accessTokenFactory: () => useAuthStore.getState().accessToken ?? '',
      })
      .withAutomaticReconnect()
      .build();

    connection.on('SeatStatusChanged', (payload: SeatStatusChangedPayload) => {
      handlerRef.current(payload);
    });

    connection.onreconnected(() => {
      connection.invoke('JoinEvent', eventId).catch(() => {
        // Best-effort: a failed re-join just means the live feed stays stale
        // until the next reconnect; reserve() below still re-validates server-side.
      });
    });

    connection
      .start()
      .then(() => connection.invoke('JoinEvent', eventId))
      .catch((err: unknown) => {
        console.warn(
          'Seat availability live updates unavailable (best-effort only, per ADR-0007):',
          err,
        );
      });

    return () => {
      connection.stop().catch(() => {
        // Nothing actionable on teardown failure.
      });
    };
  }, [eventId]);
}
