/**
 * Event page: import the guest list, then filter, select, and order the call
 * queue for a campaign.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GuestImport } from '../../../components/GuestImport';
import { GuestQueue } from '../../../components/GuestQueue';
import { Icon } from '../../../components/Icon';
import {
  getEvent,
  listAttempts,
  listCampaigns,
  listGuests,
  ServerApiError,
} from '../../../lib/server-api';
import { formatInZone } from '../../../lib/time';

export const dynamic = 'force-dynamic';

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const [event, guests, campaigns, attempts] = await Promise.all([
      getEvent(id),
      listGuests(id),
      listCampaigns(id),
      listAttempts(id),
    ]);

    return (
      <div className="stack">
        <div>
          <h1>{event.name}</h1>
          <div className="meta">
            <span className="meta-row">
              <Icon name="calendar" />
              <span>
                {formatInZone(event.startsAt, event.timezone)} to{' '}
                {formatInZone(event.endsAt, event.timezone)} ({event.timezone})
              </span>
            </span>
          </div>
          <ul className="inline-list small mt">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <Link href={`/events/${event.id}/campaigns/${campaign.id}`}>
                  Edit {campaign.name}
                </Link>
              </li>
            ))}
            <li>
              <Link href={`/events/${event.id}/test`}>Test call</Link>
            </li>
            <li>
              <Link href={`/events/${event.id}/results`}>Results</Link>
            </li>
          </ul>
        </div>

        <section className="card">
          <h2>Guest import</h2>
          {event.lastImport ? (
            <p className="small muted">
              Last import {formatInZone(event.lastImport.at, event.timezone)}:{' '}
              {event.lastImport.importedCount} guests imported,{' '}
              {event.lastImport.skippedWithoutPhone} skipped without a usable phone.
            </p>
          ) : null}
          <GuestImport eventId={event.id} guestCount={guests.length} />
        </section>

        <section className="card">
          <h2>Guests and call queue</h2>
          <GuestQueue
            event={event}
            guests={guests}
            campaigns={campaigns}
            attempts={attempts}
            nowIso={new Date().toISOString()}
          />
        </section>
      </div>
    );
  } catch (error) {
    if (error instanceof ServerApiError && error.status === 404) notFound();
    return (
      <p className="notice error">
        <Icon name="alert" /> {(error as Error).message}
      </p>
    );
  }
}
