import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/apiClient';
import { getErrorMessage } from '../lib/errors';
import type { EventSummary } from '../types/api';

async function fetchEvents(): Promise<EventSummary[]> {
  const response = await apiClient.get<EventSummary[]>('/api/catalog/events');
  return response.data;
}

export function EventsPage() {
  const eventsQuery = useQuery({ queryKey: ['events'], queryFn: fetchEvents });

  if (eventsQuery.isPending) {
    return <p>Loading concerts…</p>;
  }

  if (eventsQuery.isError) {
    return <p className="form-error">{getErrorMessage(eventsQuery.error)}</p>;
  }

  return (
    <div>
      <h1>Concerts</h1>
      <ul className="event-list">
        {eventsQuery.data.map((event) => (
          <li key={event.id} className="event-card">
            <Link to={`/events/${event.id}`} className="event-card-link">
              {event.imageUrl && <img src={event.imageUrl} alt="" className="event-card-image" />}
              <div>
                <h2>{event.name}</h2>
                <p>{event.venue}</p>
                <p className="event-date">
                  {new Date(event.startsAtUtc).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {eventsQuery.data.length === 0 && <p>No concerts on sale right now.</p>}
    </div>
  );
}
