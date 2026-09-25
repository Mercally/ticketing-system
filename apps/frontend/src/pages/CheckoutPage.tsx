import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../lib/apiClient';
import { getErrorMessage } from '../lib/errors';
import { useAuthStore } from '../stores/authStore';
import { useCheckoutStore } from '../stores/checkoutStore';
import { PAYMENT_SIMULATION_MODES, type CreateOrderResponse, type PaymentSimulationMode } from '../types/api';
import { generateUuid } from '../lib/uuid';

// No pricing data exists anywhere in the contracts (Catalog/Ticketing never return
// a price) — this is a fixed demo amount, as the spec explicitly allows.
const DEMO_AMOUNT = 89.99;
const DEMO_CURRENCY = 'USD';

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function CheckoutPage() {
  const { reservationId } = useParams<{ reservationId: string }>();
  const navigate = useNavigate();
  const buyerId = useAuthStore((state) => state.user?.userId);
  const reservation = useCheckoutStore((state) => state.reservation);
  const setCorrelationId = useCheckoutStore((state) => state.setCorrelationId);
  const [simulationMode, setSimulationMode] = useState<PaymentSimulationMode>('Success');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const createOrderMutation = useMutation({
    mutationFn: async () => {
      if (!reservation || reservation.reservationId !== reservationId || !buyerId) {
        throw new Error('Missing reservation or buyer information.');
      }
      // Fresh Idempotency-Key per buy click.
      const idempotencyKey = generateUuid();
      const response = await apiClient.post<CreateOrderResponse>(
        '/api/orders',
        {
          reservationId: reservation.reservationId,
          eventId: reservation.eventId,
          seatId: reservation.seatId,
          buyerId,
          amount: DEMO_AMOUNT,
          currency: DEMO_CURRENCY,
          paymentSimulationMode: simulationMode,
        },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      );
      return response.data;
    },
    onSuccess: (data) => {
      // The correlation id becomes the order id from here on (docs/CONTRACTS.md §2).
      setCorrelationId(data.orderId);
      navigate(`/orders/${data.orderId}`);
    },
  });

  if (!reservation || reservation.reservationId !== reservationId) {
    return (
      <div>
        <h1>Checkout</h1>
        <p className="form-error">
          No active reservation found for this checkout. It may have expired or this page was
          opened directly.
        </p>
        <Link to="/events">Back to concerts</Link>
      </div>
    );
  }

  const expiresAtMs = new Date(reservation.expiresAtUtc).getTime();
  const remainingMs = expiresAtMs - now;
  const isExpired = remainingMs <= 0;

  return (
    <div>
      <h1>Checkout</h1>
      <section className="checkout-summary">
        <h2>{reservation.eventName}</h2>
        <p>Seat {reservation.seatLabel}</p>
        <p className={isExpired ? 'countdown countdown-expired' : 'countdown'}>
          {isExpired ? 'Reservation expired' : `Reserved — expires in ${formatRemaining(remainingMs)}`}
        </p>
      </section>

      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          createOrderMutation.mutate();
        }}
      >
        <label className="field">
          <span>Amount</span>
          <input type="text" value={`${DEMO_AMOUNT.toFixed(2)} ${DEMO_CURRENCY}`} readOnly />
        </label>

        <label className="field">
          <span>Simulate payment outcome (dev only)</span>
          <select
            value={simulationMode}
            onChange={(e) => setSimulationMode(e.target.value as PaymentSimulationMode)}
          >
            {PAYMENT_SIMULATION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>

        {createOrderMutation.isError && (
          <p className="form-error">{getErrorMessage(createOrderMutation.error)}</p>
        )}

        <button type="submit" disabled={isExpired || createOrderMutation.isPending}>
          {createOrderMutation.isPending ? 'Placing order…' : 'Buy'}
        </button>
      </form>
    </div>
  );
}
