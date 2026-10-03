/**
 * Campaign page: edit what the agent says and what it must capture, start and
 * stop the run, and see the queue this campaign works through.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CallTranscript } from '../../../../../components/CallTranscript';
import { CampaignForm } from '../../../../../components/CampaignForm';
import { GuestRetryCap } from '../../../../../components/GuestRetryCap';
import { Icon } from '../../../../../components/Icon';
import { RunControls } from '../../../../../components/RunControls';
import { displayedRun } from '../../../../../domain/displayed-run';
import { countAttemptsByGuest, latestAttemptByGuest } from '../../../../../domain/eligibility';
import { orderByQueue } from '../../../../../domain/filter-order';
import { formatIndianPhone } from '../../../../../domain/phone';
import {
  getCampaign,
  getEvent,
  listAttempts,
  listGuests,
  listRuns,
  loadSettings,
  ServerApiError,
} from '../../../../../lib/server-api';
import type { Guest } from '../../../../../domain/types';

export const dynamic = 'force-dynamic';

const PLACEHOLDER_GUEST: Pick<
  Guest,
  'name' | 'ticketName' | 'approvalStatus' | 'email' | 'phone' | 'attributes'
> = {
  name: 'Asha Rao',
  ticketName: 'General',
  approvalStatus: 'approved',
  email: 'asha@example.com',
  phone: '+919876543210',
  attributes: {},
};

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id, campaignId } = await params;

  try {
    const [event, campaign, guests, runs, attempts, org] = await Promise.all([
      getEvent(id),
      getCampaign(campaignId),
      listGuests(id),
      listRuns(id),
      listAttempts(id),
      loadSettings(),
    ]);
    const queued = orderByQueue(guests, campaign.queue);
    const attemptsByGuest = countAttemptsByGuest(attempts, campaign.id);
    const latestByGuest = latestAttemptByGuest(attempts, campaign.id);
    const sampleGuest = queued[0] ?? PLACEHOLDER_GUEST;
    const latestRun = displayedRun(runs, campaign.id);

    return (
      <div className="stack">
        <div>
          <h1>{campaign.name}</h1>
          <p className="muted small">
            {campaign.type} campaign for <Link href={`/events/${event.id}`}>{event.name}</Link>
          </p>
          <div className="toolbar">
            <span className="chip strong">
              <Icon name="users" /> {campaign.queue.length} in queue
            </span>
            <span className="chip">
              <Icon name="clock" /> {campaign.callingWindow.start}-{campaign.callingWindow.end}{' '}
              {campaign.callingWindow.timezone}
            </span>
            <span className="chip">
              <Icon name="stack" /> {campaign.voiceBackendOrder.join(' then ')}
            </span>
          </div>
        </div>

        <section className="card">
          <h2>Calling</h2>
          <RunControls
            campaign={campaign}
            guests={guests}
            initialRun={latestRun}
            callingHoursMode={org.callingHoursMode}
          />
        </section>

        <section className="card">
          <h2>Settings</h2>
          <CampaignForm
            event={event}
            campaign={campaign}
            settings={org.settings}
            callingHoursMode={org.callingHoursMode}
            sampleGuest={sampleGuest}
          />
        </section>

        <section className="card">
          <h2>Queue order</h2>
          {queued.length === 0 ? (
            <p className="empty">
              No guests queued. Build the queue on the{' '}
              <Link href={`/events/${event.id}`}>event page</Link>.
            </p>
          ) : (
            <ol className="queue-list">
              {queued.map((guest, index) => {
                const calls = attempts.filter(
                  (attempt) =>
                    attempt.campaignId === campaign.id &&
                    attempt.guestId === guest.id &&
                    attempt.transcript.length > 0,
                );
                return (
                  <li key={guest.id} className="queue-person">
                    <span className="position-badge">{index + 1}</span>
                    <span className="truncate">{guest.name}</span>
                    <GuestRetryCap
                      campaignId={campaign.id}
                      guestId={guest.id}
                      guestName={guest.name}
                      campaignDefault={campaign.retryCap}
                      override={campaign.retryCapOverrides?.[guest.id]}
                      attempts={attemptsByGuest[guest.id] ?? 0}
                      latest={latestByGuest[guest.id] ?? null}
                    />
                    <span className="phone small muted">{formatIndianPhone(guest.phone)}</span>
                    {calls.length > 0 ? (
                      <div className="queue-transcripts">
                        {calls.map((attempt) => (
                          <CallTranscript
                            key={attempt.id}
                            transcript={attempt.transcript}
                            startedAt={attempt.startedAt}
                            timezone={event.timezone}
                          />
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
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
