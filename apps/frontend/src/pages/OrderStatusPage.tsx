import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/apiClient';
import { getErrorMessage } from '../lib/errors';
import type { OrderDetail, OrderStatus } from '../types/api';

async function fetchOrder(orderId: string): Promise<OrderDetail> {
  const response = await apiClient.get<OrderDetail>(`/api/orders/${orderId}`);
  return response.data;
}

const TERMINAL_STATUSES: OrderStatus[] = ['Completed', 'Cancelled'];
const POLL_INTERVAL_MS = 2000;

// Saga states per ARCHITECTURE.md §7. The happy path and the compensation
// (cancellation) path share their first two steps, then diverge.
const HAPPY_PATH: OrderStatus[] = ['Submitted', 'AwaitingPayment', 'Confirming', 'Completed'];
const CANCELLED_PATH: OrderStatus[] = ['Submitted', 'AwaitingPayment', 'Cancelling', 'Cancelled'];

function OrderStepper({ status }: { status: OrderStatus }) {
  const isCancelledPath = status === 'Cancelling' || status === 'Cancelled';
  const steps = isCancelledPath ? CANCELLED_PATH : HAPPY_PATH;
  const currentIndex = steps.indexOf(status);

  return (
    <ol className={`stepper ${isCancelledPath ? 'stepper-cancelled' : ''}`}>
      {steps.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'pending';
        return (
          <li key={step} className={`stepper-step stepper-step-${state}`}>
            <span className="stepper-dot" />
            <span>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function OrderStatusPage() {
  const { orderId } = useParams<{ orderId: string }>();

  const orderQuery = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => fetchOrder(orderId!),
    enabled: Boolean(orderId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && TERMINAL_STATUSES.includes(status)) {
        return false;
      }
      return POLL_INTERVAL_MS;
    },
  });

  if (!orderId) {
    return <p className="form-error">Missing order id.</p>;
  }

  if (orderQuery.isPending) {
    return <p>Loading order…</p>;
  }

  if (orderQuery.isError) {
    return <p className="form-error">{getErrorMessage(orderQuery.error)}</p>;
  }

  const order = orderQuery.data;
  const isTerminal = TERMINAL_STATUSES.includes(order.status);

  return (
    <div>
      <h1>Order status</h1>
      <p className={`status-badge status-${order.status.toLowerCase()}`}>{order.status}</p>

      <OrderStepper status={order.status} />

      {!isTerminal && <p className="polling-note">Watching this order update live…</p>}

      <dl className="order-details">
        <dt>Order</dt>
        <dd>{order.orderId}</dd>
        <dt>Seat</dt>
        <dd>{order.seatId}</dd>
        <dt>Amount</dt>
        <dd>
          {order.amount.toFixed(2)} {order.currency}
        </dd>
        <dt>Created</dt>
        <dd>{new Date(order.createdAtUtc).toLocaleString()}</dd>
        <dt>Updated</dt>
        <dd>{new Date(order.updatedAtUtc).toLocaleString()}</dd>
      </dl>

      <Link to="/events">Back to concerts</Link>
    </div>
  );
}
