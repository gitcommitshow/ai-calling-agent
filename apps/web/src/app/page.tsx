/**
 * Events home: create an event and open one. Reads through the server API.
 */
import Link from 'next/link';
import { Icon } from '../components/Icon';
import { NewEvent } from '../components/NewEvent';
import { listEvents } from '../lib/server-api';
import { formatInZone } from '../lib/time';
import type { Event } from '../domain/types';

export const dynamic = 'force-dynamic';

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ lumaError?: string }>;
}) {
  const { lumaError } = await searchParams;
  let events: Event[] = [];
  let error: string | null = null;
  try {
    events = await listEvents();
  } catch (loadError) {
    error = (loadError as Error).message;
  }

  return (
    <div className="stack">
      <h1>Events</h1>

      {error ? (
        <p className="notice error">
          <Icon name="alert" /> {error}
        </p>
      ) : null}

      <section className="card">
        <h2>New event</h2>
        <NewEvent lumaError={lumaError ?? null} />
      </section>

      <section className="card">
        <h2>Your events</h2>
        {events.length === 0 ? (
          <p className="empty">No events yet. Paste a Luma link above, then import a guest CSV.</p>
        ) : (
          <div className="card-grid">
            {events.map((event) => (
              <article key={event.id} className="entity-card">
                <div className="entity-card-head">
                  <div>
                    <h3>
                      <Link href={`/events/${event.id}`}>{event.name}</Link>
                    </h3>
                  </div>
                </div>

                <div className="meta">
                  <span className="meta-row">
                    <Icon name="calendar" />
                    <span>{formatInZone(event.startsAt, event.timezone)}</span>
                  </span>
                  <span className="meta-row">
                    <Icon name="clock" />
                    <span>ends {formatInZone(event.endsAt, event.timezone)}</span>
                  </span>
                  <span className="meta-row">
                    <Icon name="users" />
                    <span>
                      {event.lastImport
                        ? `${event.lastImport.importedCount} guests, ${event.lastImport.skippedWithoutPhone} skipped`
                        : 'no guests imported yet'}
                    </span>
                  </span>
                </div>

                <div className="entity-card-foot">
                  <Link className="small" href={`/events/${event.id}`}>
                    Guests and queue
                  </Link>
                  <Link className="small" href={`/events/${event.id}/test`}>
                    Test call
                  </Link>
                  <Link className="small" href={`/events/${event.id}/results`}>
                    Results
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
