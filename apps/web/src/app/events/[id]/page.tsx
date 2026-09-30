/**
 * Event page: import or add guests, then filter, select, and order the call
 * queue for a campaign.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AddGuest } from '../../../components/AddGuest';
import { EventBriefForm } from '../../../components/EventBriefForm';
import { GuestImport } from '../../../components/GuestImport';
import { GuestQueue } from '../../../components/GuestQueue';
import { Icon } from '../../../components/Icon';
import { OutsideHoursGate } from '../../../components/OutsideHoursGate';
import { RemoveQueueGate } from '../../../components/RemoveQueueGate';
import {
  getEvent,
  listAttempts,
  listCampaigns,
  listGuests,
  listRuns,
  loadSettings,
  ServerApiError,
} from '../../../lib/server-api';
import { formatInZone } from '../../../lib/time';

export const dynamic = 'force-dynamic';

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    confirm?: string;
    step?: string;
    guest?: string;
    startsAt?: string;
    callError?: string;
    removeQueue?: string;
  }>;
}) {
  const { id } = await params;
  const query = await searchParams;

  try {
    const [event, guests, campaigns, attempts, runs, org] = await Promise.all([
      getEvent(id),
      listGuests(id),
      listCampaigns(id),
      listAttempts(id),
      listRuns(id),
      loadSettings(),
    ]);

    const openQuestionCount = attempts.reduce(
      (count, attempt) =>
        count + (attempt.openQuestions ?? []).filter((question) => question.status === 'open').length,
      0,
    );

    const confirmed = campaigns.find((campaign) => campaign.id === query.confirm);
    const gateStep = query.step === '2' ? '2' : query.step === '1' ? '1' : null;
    const removing = campaigns.find(
      (campaign) => campaign.id === query.removeQueue && campaign.queue.length > 0,
    );

    return (
      <div className="stack">
        {removing ? <RemoveQueueGate eventId={event.id} campaign={removing} /> : null}
        {confirmed && gateStep ? (
          <OutsideHoursGate
            eventId={event.id}
            campaign={confirmed}
            step={gateStep}
            guestId={query.guest}
            startsAt={query.startsAt}
            callingHoursMode={org.callingHoursMode}
          />
        ) : null}
        {query.callError ? (
          <p className="notice error">
            <Icon name="alert" /> {query.callError}
          </p>
        ) : null}
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
          <p className="mt">
            <Link href={`/events/${event.id}/results`} className="chip strong">
              <Icon name="speech" /> {openQuestionCount}{' '}
              {openQuestionCount === 1 ? 'question' : 'questions'} to call back
            </Link>
          </p>
        </div>

        <section className="card">
          <h2>Description</h2>
          <EventBriefForm event={event} />
        </section>

        <section className="card">
          <h2>Guests</h2>
          {event.lastImport ? (
            <p className="small muted">
              Last import {formatInZone(event.lastImport.at, event.timezone)}:{' '}
              {event.lastImport.importedCount} guests imported,{' '}
              {event.lastImport.skippedWithoutPhone} skipped without a usable phone.
            </p>
          ) : null}
          <GuestImport eventId={event.id} guestCount={guests.length} />
          <AddGuest eventId={event.id} />
        </section>

        <section className="card">
          <h2>Guests and call queue</h2>
          <GuestQueue
            event={event}
            guests={guests}
            campaigns={campaigns}
            attempts={attempts}
            runs={runs}
            nowIso={new Date().toISOString()}
            callingHoursMode={org.callingHoursMode}
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
